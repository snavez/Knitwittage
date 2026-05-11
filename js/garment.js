// === Garment pattern generator UI ===
// Modal on top of js/garment-math.js — gathers measurements, gauge, and
// style inputs, shows a live silhouette preview + dimension summary,
// and writes the generated no-stitch outline to the grid when the user
// clicks Generate.
//
// Unit conversion uses toCm()/fromCm() from js/sizing-math.js.
// Gauge handling mirrors js/sizing.js (swatch normalization, localStorage).

const GarmentUI = {
    storageKey: 'knitwittage-garment-settings',
    prevUnit: 'cm',
};

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-garment');
    const close = document.getElementById('garment-close');
    const cancel = document.getElementById('garment-cancel');
    const generate = document.getElementById('garment-generate');
    const modal = document.getElementById('garment-modal');
    if (!btn || !modal) return;

    btn.addEventListener('click', openGarmentModal);
    close?.addEventListener('click', closeGarmentModal);
    cancel?.addEventListener('click', closeGarmentModal);
    generate?.addEventListener('click', applyGarmentPiece);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeGarmentModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeGarmentModal();
    });

    // Live recalc on any input change
    const liveIds = [
        'garment-type', 'garment-swatch',
        'garment-gauge-sts', 'garment-gauge-rows',
        'garment-chest', 'garment-body-length', 'garment-shoulder',
        'garment-upper-arm', 'garment-wrist', 'garment-arm-length',
        'garment-rib-depth',
    ];
    for (const id of liveIds) {
        const el = document.getElementById(id);
        el?.addEventListener('input', recalcGarment);
        el?.addEventListener('change', recalcGarment);
    }
    document.querySelectorAll('input[name="garment-piece"]').forEach(r =>
        r.addEventListener('change', recalcGarment));
    document.querySelectorAll('input[name="garment-fit"]').forEach(r =>
        r.addEventListener('change', recalcGarment));
    document.querySelectorAll('input[name="garment-neck"]').forEach(r =>
        r.addEventListener('change', recalcGarment));

    // Ribbing checkbox toggles options visibility
    const ribCheck = document.getElementById('garment-ribbing');
    if (ribCheck) {
        ribCheck.addEventListener('change', () => {
            const show = ribCheck.checked;
            const opts = document.getElementById('garment-rib-options');
            const depth = document.getElementById('garment-rib-depth-row');
            if (opts) opts.style.display = show ? '' : 'none';
            if (depth) depth.style.display = show ? '' : 'none';
            recalcGarment();
        });
    }
    document.querySelectorAll('input[name="garment-rib"]').forEach(r =>
        r.addEventListener('change', recalcGarment));

    document.getElementById('garment-unit')?.addEventListener('change', handleGarmentUnitSwitch);
});

// ── Modal open / close ──────────────────────────────────────────────

function openGarmentModal() {
    const modal = document.getElementById('garment-modal');
    if (!modal) return;
    restoreGarmentSettings();
    modal.classList.add('open');
    modal.style.display = 'flex';
    recalcGarment();
}

function closeGarmentModal() {
    const modal = document.getElementById('garment-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.style.display = 'none';
}

// ── Read form ───────────────────────────────────────────────────────

function readGarmentInputs() {
    const unit = document.getElementById('garment-unit')?.value || 'cm';
    const rawFields = {
        chest:        parseFloat(document.getElementById('garment-chest')?.value) || 0,
        bodyLength:   parseFloat(document.getElementById('garment-body-length')?.value) || 0,
        shoulderWidth:parseFloat(document.getElementById('garment-shoulder')?.value) || 0,
        upperArm:     parseFloat(document.getElementById('garment-upper-arm')?.value) || 0,
        wristCirc:    parseFloat(document.getElementById('garment-wrist')?.value) || 0,
        armLength:    parseFloat(document.getElementById('garment-arm-length')?.value) || 0,
    };

    const c = (v) => typeof toCm === 'function' ? toCm(v, unit) : v;
    const measCm = {};
    for (const k of Object.keys(rawFields)) measCm[k] = c(rawFields[k]);

    const swatchKey = document.getElementById('garment-swatch')?.value || 'cm-10';
    const swatch = (typeof SWATCH_SIZES !== 'undefined' && SWATCH_SIZES[swatchKey])
        || { wCm: 10, hCm: 10 };
    const rawSts = parseFloat(document.getElementById('garment-gauge-sts')?.value) || 0;
    const rawRows = parseFloat(document.getElementById('garment-gauge-rows')?.value) || 0;
    const gauge = {
        stsPer10cm: rawSts * (10 / swatch.wCm),
        rowsPer10cm: rawRows * (10 / swatch.hCm),
    };

    const piece = document.querySelector('input[name="garment-piece"]:checked')?.value || 'back';
    const fit   = document.querySelector('input[name="garment-fit"]:checked')?.value || 'standard';
    const neck  = document.querySelector('input[name="garment-neck"]:checked')?.value || 'crew';

    const ribbing = document.getElementById('garment-ribbing')?.checked || false;
    const ribPattern = document.querySelector('input[name="garment-rib"]:checked')?.value || 'k1p1';
    const ribDepthRaw = parseFloat(document.getElementById('garment-rib-depth')?.value) || 0;
    const ribDepthCm = ribbing ? c(ribDepthRaw) : 0;
    const ribbingRows = ribbing ? Math.max(0, Math.round(ribDepthCm * gauge.rowsPer10cm / 10)) : 0;

    return { measCm, gauge, piece, fit, neck, unit, ribbingRows, ribPattern };
}

// ── Live recalculation ──────────────────────────────────────────────

function recalcGarment() {
    const inp = readGarmentInputs();
    if (inp.gauge.stsPer10cm <= 0 || inp.gauge.rowsPer10cm <= 0) {
        renderGarmentResult(null);
        renderGarmentPreview(null);
        return;
    }
    const result = typeof generateJumperPiece === 'function'
        ? generateJumperPiece(inp.piece, inp.measCm, inp.gauge, {
            fit: inp.fit, neck: inp.neck,
            ribbingRows: inp.ribbingRows, ribPattern: inp.ribPattern,
          })
        : null;
    renderGarmentResult(result);
    renderGarmentPreview(result);
}

// ── Result summary ──────────────────────────────────────────────────

function renderGarmentResult(result) {
    const el = document.getElementById('garment-result');
    if (!el) return;
    if (!result || !result.summary || !result.summary.pieceName) {
        el.textContent = 'Fill in gauge and measurements to see the result.';
        return;
    }
    const s = result.summary;
    let html = `<div class="garment-result-title">${s.pieceName}</div>`;
    html += `<div class="sizing-result-row"><strong>Grid:</strong> ${result.cols} sts &times; ${result.rows} rows</div>`;
    html += `<div class="sizing-result-row"><strong>Width:</strong> ${s.widthCm} cm</div>`;

    if (s.armholeRows !== undefined) {
        html += `<div class="sizing-result-row"><strong>Armhole:</strong> ${s.armholeDecPerSide} sts/side, ${s.armholeRows} rows (${s.armholeDepthCm} cm)</div>`;
        html += `<div class="sizing-result-row"><strong>Neck:</strong> ${s.neckWidthSts} sts wide, ${s.neckDepthRows} rows deep</div>`;
        html += `<div class="sizing-result-row"><strong>Shoulder:</strong> ${s.shoulderSts} sts each side</div>`;
    } else if (s.capRows !== undefined) {
        html += `<div class="sizing-result-row"><strong>Cast on:</strong> ${s.castOnSts} sts (wrist)</div>`;
        html += `<div class="sizing-result-row"><strong>Upper arm:</strong> ${s.upperArmSts} sts</div>`;
        html += `<div class="sizing-result-row"><strong>Taper:</strong> +${s.taperPerSide} sts/side over ${s.armLengthRows} rows</div>`;
        html += `<div class="sizing-result-row"><strong>Cap:</strong> ${s.capRows} rows (${s.capHeightCm} cm)</div>`;
        if (s.capInitialBO !== undefined) {
            html += `<div class="sizing-result-row"><strong>Cap BO:</strong> ${s.capInitialBO} sts init, ${s.finalBOSts} sts final</div>`;
            html += `<div class="sizing-result-row"><strong>Cap decs:</strong> ${s.decsPerSide} sts/side</div>`;
        }
    }

    // Ribbing info
    if (s.ribbingRows > 0) {
        const ribLabel = (s.ribPattern || 'k1p1').toUpperCase();
        const where = s.pieceName === 'Sleeve' ? 'cuff' : 'hem';
        html += `<div class="sizing-result-row"><strong>Ribbing:</strong> ${ribLabel}, ${s.ribbingRows} rows at ${where}</div>`;
    }

    // Neckband finishing (front body panels only)
    if (s.piece === 'front' && s.neckPickupSts) {
        if (s.neckStyle === 'vneck') {
            html += `<div class="sizing-result-row"><strong>Neckband:</strong> Pick up ~${s.neckPickupSts} sts (marker at V). Rib with S2KP at V-point every rnd, ~6 rnds.</div>`;
        } else {
            html += `<div class="sizing-result-row"><strong>Neckband:</strong> Pick up ~${s.neckPickupSts} sts. Rib for ~6 rnds, BO loosely.</div>`;
        }
    }

    if (result.cols > 1000 || result.rows > 1000) {
        html += `<div class="sizing-result-warning">One or both dimensions exceed the 1000-cell cap. Generate will clamp to 1000.</div>`;
    }
    el.innerHTML = html;
}

// ── Preview canvas ──────────────────────────────────────────────────

function renderGarmentPreview(result) {
    const canvas = document.getElementById('garment-preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!result || result.rows <= 0 || result.cols <= 0) return;
    const { rows, cols, mask } = result;

    const pad = 12;
    const availW = canvas.width - 2 * pad;
    const availH = canvas.height - 2 * pad;
    const scale = Math.min(availW / cols, availH / rows);
    const w = cols * scale;
    const h = rows * scale;
    const ox = (canvas.width - w) / 2;
    const oy = (canvas.height - h) / 2;

    // Bounding box
    ctx.fillStyle = '#f0ebe0';
    ctx.fillRect(ox, oy, w, h);

    // Fabric silhouette — draw each row as one or two filled spans
    ctx.fillStyle = '#c4a882';
    for (let r = 0; r < rows; r++) {
        let left = -1, right = -1;
        for (let c = 0; c < cols; c++) {
            if (!mask[r][c]) {
                if (left === -1) left = c;
                right = c;
            }
        }
        if (left === -1) continue;

        // Check for internal gap (neck opening)
        let gapStart = -1, gapEnd = -1;
        for (let c = left + 1; c < right; c++) {
            if (mask[r][c]) {
                if (gapStart === -1) gapStart = c;
                gapEnd = c;
            }
        }

        const y = oy + r * scale;
        const rowH = scale + 0.5; // +0.5 prevents subpixel seams
        if (gapStart !== -1) {
            ctx.fillRect(ox + left * scale, y, (gapStart - left) * scale, rowH);
            ctx.fillRect(ox + (gapEnd + 1) * scale, y, (right - gapEnd) * scale, rowH);
        } else {
            ctx.fillRect(ox + left * scale, y, (right - left + 1) * scale, rowH);
        }
    }

    // Ribbing zone indicator (dashed line)
    if (result.summary && result.summary.ribbingRows > 0) {
        const ribY = oy + (rows - result.summary.ribbingRows) * scale;
        ctx.strokeStyle = 'rgba(138, 122, 101, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(ox, ribY);
        ctx.lineTo(ox + w, ribY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Thin border
    ctx.strokeStyle = '#8a7a65';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(ox, oy, w, h);
}

// ── Apply to grid ───────────────────────────────────────────────────

function applyGarmentPiece() {
    const inp = readGarmentInputs();
    if (inp.gauge.stsPer10cm <= 0 || inp.gauge.rowsPer10cm <= 0) {
        if (typeof showToast === 'function') showToast('Fill in gauge first.', { tone: 'error' });
        return;
    }
    const result = typeof generateJumperPiece === 'function'
        ? generateJumperPiece(inp.piece, inp.measCm, inp.gauge, {
            fit: inp.fit, neck: inp.neck,
            ribbingRows: inp.ribbingRows, ribPattern: inp.ribPattern,
          })
        : null;
    if (!result || result.cols < 2 || result.rows < 2) {
        if (typeof showToast === 'function') showToast('Measurements too small.', { tone: 'error' });
        return;
    }

    const rows = Math.min(1000, result.rows);
    const cols = Math.min(1000, result.cols);

    const hasContent = state.grid.some(row => row.some(c => c !== null)) ||
        state.stitchGrid.some(row => row.some(c => c !== null));
    if (hasContent && !confirm(
        `This will replace the current grid with a ${rows} × ${cols} ${result.summary.pieceName || inp.piece} piece. Continue?`
    )) return;

    saveGarmentSettings();

    // Resize grid
    if (typeof initGrid === 'function') initGrid(rows, cols);

    // Clear everything, stamp the no-stitch mask and stitch overlay
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            state.grid[r][c] = null;
            if (r < result.mask.length && c < result.mask[r].length && result.mask[r][c]) {
                state.stitchGrid[r][c] = 'no-stitch';
            } else if (result.stitchOverlay && result.stitchOverlay[r] && result.stitchOverlay[r][c]) {
                state.stitchGrid[r][c] = result.stitchOverlay[r][c];
            } else {
                state.stitchGrid[r][c] = null;
            }
        }
    }

    // Ensure shaping and ribbing stitches are in the active palette
    if (state.activeStitches) {
        state.activeStitches.add('no-stitch');
        if (result.stitchOverlay) {
            for (const row of result.stitchOverlay) {
                for (const s of row) {
                    if (s) state.activeStitches.add(s);
                }
            }
        }
    }

    // Update dimension inputs
    const rowsEl = document.getElementById('grid-rows');
    const colsEl = document.getElementById('grid-cols');
    if (rowsEl) rowsEl.value = rows;
    if (colsEl) colsEl.value = cols;

    // Suggest a pattern name if blank
    const pieceNames = { back: 'Back', front: 'Front', sleeve: 'Sleeve' };
    const pieceName = pieceNames[inp.piece] || inp.piece;
    const nameEl = document.getElementById('pattern-name');
    if (nameEl && !nameEl.value) {
        nameEl.value = `Jumper — ${pieceName}`;
        state.patternName = nameEl.value;
    }

    if (typeof pushHistory === 'function') pushHistory();
    if (typeof renderGrid === 'function') renderGrid();

    closeGarmentModal();
    if (typeof showToast === 'function') {
        showToast(`${pieceName} piece generated: ${cols} sts × ${rows} rows.`);
    }
}

// ── Unit switching ──────────────────────────────────────────────────

function handleGarmentUnitSwitch() {
    const newUnit = document.getElementById('garment-unit')?.value || 'cm';
    if (newUnit === GarmentUI.prevUnit) return;

    const fields = ['chest', 'body-length', 'shoulder', 'upper-arm', 'wrist', 'arm-length', 'rib-depth'];
    for (const f of fields) {
        const el = document.getElementById(`garment-${f}`);
        if (!el) continue;
        const val = parseFloat(el.value);
        if (!isFinite(val)) continue;
        const cm = typeof toCm === 'function' ? toCm(val, GarmentUI.prevUnit) : val;
        const converted = typeof fromCm === 'function' ? fromCm(cm, newUnit) : cm;
        el.value = Math.round(converted * 10) / 10;
    }
    GarmentUI.prevUnit = newUnit;
    recalcGarment();
}

// ── Persistence ─────────────────────────────────────────────────────

function saveGarmentSettings() {
    try {
        localStorage.setItem(GarmentUI.storageKey, JSON.stringify({
            piece: document.querySelector('input[name="garment-piece"]:checked')?.value,
            fit:   document.querySelector('input[name="garment-fit"]:checked')?.value,
            neck:  document.querySelector('input[name="garment-neck"]:checked')?.value,
            unit:  document.getElementById('garment-unit')?.value,
            gauge: {
                swatchKey: document.getElementById('garment-swatch')?.value,
                sts: document.getElementById('garment-gauge-sts')?.value,
                rows: document.getElementById('garment-gauge-rows')?.value,
            },
            measurements: {
                chest:      document.getElementById('garment-chest')?.value,
                bodyLength: document.getElementById('garment-body-length')?.value,
                shoulder:   document.getElementById('garment-shoulder')?.value,
                upperArm:   document.getElementById('garment-upper-arm')?.value,
                wrist:      document.getElementById('garment-wrist')?.value,
                armLength:  document.getElementById('garment-arm-length')?.value,
            },
            ribbing: {
                enabled: document.getElementById('garment-ribbing')?.checked || false,
                pattern: document.querySelector('input[name="garment-rib"]:checked')?.value || 'k1p1',
                depth:   document.getElementById('garment-rib-depth')?.value,
            },
        }));
    } catch (e) { /* quota / private browsing */ }
}

function restoreGarmentSettings() {
    let data;
    try {
        const raw = localStorage.getItem(GarmentUI.storageKey);
        if (raw) data = JSON.parse(raw);
    } catch (e) { /* ignore */ }

    // Fall back to sizing calculator gauge if no garment settings yet
    if (!data) {
        try {
            const sizing = localStorage.getItem(SizingUI.storageKey);
            if (sizing) {
                const sg = JSON.parse(sizing);
                data = { gauge: { swatchKey: sg.swatchKey, sts: sg.sts, rows: sg.rows } };
            }
        } catch (e) { /* ignore */ }
    }
    if (!data) return;

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el && val != null) el.value = val;
    };
    const check = (name, val) => {
        if (!val) return;
        const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
        if (el) el.checked = true;
    };

    if (data.unit) {
        set('garment-unit', data.unit);
        GarmentUI.prevUnit = data.unit;
    }
    if (data.gauge) {
        set('garment-swatch', data.gauge.swatchKey);
        set('garment-gauge-sts', data.gauge.sts);
        set('garment-gauge-rows', data.gauge.rows);
    }
    if (data.measurements) {
        set('garment-chest', data.measurements.chest);
        set('garment-body-length', data.measurements.bodyLength);
        set('garment-shoulder', data.measurements.shoulder);
        set('garment-upper-arm', data.measurements.upperArm);
        set('garment-wrist', data.measurements.wrist);
        set('garment-arm-length', data.measurements.armLength);
    }
    check('garment-piece', data.piece);
    check('garment-fit', data.fit);
    check('garment-neck', data.neck);

    // Ribbing
    if (data.ribbing) {
        const ribEl = document.getElementById('garment-ribbing');
        if (ribEl) {
            ribEl.checked = !!data.ribbing.enabled;
            const show = ribEl.checked;
            const optsEl = document.getElementById('garment-rib-options');
            const depthEl = document.getElementById('garment-rib-depth-row');
            if (optsEl) optsEl.style.display = show ? '' : 'none';
            if (depthEl) depthEl.style.display = show ? '' : 'none';
        }
        check('garment-rib', data.ribbing.pattern);
        set('garment-rib-depth', data.ribbing.depth);
    }
}
