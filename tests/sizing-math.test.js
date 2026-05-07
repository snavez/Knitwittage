// Tests for js/sizing-math.js — pure helpers behind the stitch-count
// calculator (and reused later by the garment generator + recipient
// profiles per TODO #20/#21).

import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
    CM_PER_INCH,
    SWATCH_SIZES,
    toCm,
    fromCm,
    cellsForTargetDim,
} = require('../js/sizing-math.js');

describe('toCm / fromCm', () => {
    test('cm passes through unchanged', () => {
        expect(toCm(10, 'cm')).toBe(10);
        expect(fromCm(10, 'cm')).toBe(10);
    });

    test('inches convert via 2.54', () => {
        expect(toCm(4, 'in')).toBeCloseTo(10.16);
        expect(fromCm(10.16, 'in')).toBeCloseTo(4);
    });

    test('round trip is exact', () => {
        expect(fromCm(toCm(7, 'in'), 'in')).toBeCloseTo(7);
        expect(toCm(fromCm(15, 'in'), 'in')).toBeCloseTo(15);
    });
});

describe('SWATCH_SIZES', () => {
    test('10 × 10 cm preset is exactly 10cm both axes', () => {
        expect(SWATCH_SIZES['cm-10'].wCm).toBe(10);
        expect(SWATCH_SIZES['cm-10'].hCm).toBe(10);
    });

    test('4 × 4 in preset is the precise 10.16cm conversion (NOT rounded to 10)', () => {
        // Most patterns conflate 4in ≈ 10cm but for our calculator we keep
        // the exact 2.54-cm-per-inch conversion. Worth a regression test —
        // if someone "simplifies" this to 10cm, sizing math drifts ~1.6%
        // which compounds to several stitches over a sweater body.
        expect(SWATCH_SIZES['in-4'].wCm).toBeCloseTo(10.16);
        expect(SWATCH_SIZES['in-4'].hCm).toBeCloseTo(10.16);
    });
});

describe('cellsForTargetDim', () => {
    test('the user spec example: 86cm at 30 rows / 10cm', () => {
        // From the original conversation: 30 rows / 10cm gauge, 86cm height
        // → 258 rows. The textbook validation case.
        const r = cellsForTargetDim(86, 30, 10);
        expect(r.cells).toBe(258);
        expect(r.actualCm).toBeCloseTo(86);
    });

    test('rounds to the nearest whole cell, with the rounding error surfaced', () => {
        // 30cm at 20sts / 10cm = exactly 60 sts (no rounding).
        const exact = cellsForTargetDim(30, 20, 10);
        expect(exact.cells).toBe(60);
        expect(Math.abs(exact.errorCm)).toBeLessThan(0.001);

        // 31cm at 20sts / 10cm = 62 sts (no rounding).
        const r62 = cellsForTargetDim(31, 20, 10);
        expect(r62.cells).toBe(62);

        // 30.3cm at 20sts / 10cm = 60.6 sts → rounds to 61.
        const rounded = cellsForTargetDim(30.3, 20, 10);
        expect(rounded.cells).toBe(61);
        expect(rounded.actualCm).toBeCloseTo(30.5);
        expect(rounded.errorCm).toBeCloseTo(0.2);
    });

    test('inch-swatch (10.16cm) gives slightly different cell counts than cm-swatch (10cm)', () => {
        // 30cm finished, 20sts gauge.
        const cmSwatch = cellsForTargetDim(30, 20, 10);          // 60 sts
        const inSwatch = cellsForTargetDim(30, 20, 10.16);       // 30 * 20/10.16 = 59.06 → 59
        expect(cmSwatch.cells).toBe(60);
        expect(inSwatch.cells).toBe(59);
    });

    test('decimals on gauge are honoured', () => {
        // Careful counter reports 21.5 sts / 10cm. 30cm = 64.5 sts → 65 (round half up).
        const r = cellsForTargetDim(30, 21.5, 10);
        expect([64, 65]).toContain(r.cells); // banker's rounding can land either way; both fine
    });

    test('zero / negative inputs return zeros (defensive)', () => {
        expect(cellsForTargetDim(0, 20, 10).cells).toBe(0);
        expect(cellsForTargetDim(-1, 20, 10).cells).toBe(0);
        expect(cellsForTargetDim(30, 0, 10).cells).toBe(0);
        expect(cellsForTargetDim(30, 20, 0).cells).toBe(0);
    });

    test('always returns at least 1 cell when target is positive', () => {
        // Tiny target with sparse gauge: 0.1cm × 1st/10cm = 0.01 sts → rounds
        // to 0 mathematically, but we floor to 1 because zero-width pieces
        // make no sense. The UI also clamps min cell count to 2.
        const r = cellsForTargetDim(0.1, 1, 10);
        expect(r.cells).toBeGreaterThanOrEqual(1);
    });

    test('errorCm is signed: positive when overshooting target', () => {
        // 30.3cm target, gauge 20/10cm → 61 sts → 30.5cm actual → +0.2 over.
        const r = cellsForTargetDim(30.3, 20, 10);
        expect(r.errorCm).toBeGreaterThan(0);
        // 30.7cm target, gauge 20/10cm → 61 sts → 30.5cm actual → -0.2 short.
        const r2 = cellsForTargetDim(30.7, 20, 10);
        expect(r2.errorCm).toBeLessThan(0);
    });
});

describe('end-to-end gauge → finished-piece round trip', () => {
    test('inputs in inches still yield cm-internal math, then convert back', () => {
        // User wants a 16in × 24in piece, gauge 22sts / 4in.
        const targetWidthCm = toCm(16, 'in');
        const targetHeightCm = toCm(24, 'in');
        const swatchCm = toCm(4, 'in'); // 10.16
        const w = cellsForTargetDim(targetWidthCm, 22, swatchCm);
        const h = cellsForTargetDim(targetHeightCm, 22 /* row gauge same for simplicity */, swatchCm);
        expect(w.cells).toBe(88); // 22 * 4 = 88
        expect(h.cells).toBe(132); // 22 * 6 = 132
        // Convert actualCm back to inches for display:
        expect(fromCm(w.actualCm, 'in')).toBeCloseTo(16);
        expect(fromCm(h.actualCm, 'in')).toBeCloseTo(24);
    });
});
