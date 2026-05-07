// === Grid math (pure functions) ===
// Parameter-driven helpers for the grid section. No DOM, no `state` reads —
// pure functions only. Same file is loaded by index.html as a classic script
// (defines globals) AND by Vitest as a CommonJS module (via the export shim
// at the bottom). When you change anything here, also update tests in
// tests/grid-math.test.js — that's the safety net these helpers exist for.
//
// Constants kept in lockstep with their DOM-side equivalents:
//   - GRID_CELL_BASE: matches CSS --cell-base (22px).
//   - GRID_GAP_PX:    matches CSS --cell-gap (1px), the gridline thickness.
//   - GRID_CANVAS_LIMIT_PX: ceiling on a single canvas dimension. Most
//                            browsers cap an HTMLCanvasElement at ~16 384px
//                            (Safari/iOS) or ~32 767px (Chrome/Firefox on
//                            desktop). At 1000×1000 with cells at the
//                            default 22px the canvas would need to be
//                            ~23 000px — this constant is the trade-off
//                            between letting big grids reach a comfortable
//                            zoom and keeping per-canvas GPU memory under
//                            ~2GB. Bump down to 16 000 if users on integrated
//                            GPUs or iOS report white-outs at high zoom.
//   - GRID_HISTORY_BASE: how many undo snapshots a "small" grid gets;
//                         scaled down for big grids by effectiveMaxHistory.
const GRID_CELL_BASE = 22;
const GRID_GAP_PX = 1;
const GRID_CANVAS_LIMIT_PX = 22000;
const GRID_HISTORY_BASE = 50;
const GRID_HISTORY_MIN = 5;
const GRID_HISTORY_TARGET_MEM_CELLS = 3_000_000;

// Stride between visible labels along an axis. Always returns ODD values
// (1, 3, 5, 9, 15, 25, …) so flat-mode rail splits don't lose one parity:
// with stride = 10 the labelled rows are 10, 20, 30, … — all EVEN, which
// in flat-RS mode leaves the right rail (odd RS rows) blank except the
// forced row-1 anchor. Odd-only strides guarantee both rails populate.
//
// Label width estimate: ~7px per monospace digit + 6px breathing room.
function labelStride(cellPx, totalCells) {
    const digits = String(totalCells || 1).length;
    const labelWidth = digits * 7 + 6;
    if (cellPx >= labelWidth)        return 1;
    if (cellPx * 3 >= labelWidth)    return 3;
    if (cellPx * 5 >= labelWidth)    return 5;
    if (cellPx * 9 >= labelWidth)    return 9;
    if (cellPx * 15 >= labelWidth)   return 15;
    if (cellPx * 25 >= labelWidth)   return 25;
    let s = Math.max(1, Math.ceil(labelWidth / cellPx));
    if (s % 2 === 0) s += 1;
    return s;
}

// Maximum zoom for a given grid size that keeps the canvas under
// GRID_CANVAS_LIMIT_PX on its larger axis. Below this and the canvas would
// silently fail to draw on Safari/iOS (the white-out bug).
//
// step = round(CELL_BASE * zoom) + GAP_PX. Solve N * step ≤ limit.
//
// Named with the "For" suffix so it doesn't shadow the state-aware
// app.js wrapper `maxZoomForCurrentGrid()`.
function maxZoomForGridSize(rows, cols, opts) {
    const o = opts || {};
    const limit = o.limitPx || GRID_CANVAS_LIMIT_PX;
    const cellBase = o.cellBase || GRID_CELL_BASE;
    const gap = o.gapPx != null ? o.gapPx : GRID_GAP_PX;
    const N = Math.max(rows || 1, cols || 1);
    if (N <= 1) return Infinity;
    return Math.max(0, (limit / N - gap) / cellBase);
}

// Adaptive undo cap: target ~50MB total memory (≈3M cell-equivalents) so
// 1000×1000 ends up at ~5 levels rather than 50× full snapshots OOMing the
// browser. 200×200 still gets the full base cap (50).
//
// Named with the "For" suffix so it doesn't shadow the state-aware
// app.js wrapper `effectiveMaxHistory()`.
function effectiveMaxHistoryFor(rows, cols, opts) {
    const o = opts || {};
    const base = o.baseCap || GRID_HISTORY_BASE;
    const min = o.minCap || GRID_HISTORY_MIN;
    const target = o.targetCells || GRID_HISTORY_TARGET_MEM_CELLS;
    const cells = (rows || 1) * (cols || 1);
    return Math.max(min, Math.min(base, Math.floor(target / cells)));
}

// Pull-to-centre scroll delta. Given the cursor's CHART-CANVAS-relative
// position before zoom (`chartX`, `chartY`) and the cellPx before/after, plus
// the canvas's client-coords position after redraw, compute how much
// scrollLeft/Top must change so the same chart cell ends up at the viewport
// centre. Scaling is by chart-WIDTH ratio (not cellPx ratio) because the
// per-cell gap is constant — see the comment on the bug in commit fdbce81.
function computePullToCentreScroll(args) {
    const {
        chartX, chartY,
        oldCellPx, newCellPx,
        cols, rows,
        canvasLeftAfter, canvasTopAfter,
        viewportCentreX, viewportCentreY,
        gapPx,
    } = args;
    const gp = gapPx != null ? gapPx : GRID_GAP_PX;
    const oldChartW = (cols || 1) * (oldCellPx + gp) - gp;
    const newChartW = (cols || 1) * (newCellPx + gp) - gp;
    const oldChartH = (rows || 1) * (oldCellPx + gp) - gp;
    const newChartH = (rows || 1) * (newCellPx + gp) - gp;
    const ratioX = oldChartW > 0 ? newChartW / oldChartW : 1;
    const ratioY = oldChartH > 0 ? newChartH / oldChartH : 1;
    const cellNowX = canvasLeftAfter + chartX * ratioX;
    const cellNowY = canvasTopAfter + chartY * ratioY;
    return {
        scrollDeltaX: cellNowX - viewportCentreX,
        scrollDeltaY: cellNowY - viewportCentreY,
    };
}

// Normalise a selection rect from {startRow, startCol, endRow, endCol} to
// {minR, maxR, minC, maxC}. Returns null when the input is null/empty.
// Pure: takes the selection object explicitly so tests don't need state.
function normalizeSelectionRect(sel) {
    if (!sel) return null;
    const { startRow, startCol, endRow, endCol } = sel;
    if (startRow == null || startCol == null) return null;
    return {
        minR: Math.min(startRow, endRow),
        maxR: Math.max(startRow, endRow),
        minC: Math.min(startCol, endCol),
        maxC: Math.max(startCol, endCol),
    };
}

// Whether a pasting (clipRows × clipCols) clipboard at anchor (row, col)
// would overflow the grid. Used by the paste-ghost preview to detect
// edge-clipping. Returns the visible rect ({minR, maxR, minC, maxC}) or null
// if no cell of the paste would land inside the grid.
function clipPasteToGrid(anchorRow, anchorCol, clipRows, clipCols, gridRows, gridCols) {
    const minR = Math.max(0, anchorRow);
    const maxR = Math.min(gridRows - 1, anchorRow + clipRows - 1);
    const minC = Math.max(0, anchorCol);
    const maxC = Math.min(gridCols - 1, anchorCol + clipCols - 1);
    if (minR > maxR || minC > maxC) return null;
    return { minR, maxR, minC, maxC };
}

// CommonJS export shim for tests. Browsers ignore this branch (no module
// global). Vitest reads us as a CJS module and pulls these names off.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        GRID_CELL_BASE, GRID_GAP_PX, GRID_CANVAS_LIMIT_PX,
        GRID_HISTORY_BASE, GRID_HISTORY_MIN, GRID_HISTORY_TARGET_MEM_CELLS,
        labelStride,
        maxZoomForGridSize,
        effectiveMaxHistoryFor,
        computePullToCentreScroll,
        normalizeSelectionRect,
        clipPasteToGrid,
    };
}
