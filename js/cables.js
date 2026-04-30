// === Context-Driven Crossing System ===
// Crossings read K/P context from surrounding rows.
// The chart shows WHAT the fabric looks like, not HOW to make it.
//
// Simple stitches (knit/purl/decreases/increases/etc.) and STITCH_COLORS now
// live in js/stitches.js as a data-driven registry. Crosses stay here because
// they involve drag-placement + cluster-aware rendering that doesn't fit the
// single-cell draw model.

let crossIdCounter = 0;

document.addEventListener('DOMContentLoaded', () => {
    initStitchPalette();
    bindStitchEvents();
    // Re-render the palette if user stitches load in after startup.
    document.addEventListener('stitch-registry-updated', initStitchPalette);
    // The chart overlay caches stitch icons via def.drawCell — when a user
    // stitch is added, edited, or replaced (gallery import, conflict review),
    // existing chart cells using that code need to repaint with the new icon.
    // Without this listener the user has to click into the grid before the
    // change becomes visible.
    document.addEventListener('stitch-registry-updated', () => {
        if (typeof renderStitchOverlay === 'function') renderStitchOverlay();
    });
});

// ========================================
// STITCH PALETTE (data-driven from StitchRegistry)
// ========================================
function initStitchPalette() {
    const palette = document.getElementById('stitch-palette');
    if (!palette) return;

    // Preserve which tile was selected so re-renders (e.g. after user-stitch
    // load) don't silently drop the active highlight.
    const activeId = state?.activeStitch || null;
    palette.innerHTML = '';

    // Restrict to the project's active set (∪ grid-used ∪ erase). Falls back
    // to "everything" pre-init / pre-pattern-load so the palette never goes
    // mysteriously empty during startup.
    const effective = (typeof getEffectiveActiveStitches === 'function')
        ? getEffectiveActiveStitches()
        : null;
    for (const stitch of StitchRegistry.getAll()) {
        // Erase isn't a stitch — it has its own dedicated button below the
        // palette grid (see #btn-erase-stitch in index.html), styled to read
        // as a tool/function rather than a stitch type.
        if (stitch.id === 'stitch-erase') continue;
        if (effective && !effective.has(stitch.id)) continue;
        palette.appendChild(buildStitchTile(stitch, activeId === stitch.id));
    }

    // Keep the existing behaviour: checkbox click on the No Stitch tile must
    // not also trigger the tile's stitch selection.
    const checkbox = document.getElementById('no-stitch-select-mode');
    if (checkbox) checkbox.addEventListener('click', (e) => e.stopPropagation());
}

function buildStitchTile(stitch, isActive) {
    const tile = document.createElement('div');
    tile.className = 'stitch-tile' + (stitch.extraTileClass ? ' ' + stitch.extraTileClass : '');
    if (isActive) tile.classList.add('active');
    tile.dataset.stitch = stitch.id;
    if (stitch.title) tile.title = stitch.title;

    // Build the icon element: canvas for drawn stitches, span glyph for the eraser.
    let iconEl;
    if (stitch.useGlyph) {
        iconEl = document.createElement('span');
        iconEl.className = 'stitch-erase-icon';
        iconEl.textContent = stitch.useGlyph;
    } else {
        iconEl = document.createElement('canvas');
        iconEl.className = 'stitch-tile-canvas';
        iconEl.width = 40;
        iconEl.height = 40;
    }

    const labels = document.createElement('div');
    labels.className = 'stitch-labels';
    const main = document.createElement('span');
    main.className = 'stitch-label-main';
    main.textContent = stitch.label;
    labels.appendChild(main);
    if (stitch.sublabel) {
        const sub = document.createElement('span');
        sub.className = 'stitch-label-sub';
        sub.textContent = stitch.sublabel;
        labels.appendChild(sub);
    }

    // No Stitch has a checkbox appended below the icon+labels — preserve the
    // existing two-part layout (.no-st-top wraps icon+labels).
    if (stitch.id === 'no-stitch') {
        const top = document.createElement('div');
        top.className = 'no-st-top';
        top.appendChild(iconEl);
        top.appendChild(labels);
        tile.appendChild(top);

        const checkboxLabel = document.createElement('label');
        checkboxLabel.className = 'no-st-checkbox';
        checkboxLabel.title = 'Check to fill all empty background (BG) cells in the design grid.';
        checkboxLabel.innerHTML = '<input type="checkbox" id="no-stitch-select-mode"> All BG';
        tile.appendChild(checkboxLabel);
    } else {
        tile.appendChild(iconEl);
        tile.appendChild(labels);
    }

    if (iconEl.tagName === 'CANVAS' && typeof stitch.drawIcon === 'function') {
        const ctx = iconEl.getContext('2d');
        ctx.fillStyle = STITCH_COLORS.bg;
        ctx.fillRect(0, 0, 40, 40);
        stitch.drawIcon(ctx, 40);
    }

    return tile;
}

// ========================================
// EVENTS
// ========================================
function bindStitchEvents() {
    // Delegated on the palette container — survives palette re-renders when
    // user stitches load in after startup (or when a new one is saved).
    const palette = document.getElementById('stitch-palette');
    if (palette) {
        palette.addEventListener('click', (e) => {
            const tile = e.target.closest('.stitch-tile');
            if (!tile || !palette.contains(tile)) return;
            // The No-Stitch checkbox sits inside its tile but shouldn't trigger
            // a stitch selection when toggled.
            if (e.target.closest('#no-stitch-select-mode') ||
                (e.target.tagName === 'INPUT' && e.target.type === 'checkbox')) return;
            selectStitch(tile.dataset.stitch);
        });
        palette.addEventListener('contextmenu', onStitchTileContext);
    }

    const container = document.getElementById('grid-container');

    container.addEventListener('mousedown', (e) => {
        // Erase toggles take priority over stitch placement — let app.js
        // (bubble phase) handle the click as an erase action.
        if (state.eraseStitch || state.eraseColour) return;
        if (state.activeTool !== 'stitch') return;
        const hit = GridView.cellAt(e.clientX, e.clientY);
        if (!hit) return;
        const r = hit.r, c = hit.c;

        if (StitchRegistry.isPaintable(state.activeStitch)) {
            e.preventDefault();
            e.stopPropagation();
            applySimpleStitch(r, c);
            state.isPainting = true;
            return;
        }

        if (StitchRegistry.isDragPlaced(state.activeStitch)) {
            e.preventDefault();
            e.stopPropagation();
            state.cableDragStart = { row: r, col: c };
            state.cableDragEnd = { row: r, col: c };
            renderCableGhost();
        }
    }, true);

    container.addEventListener('mousemove', (e) => {
        // Erase toggles take priority — let the bubble-phase handler in
        // app.js continue the drag-erase across cells.
        if (state.eraseStitch || state.eraseColour) return;
        if (state.activeTool !== 'stitch') return;
        const hit = GridView.cellAt(e.clientX, e.clientY);
        if (!hit) return;
        const r = hit.r, c = hit.c;

        if (StitchRegistry.isPaintable(state.activeStitch) && state.isPainting) {
            applySimpleStitch(r, c);
            return;
        }

        if (state.cableDragStart && StitchRegistry.isDragPlaced(state.activeStitch)) {
            const maxW = 8;
            let endCol = c;
            const startCol = state.cableDragStart.col;
            const width = Math.abs(endCol - startCol) + 1;
            if (width > maxW) {
                endCol = startCol + (endCol > startCol ? maxW - 1 : -(maxW - 1));
            }
            state.cableDragEnd = { row: state.cableDragStart.row, col: endCol };
            renderCableGhost();
        }
    }, true);

    document.addEventListener('mouseup', () => {
        if (state.activeTool === 'stitch' && state.isPainting) {
            state.isPainting = false;
            pushHistory();
            return;
        }
        if (state.cableDragStart) {
            if (isCrossStitch(state.activeStitch)) {
                commitCross();
                return;
            }
            if (StitchRegistry.isUserMulti(state.activeStitch)) {
                commitUserMulti();
                return;
            }
        }
    });
}

function selectStitch(stitch) {
    // No-stitch tile: just becomes the active stitch like any other.
    // The "All BG" checkbox modifies the *click-on-cell* behaviour
    // (see applySimpleStitch) — selecting the tile no longer fires a
    // flood-fill on its own.

    state.activeStitch = stitch;
    state.activeTool = 'stitch';
    // Picking a stitch tile means "I want to place this stitch" — turn off
    // the erase toggles so the next click actually places, not erases.
    state.eraseStitch = false;
    state.eraseColour = false;
    document.querySelectorAll('.stitch-tile').forEach(t => {
        t.classList.toggle('active', t.dataset.stitch === stitch);
    });
    if (typeof updateToolButtons === 'function') updateToolButtons();
}

function isCrossStitch(stitch) {
    return StitchRegistry.isCross(stitch);
}

// ========================================
// SIMPLE STITCH PLACEMENT
// ========================================
function applySimpleStitch(r, c) {
    if (!state.stitchGrid[r]) return;

    if (state.activeStitch === 'stitch-erase') {
        // If clicking on a crossing, erase the whole group
        const existing = state.stitchGrid[r][c];
        if (existing && typeof existing === 'object' && existing.id) {
            const id = existing.id;
            for (let cc = 0; cc < state.cols; cc++) {
                const s = state.stitchGrid[r][cc];
                if (s && typeof s === 'object' && s.id === id) {
                    state.stitchGrid[r][cc] = null;
                }
            }
        } else {
            state.stitchGrid[r][c] = null;
        }
    } else if (state.activeStitch === 'no-stitch'
               && document.getElementById('no-stitch-select-mode')?.checked) {
        // No St + "All BG" checkbox: a single click floods every empty cell
        // (no colour, no stitch) on the chart with No Stitch.
        for (let rr = 0; rr < state.rows; rr++) {
            if (!state.stitchGrid[rr]) continue;
            for (let cc = 0; cc < state.cols; cc++) {
                const hasColor = !!state.grid[rr][cc];
                const hasStitch = !!state.stitchGrid[rr][cc];
                if (!hasColor && !hasStitch) {
                    state.stitchGrid[rr][cc] = 'no-stitch';
                }
            }
        }
    } else if (StitchRegistry.isSimple(state.activeStitch)) {
        // Registry ids are what we store in the grid verbatim.
        state.stitchGrid[r][c] = state.activeStitch;
    }
    renderStitchOverlay();
}

// ========================================
// CLUSTER DETECTION
// ========================================
// Scans a row of stitch types and groups into contiguous clusters
function detectClusters(stitchRow, minC, maxC) {
    const clusters = [];
    let current = null;
    let count = 0;
    let startC = minC;

    for (let c = minC; c <= maxC; c++) {
        const st = stitchRow[c];
        // Normalize: null or 'knit' → 'knit', 'purl' → 'purl', objects → 'knit' (treat crossings as knit)
        const type = (st === 'purl') ? 'purl' : 'knit';

        if (type === current) {
            count++;
        } else {
            if (current !== null) {
                clusters.push({ st: current, count, startCol: startC });
            }
            current = type;
            count = 1;
            startC = c;
        }
    }
    if (current !== null) {
        clusters.push({ st: current, count, startCol: startC });
    }
    return clusters;
}

// Compute the expected stitch arrangement after a cross
function computeCrossResult(clusters, dir) {
    if (clusters.length === 1) {
        // All same type: result is identical (same stitches, just crossed)
        return Array(clusters[0].count).fill(clusters[0].st);
    }

    if (clusters.length === 2) {
        // Two clusters: swap them
        const [a, b] = clusters;
        const aStitches = Array(a.count).fill(a.st);
        const bStitches = Array(b.count).fill(b.st);
        // Left cross: right cluster comes first (moves left)
        // Right cross: left cluster comes first (moves right)
        if (dir === 'left') return [...bStitches, ...aStitches];
        else return [...bStitches, ...aStitches]; // same swap, different visual front/back
    }

    if (clusters.length === 3) {
        // Three clusters: outer two swap, center stays
        const [a, center, b] = clusters;
        const aStitches = Array(a.count).fill(a.st);
        const centerStitches = Array(center.count).fill(center.st);
        const bStitches = Array(b.count).fill(b.st);
        return [...bStitches, ...centerStitches, ...aStitches];
    }

    // 4+ clusters: just reverse the whole thing as a simple swap
    const result = [];
    for (const c of [...clusters].reverse()) {
        for (let i = 0; i < c.count; i++) result.push(c.st);
    }
    return result;
}

// ========================================
// CROSSING PLACEMENT
// ========================================
function renderCableGhost() {
    if (!state.cableDragStart || !state.cableDragEnd) {
        GridView.clearCableGhost();
        return;
    }
    const row = state.cableDragStart.row;
    const minC = Math.min(state.cableDragStart.col, state.cableDragEnd.col);
    const maxC = Math.max(state.cableDragStart.col, state.cableDragEnd.col);
    if (maxC - minC + 1 < 2) {
        GridView.clearCableGhost();
        return;
    }
    GridView.setCableGhost(row, minC, maxC);
}

function commitCross() {
    if (!state.cableDragStart || !state.cableDragEnd) {
        clearCableDrag();
        return;
    }

    const row = state.cableDragStart.row;
    const minC = Math.min(state.cableDragStart.col, state.cableDragEnd.col);
    const maxC = Math.max(state.cableDragStart.col, state.cableDragEnd.col);
    const width = maxC - minC + 1;

    if (width < 2) {
        clearCableDrag();
        return;
    }

    const dir = state.activeStitch === 'left-cross' ? 'left' : 'right';

    // Read context: check row below first, then above
    let refRow = null;
    let refSource = '';
    if (row + 1 < state.rows && state.stitchGrid[row + 1]) {
        const hasData = state.stitchGrid[row + 1].slice(minC, maxC + 1).some(s => s !== null);
        if (hasData) { refRow = row + 1; refSource = 'below'; }
    }
    if (refRow === null && row - 1 >= 0 && state.stitchGrid[row - 1]) {
        const hasData = state.stitchGrid[row - 1].slice(minC, maxC + 1).some(s => s !== null);
        if (hasData) { refRow = row - 1; refSource = 'above'; }
    }

    if (refRow === null) {
        showToast('Fill in K/P stitches on the row above or below first');
        clearCableDrag();
        return;
    }

    // Detect clusters from the reference row
    const clusters = detectClusters(state.stitchGrid[refRow], minC, maxC);

    // Compute expected result
    const expectedResult = computeCrossResult(clusters, dir);

    // Store the crossing
    const id = 'x' + (++crossIdCounter);
    for (let c = minC; c <= maxC; c++) {
        if (!state.stitchGrid[row]) continue;
        state.stitchGrid[row][c] = {
            type: 'cross',
            dir: dir,
            width: width,
            pos: c - minC,
            id: id,
            clusters: clusters,
        };
    }

    // Auto-populate the other side of the crossing with the expected result
    const otherRow = (refSource === 'below') ? row - 1 : row + 1;
    if (otherRow >= 0 && otherRow < state.rows && state.stitchGrid[otherRow]) {
        const otherHasData = state.stitchGrid[otherRow].slice(minC, maxC + 1).some(s => s !== null);
        if (otherHasData) {
            // Row already has data — check if it matches expected
            const actual = [];
            for (let c = minC; c <= maxC; c++) {
                const s = state.stitchGrid[otherRow][c];
                actual.push(s === 'purl' ? 'purl' : 'knit');
            }
            const matches = expectedResult.every((st, i) => st === actual[i]);
            if (!matches) {
                const expectedStr = expectedResult.map(s => s === 'knit' ? 'K' : 'P').join('');
                const actualStr = actual.map(s => s === 'knit' ? 'K' : 'P').join('');
                showToast(`Row ${refSource === 'below' ? 'above' : 'below'} is ${actualStr}, expected ${expectedStr}. Intentional?`);
            }
        } else {
            // Row is empty — auto-populate with expected result
            for (let i = 0; i < expectedResult.length; i++) {
                state.stitchGrid[otherRow][minC + i] = expectedResult[i]; // 'knit' or 'purl'
            }
        }
    }

    clearCableDrag();
    renderStitchOverlay();
    pushHistory();
}

function clearCableDrag() {
    state.cableDragStart = null;
    state.cableDragEnd = null;
    GridView.clearCableGhost();
}

// ========================================
// MULTI-CELL USER STITCH PLACEMENT
// ========================================
// User-defined stitches with multiCell=true behave like cable crosses for
// placement: the user click+drags across 2..8 cells. The icon paints once
// at the lead cell (left-of-centre for even widths, exact centre for odd)
// and faintly on every flanking cell so the run still reads as an occupied
// block. Each placement gets a unique group id so the eraser can clear the
// whole run and the instructions can collapse it to a single-token run.
let userMultiIdCounter = 0;
function commitUserMulti() {
    if (!state.cableDragStart || !state.cableDragEnd) {
        clearCableDrag();
        return;
    }

    const row = state.cableDragStart.row;
    const minC = Math.min(state.cableDragStart.col, state.cableDragEnd.col);
    const maxC = Math.max(state.cableDragStart.col, state.cableDragEnd.col);
    const width = maxC - minC + 1;

    if (width < 2) {
        showToast('Multi-cell stitches need at least two cells — click and drag.');
        clearCableDrag();
        return;
    }

    const stitchId = state.activeStitch;
    const def = StitchRegistry.get(stitchId);
    if (!def) { clearCableDrag(); return; }

    const lead = Math.floor((width - 1) / 2);
    const groupId = 'um' + (++userMultiIdCounter);
    if (state.stitchGrid[row]) {
        for (let c = minC; c <= maxC; c++) {
            state.stitchGrid[row][c] = {
                type: 'user-multi',
                stitchId,
                id: groupId,
                width,
                pos: c - minC,
                lead,
            };
        }
    }

    clearCableDrag();
    renderStitchOverlay();
    pushHistory();
}

// ========================================
// STITCH OVERLAY RENDERING
// ========================================
function renderStitchOverlay() {
    const canvas = document.getElementById('stitch-overlay');
    if (!canvas) return;
    const container = document.getElementById('grid-container');
    if (!container) return;

    // Pull dimensions from GridView instead of reading DOM cells (there
    // are none anymore — the grid is canvas-backed).
    const cellSize = GridView.getCellSize();
    const gap = GridView.getGap();
    const gridW = container.clientWidth;
    const gridH = container.clientHeight;
    if (!gridW || !gridH) return;

    const balanceMargin = 24; // extra space for row balance indicators
    canvas.width = gridW + balanceMargin;
    canvas.height = gridH;
    canvas.style.width = (gridW + balanceMargin) + 'px';
    canvas.style.height = gridH + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cellW = cellSize;
    const cellH = cellSize;
    const stepX = cellW + gap;
    const stepY = cellH + gap;

    const drawnCrossings = new Set();

    for (let r = 0; r < state.rows; r++) {
        if (!state.stitchGrid[r]) continue;
        for (let c = 0; c < state.cols; c++) {
            const stitch = state.stitchGrid[r][c];
            if (!stitch) continue;

            const x = c * stepX;
            const y = r * stepY;

            if (typeof stitch === 'object') {
                if (stitch.type === 'user-multi') {
                    // Render the multi-cell run once: lead cell full opacity,
                    // flanks at low alpha as visual "occupied" markers.
                    if (!drawnCrossings.has(stitch.id)) {
                        drawnCrossings.add(stitch.id);
                        const def = StitchRegistry.get(stitch.stitchId);
                        if (def && typeof def.drawCell === 'function') {
                            const startCol = c - stitch.pos;
                            for (let p = 0; p < stitch.width; p++) {
                                const cellX = (startCol + p) * stepX;
                                ctx.save();
                                if (p !== stitch.lead) ctx.globalAlpha = 0.18;
                                def.drawCell(ctx, cellX, y, cellW, cellH);
                                ctx.restore();
                            }
                        }
                    }
                } else if (!drawnCrossings.has(stitch.id)) {
                    // Cluster-aware crossing
                    drawnCrossings.add(stitch.id);
                    const startX = (c - stitch.pos) * stepX;
                    drawCrossingOverlay(ctx, startX, y, cellW, cellH, stitch, gap);
                }
            } else {
                const def = StitchRegistry.get(stitch);
                if (def && typeof def.drawCell === 'function') {
                    def.drawCell(ctx, x, y, cellW, cellH);
                }
            }
        }
    }

    // (Row YO-count indicator removed — it overlapped the right-side row
    // numbers. May return as part of a richer per-row stitch counter.)
}


// (per-cell overlay draw funcs for simple stitches live in js/stitches.js)

// ========================================
// UNIFIED CROSSING RENDERER
// ========================================
// Reads cluster data from the stitch object to determine
// which strands are K (bright) and which are P (dim),
// and how they rearrange.
function drawCrossingOverlay(ctx, ox, oy, cellW, cellH, stitch, gap) {
    const { width, dir, clusters } = stitch;
    const totalW = width * cellW + (width - 1) * gap;
    ctx.fillStyle = STITCH_COLORS.paperShade;
    ctx.fillRect(ox, oy, totalW, cellH);

    const stepX = cellW + gap;
    const lw = Math.max(2, cellW * 0.16);
    ctx.lineCap = 'round';

    if (!clusters || clusters.length === 0) return;

    // Build per-stitch source type and destination map
    const stitchTypes = []; // 'knit' or 'purl' for each position
    clusters.forEach(cl => {
        for (let i = 0; i < cl.count; i++) stitchTypes.push(cl.st);
    });

    // Build destination map based on cluster structure
    const destMap = new Array(width);
    const frontMap = new Array(width); // true = this strand is in front

    // RULES (reading L to R on grid):
    // Right X: left group moves RIGHT (is front/bright), right group moves left (back/dim)
    // Left X: right group moves LEFT (is front/bright), left group moves right (back/dim)
    // The front strand is always the group that's physically travelling.

    if (clusters.length === 1) {
        // All same type: split in half
        const half = Math.floor(width / 2);
        const isOdd = width % 2 === 1;
        const centerIdx = isOdd ? half : -1;

        for (let i = 0; i < width; i++) {
            if (isOdd && i === centerIdx) {
                destMap[i] = i; // center stays
                frontMap[i] = false;
            } else if (i < half) {
                // Left half moves to right side
                destMap[i] = isOdd ? i + half + 1 : i + half;
                frontMap[i] = (dir === 'right'); // Right X: left group is front
            } else {
                // Right half moves to left side
                const rightStart = isOdd ? half + 1 : half;
                destMap[i] = i - rightStart;
                frontMap[i] = (dir === 'left'); // Left X: right group is front
            }
        }
    } else if (clusters.length === 2) {
        // Two clusters: swap them as groups
        const leftSize = clusters[0].count;

        for (let i = 0; i < width; i++) {
            if (i < leftSize) {
                destMap[i] = i + (width - leftSize); // left group → right side
                frontMap[i] = (dir === 'right'); // Right X: left group is front
            } else {
                destMap[i] = i - leftSize; // right group → left side
                frontMap[i] = (dir === 'left'); // Left X: right group is front
            }
        }
    } else if (clusters.length === 3) {
        // Three clusters (symmetric): outer two swap, center stays
        const leftSize = clusters[0].count;
        const centerSize = clusters[1].count;
        const rightSize = clusters[2].count;

        let pos = 0;
        // Left group moves to right side
        for (let i = 0; i < leftSize; i++) {
            destMap[pos] = leftSize + centerSize + i;
            frontMap[pos] = (dir === 'right'); // Right X: left group is front
            pos++;
        }
        // Center group stays
        for (let i = 0; i < centerSize; i++) {
            destMap[pos] = leftSize + i;
            frontMap[pos] = false;
            pos++;
        }
        // Right group moves to left side
        for (let i = 0; i < rightSize; i++) {
            destMap[pos] = i;
            frontMap[pos] = (dir === 'left'); // Left X: right group is front
            pos++;
        }
    } else {
        // Fallback: reverse
        for (let i = 0; i < width; i++) {
            destMap[i] = width - 1 - i;
            frontMap[i] = (i < Math.floor(width / 2)) ? (dir === 'right') : (dir === 'left');
        }
    }

    // Draw in 3 passes: back strands, gap, front strands
    // Bezier goes from DESTINATION (top) to SOURCE (bottom)
    // so that reading bottom-up, the strand goes from source → destination
    // matching the knitting chart convention.

    // Pass 1: back strands (always dim)
    for (let i = 0; i < width; i++) {
        if (frontMap[i]) continue;
        if (destMap[i] === i) continue;
        const topX = ox + (destMap[i] + 0.5) * stepX - gap * 0.5;  // destination at top
        const botX = ox + (i + 0.5) * stepX - gap * 0.5;            // source at bottom
        ctx.strokeStyle = STITCH_COLORS.yarnBack;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(topX, oy);
        ctx.bezierCurveTo(topX, oy + cellH * 0.4, botX, oy + cellH * 0.6, botX, oy + cellH);
        ctx.stroke();
    }

    // Pass 2: gap for front strands
    for (let i = 0; i < width; i++) {
        if (!frontMap[i]) continue;
        const topX = ox + (destMap[i] + 0.5) * stepX - gap * 0.5;
        const botX = ox + (i + 0.5) * stepX - gap * 0.5;
        ctx.strokeStyle = STITCH_COLORS.bg;
        ctx.lineWidth = lw + 4;
        ctx.beginPath();
        ctx.moveTo(topX, oy);
        ctx.bezierCurveTo(topX, oy + cellH * 0.4, botX, oy + cellH * 0.6, botX, oy + cellH);
        ctx.stroke();
    }

    // Pass 3: front strands (always bright)
    for (let i = 0; i < width; i++) {
        if (!frontMap[i]) continue;
        const topX = ox + (destMap[i] + 0.5) * stepX - gap * 0.5;
        const botX = ox + (i + 0.5) * stepX - gap * 0.5;
        ctx.strokeStyle = STITCH_COLORS.yarnFront;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(topX, oy);
        ctx.bezierCurveTo(topX, oy + cellH * 0.4, botX, oy + cellH * 0.6, botX, oy + cellH);
        ctx.stroke();
    }

    // Draw center stitches that don't move (3-cluster case)
    for (let i = 0; i < width; i++) {
        if (destMap[i] !== i) continue;
        if (frontMap[i]) continue;
        const cx = ox + (i + 0.5) * stepX - gap * 0.5;
        if (stitchTypes[i] === 'purl') {
            ctx.strokeStyle = STITCH_COLORS.accent;
            ctx.lineWidth = lw * 0.8;
            ctx.beginPath();
            ctx.moveTo(cx - cellW * 0.15, oy + cellH * 0.5);
            ctx.lineTo(cx + cellW * 0.15, oy + cellH * 0.5);
            ctx.stroke();
        } else {
            // Center knit stitch
            ctx.strokeStyle = STITCH_COLORS.yarn;
            ctx.lineWidth = lw * 0.8;
            ctx.beginPath();
            ctx.moveTo(cx, oy + cellH * 0.15);
            ctx.lineTo(cx, oy + cellH * 0.85);
            ctx.stroke();
        }
    }
}

// When other tools are selected, deselect stitch palette
const origSetTool = setTool;
setTool = function(tool) {
    origSetTool(tool);
    if (tool !== 'stitch') {
        state.activeStitch = null;
        document.querySelectorAll('.stitch-tile').forEach(t => t.classList.remove('active'));
    }
};

// ========================================
// USER-STITCH CONTEXT MENU (right-click Edit / Delete)
// ========================================
function onStitchTileContext(e) {
    const tile = e.target.closest('.stitch-tile');
    if (!tile) return;
    const id = tile.dataset.stitch;
    const def = StitchRegistry.get(id);
    // Only user-defined stitches get a context menu — built-ins are part of
    // the app and the eraser isn't really a stitch.
    if (!def || def.source !== 'user') return;

    e.preventDefault();
    openStitchContextMenu(e.clientX, e.clientY, id);
}

function openStitchContextMenu(x, y, stitchId) {
    const menu = document.getElementById('stitch-context-menu');
    if (!menu) return;
    menu.style.display = 'flex';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.dataset.stitchId = stitchId;

    // If the menu would overflow the viewport, nudge it back inside.
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;

    // Wire the buttons once; close on outside-click / Esc.
    if (!menu.dataset.wired) {
        menu.dataset.wired = '1';
        menu.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const id = menu.dataset.stitchId;
                closeStitchContextMenu();
                if (action === 'edit') {
                    const def = StitchRegistry.get(id);
                    if (def) openStitchEditor(def);
                } else if (action === 'delete') {
                    deleteUserStitch(id);
                }
            });
        });
        document.addEventListener('click', (evt) => {
            if (menu.style.display === 'flex' && !menu.contains(evt.target)) closeStitchContextMenu();
        });
        document.addEventListener('keydown', (evt) => {
            if (evt.key === 'Escape') closeStitchContextMenu();
        });
    }
}

function closeStitchContextMenu() {
    const menu = document.getElementById('stitch-context-menu');
    if (menu) menu.style.display = 'none';
}
