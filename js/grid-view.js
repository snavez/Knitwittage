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
// Layers (inside #grid-container, stacked back-to-front):
//   1. base canvas     — paints each cell's fill colour
//   2. overlay canvas  — transient visuals: selection tint, paste ghost,
//                        cable ghost, knit-active-row outline
//   3. stitch-overlay  — unchanged; sibling of #grid-container in the DOM,
//                        keeps rendering stitch icons as before
//
// Fixed DOM overlays (#selection-box, #knit-row-bar) still live in
// grid-canvas-wrapper and position themselves from GridView.cellBoundsWrapper().

const GridView = (function () {
    const CELL_BASE = 22;    // matches CSS --cell-base
    const GAP_PX = 1;        // matches CSS --cell-gap
    const EMPTY_BG = '#fbf7ec'; // matches --surface

    let rows = 0, cols = 0;
    let container = null;
    let baseCanvas = null, overlayCanvas = null;
    let baseCtx = null, overlayCtx = null;

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
            baseCanvas.style.left = '0';
            baseCanvas.style.top = '0';
            baseCanvas.style.zIndex = '1';
            container.appendChild(baseCanvas);
            baseCtx = baseCanvas.getContext('2d');

            overlayCanvas = document.createElement('canvas');
            overlayCanvas.className = 'grid-overlay-canvas';
            overlayCanvas.style.position = 'absolute';
            overlayCanvas.style.left = '0';
            overlayCanvas.style.top = '0';
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

        const w = totalWidth();
        const h = totalHeight();
        container.style.width = w + 'px';
        container.style.height = h + 'px';

        if (baseCanvas.width !== w || baseCanvas.height !== h) {
            baseCanvas.width = w;  baseCanvas.height = h;
            baseCanvas.style.width = w + 'px';
            baseCanvas.style.height = h + 'px';
            overlayCanvas.width = w;  overlayCanvas.height = h;
            overlayCanvas.style.width = w + 'px';
            overlayCanvas.style.height = h + 'px';
        }
        return true;
    }

    // ---------- drawing ----------
    function drawCell(r, c) {
        const { x, y } = cellOrigin(r, c);
        const s = cellSize();
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
        const w = baseCanvas.width, h = baseCanvas.height;
        const s = cellSize();
        // Single fill for the whole background, then batched per-colour passes
        // for the painted cells. Setting fillStyle is expensive (CSS colour
        // parsing); doing it once per unique colour instead of once per cell
        // is the difference between ~1500ms and ~150ms at 1000×1000.
        baseCtx.fillStyle = EMPTY_BG;
        baseCtx.fillRect(0, 0, w, h);
        const byColor = new Map();
        for (let r = 0; r < rows; r++) {
            const row = state.grid[r];
            if (!row) continue;
            for (let c = 0; c < cols; c++) {
                const color = row[c];
                if (color == null) continue;
                let list = byColor.get(color);
                if (!list) { list = []; byColor.set(color, list); }
                list.push(r, c); // pairs of (r, c) flat — half the GC of {r,c} objects
            }
        }
        for (const [color, rcPairs] of byColor) {
            baseCtx.fillStyle = color;
            for (let i = 0; i < rcPairs.length; i += 2) {
                const r = rcPairs[i], c = rcPairs[i + 1];
                const { x, y } = cellOrigin(r, c);
                baseCtx.fillRect(x, y, s, s);
            }
        }
        redrawOverlay();
    }

    function redrawOverlay() {
        if (!overlayCtx) return;
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        const s = cellSize();

        // Selection tint — subtle sage fill on top of each selected cell
        if (selectionRect) {
            const sel = selectionRect;
            overlayCtx.fillStyle = 'rgba(111, 138, 95, 0.22)';
            for (let r = sel.minR; r <= sel.maxR; r++) {
                for (let c = sel.minC; c <= sel.maxC; c++) {
                    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
                    const { x, y } = cellOrigin(r, c);
                    overlayCtx.fillRect(x, y, s, s);
                }
            }
        }

        // Paste ghost — semi-transparent colour + dashed outline
        if (pasteGhost && pasteGhost.cells) {
            for (const pc of pasteGhost.cells) {
                if (pc.r < 0 || pc.r >= rows || pc.c < 0 || pc.c >= cols) continue;
                const { x, y } = cellOrigin(pc.r, pc.c);
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
                const { x, y } = cellOrigin(row, Math.max(0, minC));
                const cmax = Math.min(cols - 1, maxC);
                const w = (cmax - Math.max(0, minC)) * step() + s;
                const accent = getCssVar('--accent') || '#9b2f2a';
                overlayCtx.strokeStyle = accent;
                overlayCtx.lineWidth = 2;
                overlayCtx.strokeRect(x + 1, y + 1, w - 2, s - 2);
            }
        }

        // Knit active row — accent-colour outline per cell in the row
        if (knitActiveRow !== null && knitActiveRow >= 0 && knitActiveRow < rows) {
            const accent = getCssVar('--accent') || '#9b2f2a';
            overlayCtx.strokeStyle = accent;
            overlayCtx.lineWidth = 2;
            for (let c = 0; c < cols; c++) {
                const { x, y } = cellOrigin(knitActiveRow, c);
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
        ensureLayers();
        redrawAll();
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
        setPasteGhost, clearPasteGhost,
        setCableGhost, clearCableGhost,
        setKnitActiveRow, clearKnitActiveRow,
        setSelection, clearSelectionHighlight,
    };
})();
