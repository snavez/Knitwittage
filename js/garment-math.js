// === Garment outline math (pure functions) ===
// Generates no-stitch masks for garment pieces (jumper front/back/sleeve).
// All inputs in centimetres; the UI layer (garment.js) handles unit
// conversion via toCm()/fromCm() from sizing-math.js.
//
// Same hybrid pattern as grid-math.js / sizing-math.js: classic-script
// global in the browser, CJS module for tests via the export shim.

const GARMENT_EASE = {
    slim:     { chest: 2,  upperArm: 2,  wrist: 1 },
    standard: { chest: 8,  upperArm: 5,  wrist: 2 },
    loose:    { chest: 15, upperArm: 8,  wrist: 3 },
};

const GARMENT_NECK = {
    crew:  { frontDepthCm: 7,  backDepthCm: 2, widthFrac: 0.35 },
    vneck: { frontDepthCm: 10, backDepthCm: 2, widthFrac: 0.30 },
    scoop: { frontDepthCm: 10, backDepthCm: 2, widthFrac: 0.45 },
};

const GARMENT_DEFAULTS_CM = {
    chest: 92,
    bodyLength: 62,
    shoulderWidth: 40,
    upperArm: 30,
    wristCirc: 17,
    armLength: 45,
};

function deriveArmholeDepthCm(chestWithEaseCm) {
    return chestWithEaseCm / 8 + 7;
}

// ── Main entry point ────────────────────────────────────────────────
// piece:   'back' | 'front' | 'sleeve'
// measCm:  { chest, bodyLength, shoulderWidth, upperArm, wristCirc, armLength }
// gauge:   { stsPer10cm, rowsPer10cm }
// opts:    { fit: 'slim'|'standard'|'loose', neck: 'crew'|'vneck'|'scoop' }
//
// Returns { rows, cols, mask: boolean[][], summary: {} }
//   mask[r][c] = true  → no-stitch (outside the fabric outline)
//   Row 0 = top of chart (shoulders / cap)
//   Row [rows-1] = bottom of chart (hem / cuff / cast-on edge)

function generateJumperPiece(piece, measCm, gauge, opts) {
    if (piece === 'sleeve') return generateSleeve(measCm, gauge, opts);
    return generateBodyPanel(piece, measCm, gauge, opts);
}

// ── Body panel (front or back) ──────────────────────────────────────

function generateBodyPanel(piece, measCm, gauge, opts) {
    const ease = GARMENT_EASE[opts.fit || 'standard'];
    const neck = GARMENT_NECK[opts.neck || 'crew'];
    const stsPerCm = gauge.stsPer10cm / 10;
    const rowsPerCm = gauge.rowsPer10cm / 10;

    const halfChestCm = (measCm.chest + ease.chest) / 2;
    const cols = Math.round(halfChestCm * stsPerCm);
    const totalRows = Math.round(measCm.bodyLength * rowsPerCm);

    if (cols < 4 || totalRows < 4) {
        return { rows: Math.max(4, totalRows), cols: Math.max(4, cols),
                 mask: garmentMask(Math.max(4, totalRows), Math.max(4, cols), false),
                 stitchOverlay: null,
                 summary: { pieceName: piece === 'front' ? 'Front' : 'Back' } };
    }

    // ── Armhole ──
    const armholeDepthCm = deriveArmholeDepthCm(measCm.chest + ease.chest);
    const armholeRows = Math.min(Math.round(armholeDepthCm * rowsPerCm), totalRows - 2);
    const bodyRows = totalRows - armholeRows;

    const shoulderWidthSts = Math.round(measCm.shoulderWidth * stsPerCm);
    const armholeDecPerSide = Math.max(0, Math.floor((cols - shoulderWidthSts) / 2));

    const bindOff = Math.max(2, Math.round(armholeDecPerSide * 0.4));
    const gradualDec = Math.max(0, armholeDecPerSide - bindOff);

    // ── Neck ──
    const neckWidthRaw = Math.round(measCm.shoulderWidth * neck.widthFrac * stsPerCm);
    const neckWidthSts = neckWidthRaw + (neckWidthRaw % 2); // even for symmetry
    const neckDepthCm = (piece === 'front') ? neck.frontDepthCm : neck.backDepthCm;
    const neckDepthRows = Math.min(Math.round(neckDepthCm * rowsPerCm), armholeRows);

    // ── Build mask ──
    const mask = garmentMask(totalRows, cols, false);

    // Armhole: margin increases from bottom of armhole zone upward
    for (let r = 0; r < armholeRows && r < totalRows; r++) {
        const fromBottom = armholeRows - 1 - r;
        let margin;
        if (fromBottom < 2) {
            margin = bindOff;
        } else {
            const idx = fromBottom - 2;
            const decs = Math.min(gradualDec, Math.floor(idx / 2) + 1);
            margin = bindOff + decs;
        }
        margin = Math.min(margin, armholeDecPerSide);
        garmentFillMargins(mask, r, cols, margin);
    }

    // Neck: opening widens from bottom of neck zone toward the top.
    // V-neck tapers linearly to a point.
    // Front crew/scoop use a smooth elliptical U-curve.
    // Back neck uses a large center cast-off with gradual 1-st/side/row
    // decreases — the standard flat-knit construction for back necks.
    const neckHalf = Math.floor(neckWidthSts / 2);
    const center = Math.floor(cols / 2);

    for (let r = 0; r < neckDepthRows && r < totalRows; r++) {
        const t = neckDepthRows <= 1 ? 0 : r / (neckDepthRows - 1);
        let hw;
        if (piece === 'front' && opts.neck === 'vneck') {
            // V-neck: linear taper, full width at top → point at bottom
            hw = Math.round(neckHalf * (1 - t));
        } else if (piece === 'back') {
            // Back crew/scoop: large center cast-off, then 1 dec per side
            // per row.  t=0 is the top (full width), t=1 is the bottom
            // (first split row = large center cast-off).
            hw = Math.max(1, neckHalf - Math.round(t * (neckDepthRows - 1)));
        } else {
            // Front crew / scoop: smooth elliptical U-shape
            // sqrt(1 − t²) gives a natural ellipse that rounds at the
            // bottom without any flat/square section.
            const centerHW = Math.max(1, Math.round(neckHalf * 0.12));
            const curve = Math.sqrt(Math.max(0, 1 - t * t));
            hw = Math.max(centerHW, Math.round(neckHalf * curve));
        }
        if (hw > 0) {
            for (let c = center - hw; c < center + hw; c++) {
                if (c >= 0 && c < cols) mask[r][c] = true;
            }
        }
    }

    // ── Stitch overlay (shaping + ribbing) ──────────────────────────
    const shapingOv = generateShapingOverlay(mask, totalRows, cols);
    const ribbingRows = Math.min(opts.ribbingRows || 0, Math.max(0, bodyRows - 2));
    const ribOv = ribbingRows > 0
        ? generateRibbingOverlay(totalRows, cols, mask, opts.ribPattern || 'k1p1',
              totalRows - ribbingRows, totalRows - 1)
        : null;
    const stitchOverlay = mergeOverlays(totalRows, cols, ribOv, shapingOv);

    const shoulderSts = Math.max(0, Math.floor((shoulderWidthSts - neckWidthSts) / 2));

    // Neckband pickup estimate (approximate — knitters adjust to fit)
    const neckPickupSts = neckWidthSts
        + 2 * Math.round(Math.round(neck.frontDepthCm * rowsPerCm) * 0.75)
        + 2 * Math.round(Math.round(neck.backDepthCm  * rowsPerCm) * 0.75);

    return {
        rows: totalRows, cols, mask, stitchOverlay,
        summary: {
            pieceName: piece === 'front' ? 'Front' : 'Back',
            piece,
            neckStyle: opts.neck || 'crew',
            widthCm: Math.round(halfChestCm * 10) / 10,
            castOnSts: cols,
            totalRows,
            armholeDepthCm: Math.round(armholeDepthCm * 10) / 10,
            armholeRows,
            bodyRows,
            armholeDecPerSide,
            neckWidthSts,
            neckDepthRows,
            shoulderSts,
            ribbingRows,
            ribPattern: opts.ribPattern || 'k1p1',
            neckPickupSts,
        }
    };
}

// ── Sleeve ──────────────────────────────────────────────────────────
// Dimensions follow the Sister Mountain method for set-in sleeves:
//   Cap height   = armhole depth − offset (7.5 cm ≤ 117 cm bust, else 10 cm)
//   Initial BO   = matches body-panel armhole bind-off
//   Final BO     = upper-arm circumference / 4 − 0.5 cm
//   Decs / side  = (sts after initial BO − final BO sts) / 2
//
// Cap shape uses a 3-zone bell curve (mirrors real set-in construction):
//   Zone A (bottom, after BO):  steep  — dec every row       ~20 %
//   Zone B (middle):            gentle — dec every N rows     ~60 %
//   Zone C (top, before BO):    steep  — dec every row        ~20 %

function generateSleeve(measCm, gauge, opts) {
    const ease = GARMENT_EASE[opts.fit || 'standard'];
    const stsPerCm = gauge.stsPer10cm / 10;
    const rowsPerCm = gauge.rowsPer10cm / 10;

    const chestWithEaseCm = measCm.chest + ease.chest;
    const upperArmCm = measCm.upperArm + ease.upperArm;
    const wristCm = measCm.wristCirc + ease.wrist;
    const cols = Math.round(upperArmCm * stsPerCm);
    const wristSts = Math.round(wristCm * stsPerCm);

    const armLengthRows = Math.round(measCm.armLength * rowsPerCm);

    // ── Cap dimensions (Sister Mountain) ────────────────────────────
    const armholeDepthCm = deriveArmholeDepthCm(chestWithEaseCm);
    // Sizes ≤ 117 cm (46″) bust: subtract 7.5 cm; larger: subtract 10 cm
    const capOffset = chestWithEaseCm <= 117 ? 7.5 : 10;
    // Round to nearest 0.5 cm per the article's recommendation
    const capHeightCm = Math.max(5,
        Math.round((armholeDepthCm - capOffset) * 2) / 2);
    const capRows = Math.round(capHeightCm * rowsPerCm);
    const totalRows = armLengthRows + capRows;

    if (cols < 4 || totalRows < 4) {
        return { rows: Math.max(4, totalRows), cols: Math.max(4, cols),
                 mask: garmentMask(Math.max(4, totalRows), Math.max(4, cols), false),
                 stitchOverlay: null,
                 summary: { pieceName: 'Sleeve' } };
    }

    // ── Initial bind-off (matches body armhole) ─────────────────────
    // Same calculation as generateBodyPanel so the pieces coordinate.
    const halfChestCm = chestWithEaseCm / 2;
    const bodyCols = Math.round(halfChestCm * stsPerCm);
    const shoulderWidthSts = Math.round(measCm.shoulderWidth * stsPerCm);
    const bodyArmholeDec = Math.max(0,
        Math.floor((bodyCols - shoulderWidthSts) / 2));
    const capInitialBO = Math.max(2, Math.round(bodyArmholeDec * 0.4));

    // ── Final bind-off (upper-arm / 4 − 0.5 cm) ────────────────────
    const finalBOCm = Math.max(2, upperArmCm / 4 - 0.5);
    let finalBOSts = Math.round(finalBOCm * stsPerCm);
    if (finalBOSts % 2 !== 0) finalBOSts++;            // even for symmetry
    const finalBOMargin = Math.floor((cols - finalBOSts) / 2);

    // ── Total decreases per side ────────────────────────────────────
    const stsAfterInitBO = cols - 2 * capInitialBO;
    const decsPerSide = Math.max(0,
        Math.floor((stsAfterInitBO - finalBOSts) / 2));

    // ── 3-zone bell-curve cap shaping ───────────────────────────────
    // Zone A & C (steep, ~30 % each): dec every row — mirrors armhole
    // transition at bottom, rounds the crown at top.
    // Zone B (gentle, ~40 %): evenly distributed through the mid-cap,
    // giving roughly every-other-row decreases for a visible bell shape.
    const zoneADecs = Math.min(decsPerSide,
        Math.max(1, Math.round(decsPerSide * 0.3)));
    const zoneCDecs = Math.min(decsPerSide - zoneADecs,
        Math.max(1, Math.round(decsPerSide * 0.3)));
    const zoneBDecs = Math.max(0, decsPerSide - zoneADecs - zoneCDecs);

    // Row budget: capRows = 2 (init BO) + shaping + 1 (final BO)
    const shapingBudget = Math.max(0, capRows - 3);
    const zoneARows = Math.min(zoneADecs, shapingBudget);
    const zoneCRows = Math.min(zoneCDecs,
        Math.max(0, shapingBudget - zoneARows));
    const zoneBRows = Math.max(0, shapingBudget - zoneARows - zoneCRows);

    // ── Build cap margins (bottom → top) ────────────────────────────
    const margins = [];                       // margins[0] = bottom row
    let m = capInitialBO;

    // Initial bind-off: 2 rows
    margins.push(m);
    margins.push(m);

    // Zone A — steep: 1 decrease per row
    for (let i = 0; i < zoneARows; i++) {
        if (i < zoneADecs) m++;
        margins.push(m);
    }

    // Zone B — gentle: Bresenham-distributed decreases
    if (zoneBRows > 0 && zoneBDecs > 0) {
        for (let i = 0; i < zoneBRows; i++) {
            const before = Math.floor(i * zoneBDecs / zoneBRows);
            const after  = Math.floor((i + 1) * zoneBDecs / zoneBRows);
            if (after > before) m++;
            margins.push(m);
        }
    } else {
        for (let i = 0; i < zoneBRows; i++) margins.push(m);
    }

    // Zone C — steep: 1 decrease per row
    for (let i = 0; i < zoneCRows; i++) {
        if (i < zoneCDecs) m++;
        margins.push(m);
    }

    // Final bind-off: 1 row (snap to exact finalBOMargin)
    margins.push(finalBOMargin);

    // Pad / trim to exactly capRows
    while (margins.length < capRows) margins.push(finalBOMargin);
    margins.length = Math.min(margins.length, capRows);

    // ── Apply cap to mask (reverse: margins[0] → chart row capRows-1) ─
    const mask = garmentMask(totalRows, cols, false);
    for (let r = 0; r < capRows && r < totalRows; r++) {
        const idx = capRows - 1 - r;
        const mg = Math.max(0,
            Math.min(margins[idx], Math.floor(cols / 2) - 1));
        garmentFillMargins(mask, r, cols, mg);
    }

    // ── Arm taper (rows capRows … totalRows-1) ──────────────────────
    // Full width at top (underarm); tapers to wrist at bottom (cast-on).
    // When ribbing is enabled, the bottom ribbingRows are straight at
    // wrist width and increases are distributed over the remaining rows.
    const ribbingRows = Math.min(opts.ribbingRows || 0, Math.max(0, armLengthRows - 2));
    const shapedArmRows = Math.max(1, armLengthRows - ribbingRows);
    const taperPerSide = Math.max(0, Math.floor((cols - wristSts) / 2));
    for (let r = capRows; r < totalRows; r++) {
        const fromTop = r - capRows;
        if (fromTop >= shapedArmRows) {
            // Cuff / ribbing zone: constant wrist width
            garmentFillMargins(mask, r, cols, taperPerSide);
        } else {
            const t = shapedArmRows <= 1 ? 0 : fromTop / (shapedArmRows - 1);
            const margin = Math.round(taperPerSide * t);
            garmentFillMargins(mask, r, cols, margin);
        }
    }

    // ── Stitch overlay (shaping + ribbing) ──────────────────────────
    const shapingOv = generateShapingOverlay(mask, totalRows, cols);
    const ribOv = ribbingRows > 0
        ? generateRibbingOverlay(totalRows, cols, mask, opts.ribPattern || 'k1p1',
              totalRows - ribbingRows, totalRows - 1)
        : null;
    const stitchOverlay = mergeOverlays(totalRows, cols, ribOv, shapingOv);

    return {
        rows: totalRows, cols, mask, stitchOverlay,
        summary: {
            pieceName: 'Sleeve',
            widthCm: Math.round(upperArmCm * 10) / 10,
            castOnSts: wristSts,
            upperArmSts: cols,
            totalRows,
            armLengthRows,
            capRows,
            capHeightCm: Math.round(capHeightCm * 10) / 10,
            taperPerSide,
            wristSts,
            capInitialBO,
            finalBOSts,
            decsPerSide,
            ribbingRows,
            ribPattern: opts.ribPattern || 'k1p1',
        }
    };
}

// ── Helpers ──────────────────────────────────────────────────────────

function garmentMask(rows, cols, fill) {
    return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function garmentFillMargins(mask, r, cols, margin) {
    for (let c = 0; c < margin && c < cols; c++) mask[r][c] = true;
    for (let c = cols - margin; c < cols; c++) {
        if (c >= 0) mask[r][c] = true;
    }
}

// ── Shaping overlay ────────────────────────────────────────────────
// Scans a no-stitch mask to find rows where the fabric edge shifts by
// exactly 1 stitch (gradual shaping) and places the appropriate
// decrease or increase stitch IDs one stitch inward from the edge.
//
// Fully-fashioned convention ("lean into the piece"):
//   Decrease — side edges:  K2tog on LEFT, SSK on RIGHT
//   Decrease — neck edges:  SSK on LEFT of opening, K2tog on RIGHT
//   Increase — side edges:  M1L on LEFT, M1R on RIGHT

function generateShapingOverlay(mask, rows, cols) {
    const ov = Array.from({ length: rows }, () => new Array(cols).fill(null));

    function fabricEdges(r) {
        let left = -1, right = -1;
        for (let c = 0; c < cols; c++) {
            if (!mask[r][c]) { if (left === -1) left = c; right = c; }
        }
        return left === -1 ? null : { left, right };
    }

    function neckGap(edges, r) {
        if (!edges) return null;
        let start = -1, end = -1;
        for (let c = edges.left + 1; c < edges.right; c++) {
            if (mask[r][c]) { if (start === -1) start = c; end = c; }
        }
        return start === -1 ? null : { start, end };
    }

    function safeSet(r, c, val) {
        if (c >= 0 && c < cols && !mask[r][c] && !ov[r][c]) ov[r][c] = val;
    }

    for (let r = 0; r < rows - 1; r++) {
        const cur = fabricEdges(r);
        const below = fabricEdges(r + 1);
        if (!cur || !below) continue;
        if (cur.right - cur.left < 3) continue;   // shoulder too narrow

        // Side-edge deltas: +1 = narrowing (decrease), −1 = widening (increase)
        const dL = cur.left - below.left;
        const dR = below.right - cur.right;

        if (dL === 1)  safeSet(r, cur.left + 1,  'k-right');  // K2tog on left
        if (dR === 1)  safeSet(r, cur.right - 1,  'k-left');  // SSK on right
        if (dL === -1) safeSet(r, cur.left + 1,   'm1l');     // M1L on left
        if (dR === -1) safeSet(r, cur.right - 1,  'm1r');     // M1R on right

        // Neck opening: decreases lean into each shoulder section
        const g  = neckGap(cur, r);
        const gB = neckGap(below, r + 1);
        if (g && gB) {
            if (g.start < gB.start) safeSet(r, g.start - 2, 'k-left');  // SSK
            if (g.end   > gB.end)   safeSet(r, g.end   + 2, 'k-right'); // K2tog
        }
    }

    return ov;
}

// ── Ribbing overlay ────────────────────────────────────────────────
// Fills the specified row range with alternating knit / purl stitches,
// skipping no-stitch cells.  The alternation cycles from the first
// fabric stitch in each row so the rib aligns regardless of margins.

function generateRibbingOverlay(rows, cols, mask, ribPattern, startRow, endRow) {
    const ov = Array.from({ length: rows }, () => new Array(cols).fill(null));
    const group = ribPattern === 'k2p2' ? 2 : 1;
    for (let r = Math.max(0, startRow); r <= Math.min(endRow, rows - 1); r++) {
        let idx = 0;
        for (let c = 0; c < cols; c++) {
            if (mask[r][c]) continue;
            ov[r][c] = (Math.floor(idx / group) % 2 === 0) ? 'knit' : 'purl';
            idx++;
        }
    }
    return ov;
}

// ── Merge overlays (later entries overwrite earlier) ───────────────

function mergeOverlays(rows, cols) {
    const m = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (let a = 2; a < arguments.length; a++) {
        const ov = arguments[a];
        if (!ov) continue;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (ov[r][c]) m[r][c] = ov[r][c];
            }
        }
    }
    return m;
}

// CJS export shim for tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        GARMENT_EASE, GARMENT_NECK, GARMENT_DEFAULTS_CM,
        deriveArmholeDepthCm, generateJumperPiece,
        generateBodyPanel, generateSleeve,
        generateShapingOverlay, generateRibbingOverlay, mergeOverlays,
        garmentMask, garmentFillMargins,
    };
}
