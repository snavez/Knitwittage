// Tests for js/grid-math.js — the pure-math layer of the grid section.
// Run with `npm test`. Each describe block targets one helper; assertions
// document the invariants that have bitten us in the past so a regression
// fails the build.
//
// grid-math.js is a hybrid module: classic script for the browser, CJS for
// Node. Vitest enters via ESM, so we go through createRequire to load the
// CJS exports.

import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
    labelStride,
    maxZoomForGridSize,
    effectiveMaxHistoryFor,
    computePullToCentreScroll,
    normalizeSelectionRect,
    clipPasteToGrid,
    GRID_CANVAS_LIMIT_PX,
    GRID_CELL_BASE,
} = require('../js/grid-math.js');

describe('labelStride', () => {
    test('every label visible when cells are at least as wide as a label', () => {
        // 2-digit label ≈ 2*7+6 = 20px wide. cellPx 22 fits.
        expect(labelStride(22, 20)).toBe(1);
        expect(labelStride(22, 99)).toBe(1);
    });

    test('skips to stride 3 when cells get tighter', () => {
        // 3-digit label = 27px. cellPx*3 = 30 ≥ 27.
        expect(labelStride(10, 100)).toBe(3);
    });

    test('larger jumps as cells shrink', () => {
        // 4-digit at smallish cells — stride 5 / 9 / 15 / 25 cascade.
        expect(labelStride(7, 1000)).toBe(5);
        expect(labelStride(4, 1000)).toBe(9);
    });

    test('always returns ODD strides — flat-mode rail parity invariant', () => {
        // The bug: with even stride (e.g. 10), labelled rows are 10, 20, 30…
        // — all even — and flat-RS mode leaves the right (odd RS) rail blank.
        // Sweep cellPx and totalCells; every stride must be odd.
        for (const cellPx of [2, 3, 5, 7, 10, 14, 20, 30]) {
            for (const N of [10, 50, 100, 500, 1000]) {
                const s = labelStride(cellPx, N);
                expect(s % 2 === 1, `cellPx=${cellPx} N=${N} stride=${s}`).toBe(true);
            }
        }
    });

    test('reproduces the exact 1000×1000 @ 29% zoom right-rail bug', () => {
        // cellPx = round(22 * 0.29) = 6. Pre-fix this returned 10 (even).
        const stride = labelStride(6, 1000);
        expect(stride).toBe(9); // odd — both rails populate
    });
});

describe('maxZoomForGridSize', () => {
    test('canvas limit honoured for big grids', () => {
        // At 1000 cells: step ≤ limit / N → zoom ≤ (limit/N - 1) / 22.
        const z = maxZoomForGridSize(1000, 1000);
        const cellPx = Math.round(GRID_CELL_BASE * z);
        const canvasPx = 1000 * cellPx + 999; // step = cellPx + 1, gaps between
        expect(canvasPx).toBeLessThanOrEqual(GRID_CANVAS_LIMIT_PX);
    });

    test('small grids reach a high zoom (no canvas-size pressure)', () => {
        // 20×20 at zoom 1 = 440px canvas — far below the limit. Pure helper
        // doesn't apply ZOOM_MAX (that's the app's job); it returns the raw
        // canvas-bounded ceiling.
        const z = maxZoomForGridSize(20, 20);
        expect(z).toBeGreaterThan(30); // way above app's ZOOM_MAX of 1.0
    });

    test('symmetric in rows/cols — uses larger axis', () => {
        // A 1000-row × 30-col chart hits the same cap as 30×1000.
        expect(maxZoomForGridSize(1000, 30)).toBeCloseTo(maxZoomForGridSize(30, 1000));
    });

    test('honours custom limit', () => {
        const z = maxZoomForGridSize(500, 500, { limitPx: 8000 });
        const cellPx = Math.round(GRID_CELL_BASE * z);
        expect(500 * cellPx + 499).toBeLessThanOrEqual(8000);
    });
});

describe('effectiveMaxHistoryFor', () => {
    test('small grids get the full base cap', () => {
        expect(effectiveMaxHistoryFor(20, 20)).toBe(50);
        expect(effectiveMaxHistoryFor(100, 100)).toBe(50);
    });

    test('500×500 lands in the middle band', () => {
        const cap = effectiveMaxHistoryFor(500, 500);
        expect(cap).toBe(12); // 3M / 250k = 12
    });

    test('1000×1000 hits the floor', () => {
        const cap = effectiveMaxHistoryFor(1000, 1000);
        expect(cap).toBe(5); // floor(3M / 1M) = 3, but min cap is 5
    });

    test('never returns less than the min cap', () => {
        // Pathological huge grid still gets at least 5 levels of undo.
        expect(effectiveMaxHistoryFor(10000, 10000)).toBe(5);
    });

    test('respects custom base + min', () => {
        expect(effectiveMaxHistoryFor(20, 20, { baseCap: 10 })).toBe(10);
        expect(effectiveMaxHistoryFor(2000, 2000, { minCap: 2 })).toBe(2);
    });
});

describe('computePullToCentreScroll', () => {
    test('zero deltas when cell is already at viewport centre', () => {
        // Cursor on the cell, cell already at viewport centre, zoom step 1.0×
        // (no change) — scroll deltas are zero.
        const r = computePullToCentreScroll({
            chartX: 1000, chartY: 500,
            oldCellPx: 11, newCellPx: 11,
            cols: 100, rows: 50,
            canvasLeftAfter: 100, canvasTopAfter: 100,
            viewportCentreX: 1100, viewportCentreY: 600,
        });
        expect(r.scrollDeltaX).toBeCloseTo(0);
        expect(r.scrollDeltaY).toBeCloseTo(0);
    });

    test('one zoom step lands the cell exactly at viewport centre — the math fix', () => {
        // Reproduces the user's scenario: 1000×1000 chart, zoom from cellPx 11
        // (zoom 0.5) to cellPx 13 (zoom ~0.575), cursor on cell at (col 570,
        // row 350). Pre-fix this overshot by ~100px. Now: exact.
        //
        // Cell's chart-relative position before zoom:
        const oldCellPx = 11;
        const newCellPx = 13;
        const col = 570, row = 350;
        const chartX = col * (oldCellPx + 1) + oldCellPx / 2;
        const chartY = row * (oldCellPx + 1) + oldCellPx / 2;

        // Place the canvas wherever; whatever scroll delta we get should
        // bring the same cell to viewport centre.
        const canvasLeftAfter = -5000;
        const canvasTopAfter = -3000;
        const viewportCentreX = 700;
        const viewportCentreY = 600;

        const { scrollDeltaX, scrollDeltaY } = computePullToCentreScroll({
            chartX, chartY,
            oldCellPx, newCellPx,
            cols: 1000, rows: 1000,
            canvasLeftAfter, canvasTopAfter,
            viewportCentreX, viewportCentreY,
        });

        // Apply the delta: cell's NEW client position should be the centre.
        const newCanvasLeft = canvasLeftAfter - scrollDeltaX;
        const newCanvasTop = canvasTopAfter - scrollDeltaY;
        const newCellX = newCanvasLeft + col * (newCellPx + 1) + newCellPx / 2;
        const newCellY = newCanvasTop + row * (newCellPx + 1) + newCellPx / 2;
        expect(newCellX).toBeCloseTo(viewportCentreX, 1);
        expect(newCellY).toBeCloseTo(viewportCentreY, 1);
    });

    test('repeated zoom steps converge — no oscillation', () => {
        // Simulate: keep cursor on the same cell, zoom in 4 times. The cell
        // should stay at viewport centre throughout (no drift, no swap).
        let canvasLeft = -5000, canvasTop = -3000;
        const viewportCentreX = 700, viewportCentreY = 600;
        const col = 570, row = 350;
        let cellPx = 11;
        for (let step = 0; step < 4; step++) {
            const oldCellPx = cellPx;
            // Compute cursor's chart position (it's on the cell)
            const chartX = col * (oldCellPx + 1) + oldCellPx / 2;
            const chartY = row * (oldCellPx + 1) + oldCellPx / 2;
            const newCellPx = oldCellPx + 1; // small zoom
            const { scrollDeltaX, scrollDeltaY } = computePullToCentreScroll({
                chartX, chartY,
                oldCellPx, newCellPx,
                cols: 1000, rows: 1000,
                canvasLeftAfter: canvasLeft,
                canvasTopAfter: canvasTop,
                viewportCentreX, viewportCentreY,
            });
            canvasLeft -= scrollDeltaX;
            canvasTop -= scrollDeltaY;
            cellPx = newCellPx;
            // After this step, cell at (col, row) should be at viewport centre.
            const cellX = canvasLeft + col * (cellPx + 1) + cellPx / 2;
            const cellY = canvasTop + row * (cellPx + 1) + cellPx / 2;
            expect(cellX, `step ${step} X drifted`).toBeCloseTo(viewportCentreX, 1);
            expect(cellY, `step ${step} Y drifted`).toBeCloseTo(viewportCentreY, 1);
        }
    });
});

describe('normalizeSelectionRect', () => {
    test('null in → null out', () => {
        expect(normalizeSelectionRect(null)).toBeNull();
    });

    test('orders coords regardless of drag direction', () => {
        const r1 = normalizeSelectionRect({ startRow: 5, startCol: 10, endRow: 2, endCol: 3 });
        expect(r1).toEqual({ minR: 2, maxR: 5, minC: 3, maxC: 10 });
        const r2 = normalizeSelectionRect({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
        expect(r2).toEqual({ minR: 0, maxR: 0, minC: 0, maxC: 0 });
    });
});

describe('clipPasteToGrid', () => {
    test('inside a 10×10 grid, a 3×3 paste at (5,5) stays whole', () => {
        expect(clipPasteToGrid(5, 5, 3, 3, 10, 10)).toEqual({ minR: 5, maxR: 7, minC: 5, maxC: 7 });
    });

    test('paste off the right edge clips', () => {
        expect(clipPasteToGrid(0, 8, 3, 3, 10, 10)).toEqual({ minR: 0, maxR: 2, minC: 8, maxC: 9 });
    });

    test('paste entirely outside the grid → null', () => {
        expect(clipPasteToGrid(20, 20, 3, 3, 10, 10)).toBeNull();
    });

    test('paste anchored at negative offset still clips into the grid', () => {
        expect(clipPasteToGrid(-1, -1, 3, 3, 10, 10)).toEqual({ minR: 0, maxR: 1, minC: 0, maxC: 1 });
    });
});
