// === Sizing calculator modal ===
// UI on top of js/sizing-math.js — gathers gauge and target-size inputs,
// shows the live calculated cell counts, and writes them to the grid-rows /
// grid-cols inputs when the user clicks Apply.
//
// Math (cellsForTargetDim, swatch sizes, unit conversions) lives in
// js/sizing-math.js so it can be unit-tested without DOM. This file is just
// glue: read inputs, call the helper, render the result, persist last-used
// gauge to localStorage so the user doesn't retype it on every project.

const SizingUI = {
    storageKey: 'knitwittage-last-gauge',
};

document.addEventListener('DOMContentLoaded', () => {
    const open = document.getElementById('btn-sizing-calculator');
    const close = document.getElementById('sizing-close');
    const cancel = document.getElementById('sizing-cancel');
    const apply = document.getElementById('sizing-apply');
    const modal = document.getElementById('sizing-modal');
    if (!open || !modal) return;

    open.addEventListener('click', openSizingModal);
    close?.addEventListener('click', closeSizingModal);
    cancel?.addEventListener('click', closeSizingModal);
    apply?.addEventListener('click', applySizing);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSizingModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeSizingModal();
    });

    // Live recalc on any input change. Keeps the result section in sync so
    // the user sees the cell counts update as they type.
    const liveInputs = [
        'sizing-swatch', 'sizing-sts', 'sizing-rows',
        'sizing-width', 'sizing-height',
        'sizing-width-unit', 'sizing-height-unit',
    ];
    for (const id of liveInputs) {
        document.getElementById(id)?.addEventListener('input', renderSizingResult);
        document.getElementById(id)?.addEventListener('change', renderSizingResult);
    }
});

function openSizingModal() {
    const modal = document.getElementById('sizing-modal');
    if (!modal) return;
    // Restore last-used gauge so users don't retype every project.
    restoreLastGauge();
    modal.classList.add('open');
    modal.style.display = 'flex';
    renderSizingResult();
    document.getElementById('sizing-sts')?.focus();
}

function closeSizingModal() {
    const modal = document.getElementById('sizing-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.style.display = 'none';
}

// Read the form, run the sizing math, render the result panel.
function readSizingInputs() {
    const swatchKey = document.getElementById('sizing-swatch')?.value || 'cm-10';
    const swatch = (typeof SWATCH_SIZES !== 'undefined' && SWATCH_SIZES[swatchKey])
        || { wCm: 10, hCm: 10, label: '10 × 10 cm' };
    const sts = parseFloat(document.getElementById('sizing-sts')?.value);
    const rows = parseFloat(document.getElementById('sizing-rows')?.value);
    const width = parseFloat(document.getElementById('sizing-width')?.value);
    const height = parseFloat(document.getElementById('sizing-height')?.value);
    const widthUnit = document.getElementById('sizing-width-unit')?.value || 'cm';
    const heightUnit = document.getElementById('sizing-height-unit')?.value || 'cm';
    return { swatchKey, swatch, sts, rows, width, height, widthUnit, heightUnit };
}

function computeSizing() {
    const inp = readSizingInputs();
    if (!isFinite(inp.sts) || !isFinite(inp.rows) || !isFinite(inp.width) || !isFinite(inp.height)) {
        return null;
    }
    const widthCm = (typeof toCm === 'function') ? toCm(inp.width, inp.widthUnit) : inp.width;
    const heightCm = (typeof toCm === 'function') ? toCm(inp.height, inp.heightUnit) : inp.height;
    const wResult = (typeof cellsForTargetDim === 'function')
        ? cellsForTargetDim(widthCm, inp.sts, inp.swatch.wCm)
        : { cells: 0, actualCm: 0, errorCm: 0 };
    const hResult = (typeof cellsForTargetDim === 'function')
        ? cellsForTargetDim(heightCm, inp.rows, inp.swatch.hCm)
        : { cells: 0, actualCm: 0, errorCm: 0 };
    return { inp, widthCm, heightCm, w: wResult, h: hResult };
}

function renderSizingResult() {
    const out = document.getElementById('sizing-result');
    if (!out) return;
    const r = computeSizing();
    if (!r || r.w.cells === 0 || r.h.cells === 0) {
        out.textContent = 'Fill in gauge and finished size to see the result.';
        out.className = 'sizing-result';
        return;
    }
    const fmtCm = (cm, unit) => {
        const v = (typeof fromCm === 'function') ? fromCm(cm, unit) : cm;
        return `${v.toFixed(2)} ${unit}`;
    };
    const wDelta = r.w.errorCm;
    const hDelta = r.h.errorCm;
    const wDeltaStr = fmtSignedDelta(wDelta, r.inp.widthUnit);
    const hDeltaStr = fmtSignedDelta(hDelta, r.inp.heightUnit);
    const overCap = r.w.cells > 1000 || r.h.cells > 1000;

    out.className = 'sizing-result' + (overCap ? ' sizing-result-warn' : '');
    out.innerHTML = `
      <div class="sizing-result-row"><strong>Width:</strong> ${r.w.cells} stitches <span class="sizing-result-meta">≈ ${fmtCm(r.w.actualCm, r.inp.widthUnit)} (${wDeltaStr} from target)</span></div>
      <div class="sizing-result-row"><strong>Height:</strong> ${r.h.cells} rows <span class="sizing-result-meta">≈ ${fmtCm(r.h.actualCm, r.inp.heightUnit)} (${hDeltaStr} from target)</span></div>
      ${overCap ? `<div class="sizing-result-warning">One or both dimensions exceed the 1000-cell cap. Apply will clamp to 1000.</div>` : ''}
    `;
}

function fmtSignedDelta(deltaCm, unit) {
    const v = (typeof fromCm === 'function') ? fromCm(deltaCm, unit) : deltaCm;
    if (Math.abs(v) < 0.005) return `exact`;
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(2)} ${unit}`;
}

function applySizing() {
    const r = computeSizing();
    if (!r || r.w.cells === 0 || r.h.cells === 0) {
        if (typeof showToast === 'function') {
            showToast('Fill in gauge and finished size first.', { tone: 'error' });
        }
        return;
    }
    saveLastGauge();
    const cols = Math.min(1000, Math.max(2, r.w.cells));
    const rows = Math.min(1000, Math.max(2, r.h.cells));
    const wasClamped = (cols !== r.w.cells || rows !== r.h.cells);
    const rowsInput = document.getElementById('grid-rows');
    const colsInput = document.getElementById('grid-cols');
    if (rowsInput) rowsInput.value = rows;
    if (colsInput) colsInput.value = cols;
    if (typeof initGrid === 'function') initGrid(rows, cols);
    if (typeof pushHistory === 'function') pushHistory();
    closeSizingModal();
    if (typeof showToast === 'function') {
        if (wasClamped) {
            showToast(`Grid set to ${rows} × ${cols} (clamped from ${r.h.cells} × ${r.w.cells} — max is 1000).`, { tone: 'error' });
        } else {
            showToast(`Grid set to ${rows} rows × ${cols} stitches.`);
        }
    }
}

// localStorage persistence — keeps the last-used gauge between sessions
// per the original spec ("save the last-used gauge in IndexedDB so users
// don't retype it for every project"). Using localStorage instead of
// IndexedDB to keep the dependency surface tiny; the data is just a small
// JSON object.
function saveLastGauge() {
    try {
        const inp = readSizingInputs();
        const data = {
            swatchKey: inp.swatchKey,
            sts: inp.sts,
            rows: inp.rows,
            width: inp.width,
            height: inp.height,
            widthUnit: inp.widthUnit,
            heightUnit: inp.heightUnit,
        };
        localStorage.setItem(SizingUI.storageKey, JSON.stringify(data));
    } catch (e) {
        // Quota exceeded / private browsing / etc. — silent fail; the user
        // just types the gauge in next time.
    }
}

function restoreLastGauge() {
    let data = null;
    try {
        const raw = localStorage.getItem(SizingUI.storageKey);
        if (raw) data = JSON.parse(raw);
    } catch (e) { return; }
    if (!data) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
    set('sizing-swatch', data.swatchKey);
    set('sizing-sts', data.sts);
    set('sizing-rows', data.rows);
    set('sizing-width', data.width);
    set('sizing-height', data.height);
    set('sizing-width-unit', data.widthUnit);
    set('sizing-height-unit', data.heightUnit);
}
