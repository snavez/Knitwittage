// === Sizing math (pure functions) ===
// Helpers for converting between gauge (sts/rows per swatch) and grid cell
// counts. Designed to be reused by #18 (stitch-count calculator), #20
// (garment outline generator), and #21 (recipient profiles) — all of those
// need the same gauge → cell-count plumbing.
//
// Same hybrid pattern as js/grid-math.js: classic-script global in the
// browser, CJS module for tests via the export shim at the bottom.

const CM_PER_INCH = 2.54;

// Predefined swatch sizes. The keys are stable identifiers; if you add
// more, prefer descriptive ones (e.g. 'cm-6', 'in-6') so the UI dropdown
// can map cleanly. `wCm` and `hCm` are always centimetres internally —
// inch entries pre-convert (4in = 10.16cm) so downstream math doesn't
// have to care about the user's chosen units.
const SWATCH_SIZES = {
    'cm-10': { wCm: 10,                hCm: 10,                label: '10 × 10 cm' },
    'in-4':  { wCm: 4 * CM_PER_INCH,   hCm: 4 * CM_PER_INCH,   label: '4 × 4 in (10.16 cm)' },
};

// Convert a value in cm or inches to centimetres (the internal unit).
function toCm(value, unit) {
    if (unit === 'in') return value * CM_PER_INCH;
    return value;
}

// Convert a centimetre value back to the user's unit (for display).
function fromCm(valueCm, unit) {
    if (unit === 'in') return valueCm / CM_PER_INCH;
    return valueCm;
}

// Cells needed for a target dimension (cm) given the gauge.
//   targetCm:        finished piece dimension in cm
//   stitchesInSwatch: gauge (e.g. 20 sts per 10cm)
//   swatchCm:        the dimension the gauge applies to (e.g. 10)
//
// Returns { cells, actualCm, errorCm }:
//   cells:    rounded whole number of cells.
//   actualCm: the dimension that many cells actually produces.
//   errorCm:  actualCm - targetCm. Negative = piece is short of target;
//             positive = piece overshoots.
//
// Defensively returns zeros when the inputs would divide-by-zero or be
// negative — UI code can check `cells > 0` before applying.
function cellsForTargetDim(targetCm, stitchesInSwatch, swatchCm) {
    if (!(targetCm > 0) || !(stitchesInSwatch > 0) || !(swatchCm > 0)) {
        return { cells: 0, actualCm: 0, errorCm: 0 };
    }
    const stsPerCm = stitchesInSwatch / swatchCm;
    const cells = Math.max(1, Math.round(targetCm * stsPerCm));
    const actualCm = cells / stsPerCm;
    return { cells, actualCm, errorCm: actualCm - targetCm };
}

// CommonJS export shim for tests. Browsers ignore this branch.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CM_PER_INCH,
        SWATCH_SIZES,
        toCm,
        fromCm,
        cellsForTargetDim,
    };
}
