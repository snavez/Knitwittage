// === GridView ===
// Canvas-backed grid renderer. Draws the chart directly onto two <canvas>
// layers inside #grid-container instead of creating one <div> per cell —
// so a 300×300 chart (90k cells) renders in one pass instead of choking
// the DOM, and 1000×1000 becomes feasible.
//
// The rest of the app (app.js, cables.js, knit-mode.js) treats this as a
// black box: it never touches grid-cell divs, classes, or dataset fields.
// All interaction goes through the public API at the bottom of this file.
//
// === Viewport-based rendering ===
// Each canvas is sized to the VIEWPORT (the visible portion of the chart),
// not to the whole chart. #grid-container remains chart-sized so the
// scrollbar reflects the chart and hit-testing math (rect.left + clientX
// → chart pixel) is unchanged. The canvases sit inside grid-container
// at (top:scrollY, left:scrollX) so they always cover the part of the
// chart currently in view; redrawAll only paints cells in that viewport.
// As the user scrolls, app.js calls setScrollOffset() which repositions
// the canvases and triggers a repaint. This means GPU memory grows with
// the VIEWPORT (constant ~12MB total) instead of with the chart (used to
// hit ~3GB at 1000×1000).
//
// Layers (inside #grid-container, stacked back-to-front):
//   1. base canvas     — paints each visible cell's fill colour
//   2. overlay canvas  — transient visuals: selection tint, paste ghost,
//                        cable ghost, knit-active-row outline
//   3. stitch-overlay  — sibling of #grid-container; same viewport story,
//                        managed by cables.js renderStitchOverlay().
//
// Fixed DOM overlays (#selection-box, #knit-row-bar) still live in
// grid-canvas-wrapper (chart-sized) and position themselves from
// GridView.cellBoundsWrapper() — they scroll naturally with the browser.

const GridView = (function () {
    const CELL_BASE = 22;    // matches CSS --cell-base
    const GAP_PX = 1;        // matches CSS --cell-gap
    const EMPTY_BG = '#fbf7ec'; // matches --surface
    const GRIDLINE_COLOR = '#ddd0b2'; // matches --border-soft (gap colour)

    let rows = 0, cols = 0;
    let container = null;
    let baseCanvas = null, overlayCanvas = null;
    let baseCtx = null, overlayCtx = null;

    // Viewport-rendering state. The canvases are this size; redrawAll only
    // paints chart cells whose chart-pixel position falls inside the
    // viewport rect [scrollX, scrollX+viewW) × [scrollY, scrollY+viewH).
    let scrollX = 0, scrollY = 0;
    let viewW = 0, viewH = 0;
    let repaintScheduled = false;

    // Transient overlay state
    let pasteGhost = null;       // { cells: [{r, c, color}] } | null
    let cableGhost = null;       // { row, minC, maxC } | null
    let knitActiveRow = null;    // number | null
    let selectionRect = null;    // { minR, maxR, minC, maxC } | null

    // ---------- geometry helpers ----------
    function getZoom() {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--zoom').trim();
        const z = parseFloat(v);
        return isFinite(z) && z > 0 ? z : 1;
    }

    function cellSize() {
        return Math.max(1, Math.round(CELL_BASE * getZoom()));
    }

    function step() { return cellSize() + GAP_PX; }

    function totalWidth() {
        if (cols <= 0) return 0;
        return cols * cellSize() + (cols - 1) * GAP_PX;
    }

    function totalHeight() {
        if (rows <= 0) return 0;
        return rows * cellSize() + (rows - 1) * GAP_PX;
    }

    function cellOrigin(r, c) {
        const s = step();
        return { x: c * s, y: r * s };
    }

    // ---------- setup ----------
    // Compute the viewport size (the canvas size) — the visible chart area
    // bounded by .canvas-area's clientWidth/Height, clamped to chart size
    // so a tiny chart in a big window doesn't waste pixels. Falls back to
    // a sane default if .canvas-area isn't ready yet.
    function computeViewportSize() {
        const canvasArea = document.querySelector('.canvas-area');
        const chartW = totalWidth();
        const chartH = totalHeight();
        if (!canvasArea) return { w: Math.max(1, chartW), h: Math.max(1, chartH) };
        // Read the visible window. Add a small margin so cells right at the
        // edge of the viewport are fully painted (rather than half-painted
        // and then revealed by a later scroll repaint).
        const margin = 64;
        const w = Math.min(chartW, canvasArea.clientWidth + margin) || chartW || 1;
        const h = Math.min(chartH, canvasArea.clientHeight + margin) || chartH || 1;
        return { w: Math.max(1, w), h: Math.max(1, h) };
    }

    function ensureLayers() {
        if (!container) container = document.getElementById('grid-container');
        if (!container) return false;

        if (!baseCanvas) {
            // First-time: replace any DOM cells, turn the container into a
            // positioning context for the two canvases.
            container.innerHTML = '';
            container.style.display = 'block';
            container.style.position = 'relative';
            container.style.lineHeight = '0';
            // Container's background shows through the 1px gap between cells,
            // so set it to the soft border tone.
            container.style.background = 'var(--border-soft)';

            baseCanvas = document.createElement('canvas');
            baseCanvas.className = 'grid-base-canvas';
            baseCanvas.style.position = 'absolute';
            baseCanvas.style.zIndex = '1';
            container.appendChild(baseCanvas);
            baseCtx = baseCanvas.getContext('2d');

            overlayCanvas = document.createElement('canvas');
            overlayCanvas.className = 'grid-overlay-canvas';
            overlayCanvas.style.position = 'absolute';
            overlayCanvas.style.zIndex = '3';
            overlayCanvas.style.pointerEvents = 'none';
            container.appendChild(overlayCanvas);
            overlayCtx = overlayCanvas.getContext('2d');
        }

        // Publish the integer cell size we actually use on the canvas into
        // the CSS --cell-size variable. The row/col number labels pick their
        // height/width from that variable, so this keeps them perfectly
        // aligned with canvas cell centres (no sub-pixel drift at low zoom).
        const sz = cellSize();
        document.documentElement.style.setProperty('--cell-size', `${sz}px`);

        const chartW = totalWidth();
        const chartH = totalHeight();
        // Container stays sized to the chart — gives the scrollbar the full
        // chart extent, and hit-testing (cellAt) reads container.rect to
        // translate clientX/Y → chart pixels without thinking about scroll.
        container.style.width = chartW + 'px';
        container.style.height = chartH + 'px';

        // Canvases are viewport-sized; positioned at (scrollX, scrollY)
        // within the chart-sized container so they always cover the part
        // of the chart currently in view.
        const { w: vw, h: vh } = computeViewportSize();
        viewW = vw;
        viewH = vh;
        // Clamp scroll offset to chart bounds (relevant after a resize that
        // shrinks the chart below the previous scroll position).
        scrollX = Math.max(0, Math.min(scrollX, Math.max(0, chartW - vw)));
        scrollY = Math.max(0, Math.min(scrollY, Math.max(0, chartH - vh)));

        if (baseCanvas.width !== vw || baseCanvas.height !== vh) {
            // Free the old GPU buffer BEFORE asking for a new one — see
            // §7.10 of ARCHITECTURE.md.
            baseCanvas.width = 0;  baseCanvas.height = 0;
            overlayCanvas.width = 0;  overlayCanvas.height = 0;
            baseCanvas.width = vw;  baseCanvas.height = vh;
            baseCanvas.style.width = vw + 'px';
            baseCanvas.style.height = vh + 'px';
            overlayCanvas.width = vw;  overlayCanvas.height = vh;
            overlayCanvas.style.width = vw + 'px';
            overlayCanvas.style.height = vh + 'px';
        }
        baseCanvas.style.left = scrollX + 'px';
        baseCanvas.style.top = scrollY + 'px';
        overlayCanvas.style.left = scrollX + 'px';
        overlayCanvas.style.top = scrollY + 'px';
        return true;
    }

    // ---------- drawing ----------
    // Compute the visible chart-cell range from the current scroll offset
    // and viewport size. Returns half-open [r0, r1) × [c0, c1) bounds that
    // are clamped to the chart and inclusive of any cell whose footprint
    // touches the viewport.
    function visibleRange() {
        const stp = step();
        const c0 = Math.max(0, Math.floor(scrollX / stp));
        const r0 = Math.max(0, Math.floor(scrollY / stp));
        const c1 = Math.min(cols, Math.ceil((scrollX + viewW) / stp));
        const r1 = Math.min(rows, Math.ceil((scrollY + viewH) / stp));
        return { r0, r1, c0, c1 };
    }

    // Cell (r, c) → canvas-relative pixel coords (after subtracting scroll).
    // Returns null if the cell is fully outside the viewport.
    function cellOriginCanvas(r, c) {
        const stp = step();
        const x = c * stp - scrollX;
        const y = r * stp - scrollY;
        return { x, y };
    }

    function drawCell(r, c) {
        const s = cellSize();
        const { x, y } = cellOriginCanvas(r, c);
        if (x + s < 0 || y + s < 0 || x > viewW || y > viewH) return;
        const color = (state.grid[r] && state.grid[r][c]) || null;
        baseCtx.fillStyle = color || EMPTY_BG;
        baseCtx.fillRect(x, y, s, s);
    }

    function redrawCell(r, c) {
        if (!ensureLayers()) return;
        if (r < 0 || r >= rows || c < 0 || c >= cols) return;
        drawCell(r, c);
    }

    function redrawAll() {
        if (!ensureLayers()) return;
        const s = cellSize();
        const stp = step();
        // 1) Paint the whole canvas EMPTY_BG. One fillStyle, one fillRect.
        baseCtx.fillStyle = EMPTY_BG;
        baseCtx.fillRect(0, 0, viewW, viewH);
        // 2) Punch 1px gridlines at every gap position THAT FALLS IN VIEW.
        //    The gap between chart cols c-1 and c is at chart pixel c*stp
        //    - GAP_PX, so canvas pixel = c*stp - GAP_PX - scrollX. Skip
        //    lines outside [0, viewW].
        baseCtx.fillStyle = GRIDLINE_COLOR;
        const { r0, r1, c0, c1 } = visibleRange();
        for (let c = Math.max(1, c0); c < c1; c++) {
            const x = c * stp - GAP_PX - scrollX;
            if (x >= 0 && x <= viewW) baseCtx.fillRect(x, 0, GAP_PX, viewH);
        }
        for (let r = Math.max(1, r0); r < r1; r++) {
            const y = r * stp - GAP_PX - scrollY;
            if (y >= 0 && y <= viewH) baseCtx.fillRect(0, y, viewW, GAP_PX);
        }
        // 3) Bucket VISIBLE painted cells by colour and overpaint with one
        //    fillStyle per unique colour, batched fillRects. Skipping
        //    off-screen cells is the whole point of viewport rendering.
        const byColor = new Map();
        for (let r = r0; r < r1; r++) {
            const row = state.grid[r];
            if (!row) continue;
            for (let c = c0; c < c1; c++) {
                const color = row[c];
                if (color == null) continue;
                let list = byColor.get(color);
                if (!list) { list = []; byColor.set(color, list); }
                list.push(r, c);
            }
        }
        for (const [color, rcPairs] of byColor) {
            baseCtx.fillStyle = color;
            for (let i = 0; i < rcPairs.length; i += 2) {
                const r = rcPairs[i], c = rcPairs[i + 1];
                const x = c * stp - scrollX;
                const y = r * stp - scrollY;
                baseCtx.fillRect(x, y, s, s);
            }
        }
        redrawOverlay();
    }

    function redrawOverlay() {
        if (!overlayCtx) return;
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        const s = cellSize();
        // Coords below are canvas-relative (chart pixel - scrollOffset),
        // which is a no-op offset when the chart fits the viewport but
        // crucial for big grids where the canvas is smaller than the chart.

        // Selection tint — subtle sage fill on top of each selected cell
        if (selectionRect) {
            const sel = selectionRect;
            overlayCtx.fillStyle = 'rgba(111, 138, 95, 0.22)';
            for (let r = sel.minR; r <= sel.maxR; r++) {
                for (let c = sel.minC; c <= sel.maxC; c++) {
                    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
                    const { x, y } = cellOriginCanvas(r, c);
                    if (x + s < 0 || y + s < 0 || x > viewW || y > viewH) continue;
                    overlayCtx.fillRect(x, y, s, s);
                }
            }
        }

        // Paste ghost — semi-transparent colour + dashed outline
        if (pasteGhost && pasteGhost.cells) {
            for (const pc of pasteGhost.cells) {
                if (pc.r < 0 || pc.r >= rows || pc.c < 0 || pc.c >= cols) continue;
                const { x, y } = cellOriginCanvas(pc.r, pc.c);
                if (x + s < 0 || y + s < 0 || x > viewW || y > viewH) continue;
                overlayCtx.globalAlpha = 0.5;
                overlayCtx.fillStyle = pc.color;
                overlayCtx.fillRect(x, y, s, s);
                overlayCtx.globalAlpha = 1;
                overlayCtx.setLineDash([3, 2]);
                overlayCtx.strokeStyle = '#ffffff';
                overlayCtx.lineWidth = 1;
                overlayCtx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
                overlayCtx.setLineDash([]);
            }
        }

        // Cable ghost — accent-colour box around the drag row segment
        if (cableGhost) {
            const { row, minC, maxC } = cableGhost;
            if (row >= 0 && row < rows) {
                const { x, y } = cellOriginCanvas(row, Math.max(0, minC));
                const cmax = Math.min(cols - 1, maxC);
                const w = (cmax - Math.max(0, minC)) * step() + s;
                if (!(x + w < 0 || y + s < 0 || x > viewW || y > viewH)) {
                    const accent = getCssVar('--accent') || '#9b2f2a';
                    overlayCtx.strokeStyle = accent;
                    overlayCtx.lineWidth = 2;
                    overlayCtx.strokeRect(x + 1, y + 1, w - 2, s - 2);
                }
            }
        }

        // Knit active row — accent-colour outline per cell in the row
        if (knitActiveRow !== null && knitActiveRow >= 0 && knitActiveRow < rows) {
            const accent = getCssVar('--accent') || '#9b2f2a';
            overlayCtx.strokeStyle = accent;
            overlayCtx.lineWidth = 2;
            const { c0, c1 } = visibleRange();
            for (let c = c0; c < c1; c++) {
                const { x, y } = cellOriginCanvas(knitActiveRow, c);
                if (x + s < 0 || y + s < 0 || x > viewW || y > viewH) continue;
                overlayCtx.strokeRect(x + 1, y + 1, s - 2, s - 2);
            }
        }
    }

    function getCssVar(name) {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name);
        return v ? v.trim() : '';
    }

    // ---------- hit testing & geometry (public) ----------
    function cellAt(clientX, clientY) {
        if (!container) return null;
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        if (x < 0 || y < 0 || x >= totalWidth() || y >= totalHeight()) return null;
        const s = step();
        const c = Math.floor(x / s);
        const r = Math.floor(y / s);
        if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
        return { r, c };
    }

    // Cell bounds in grid-canvas-wrapper space.
    // grid-container sits at (0, 0) of grid-canvas-wrapper, so cellOrigin's
    // coords work for wrapper-relative positioning too.
    function cellBoundsWrapper(r, c) {
        const { x, y } = cellOrigin(r, c);
        const s = cellSize();
        return { x, y, w: s, h: s };
    }

    function getCellSize() { return cellSize(); }
    function getGap() { return GAP_PX; }

    // ---------- public API ----------
    function init(r, c) {
        rows = r;
        cols = c;
        pasteGhost = null;
        cableGhost = null;
        knitActiveRow = null;
        selectionRect = null;
        // Reset scroll offset on grid init (new chart starts at top-left).
        scrollX = 0;
        scrollY = 0;
        ensureLayers();
        redrawAll();
    }

    // Called from app.js's scroll listener whenever .canvas-area scrolls.
    // Reposition the canvases so they keep covering the visible part of
    // the chart, then schedule a repaint via rAF (coalesces multiple
    // scroll events into one paint per frame). cellAt and
    // cellBoundsWrapper read container.getBoundingClientRect, which the
    // browser updates automatically as we scroll — so they need no help
    // from this code.
    function setScrollOffset(sx, sy) {
        if (sx === scrollX && sy === scrollY) return;
        scrollX = sx;
        scrollY = sy;
        if (baseCanvas) {
            baseCanvas.style.left = sx + 'px';
            baseCanvas.style.top = sy + 'px';
        }
        if (overlayCanvas) {
            overlayCanvas.style.left = sx + 'px';
            overlayCanvas.style.top = sy + 'px';
        }
        scheduleRepaint();
    }

    function scheduleRepaint() {
        if (repaintScheduled) return;
        repaintScheduled = true;
        requestAnimationFrame(() => {
            repaintScheduled = false;
            redrawAll();
        });
    }

    function rerender() {
        // Call after zoom change: resize canvases and repaint everything.
        ensureLayers();
        redrawAll();
    }

    function setPasteGhost(cells) { pasteGhost = { cells }; redrawOverlay(); }
    function clearPasteGhost() { pasteGhost = null; redrawOverlay(); }

    function setCableGhost(row, minC, maxC) {
        cableGhost = { row, minC, maxC };
        redrawOverlay();
    }
    function clearCableGhost() { cableGhost = null; redrawOverlay(); }

    function setKnitActiveRow(row) { knitActiveRow = row; redrawOverlay(); }
    function clearKnitActiveRow() { knitActiveRow = null; redrawOverlay(); }

    function setSelection(sel) { selectionRect = sel; redrawOverlay(); }
    function clearSelectionHighlight() { selectionRect = null; redrawOverlay(); }

    return {
        init,
        rerender,
        redrawCell,
        redrawAll,
        cellAt,
        cellBoundsWrapper,
        getCellSize,
        getGap,
        setScrollOffset,
        setPasteGhost, clearPasteGhost,
        setCableGhost, clearCableGhost,
        setKnitActiveRow, clearKnitActiveRow,
        setSelection, clearSelectionHighlight,
    };
})();
