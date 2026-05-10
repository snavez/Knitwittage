// === Image Import ===
// Imports a raster image, quantises its colours via median-cut, and either
// replaces the grid or stamps the result onto an existing piece.

let imageData = null;       // Original Image element
let imagePattern = null;    // Processed 2D pattern array (hex strings)
let extractedPalette = [];  // [{hex, rgb:[r,g,b]}, ...]

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('image-modal');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('image-file-input');

    document.getElementById('btn-image').addEventListener('click', openImageModal);
    document.getElementById('image-close').addEventListener('click', closeImageModal);
    modal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeImageModal();
    });

    // Drop zone click -> file picker
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleImageFile(e.target.files[0]);
        e.target.value = '';
    });

    // Drag & drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleImageFile(file);
        }
    });

    // Controls
    document.getElementById('btn-image-apply').addEventListener('click', applyImagePattern);
    document.getElementById('btn-image-change').addEventListener('click', resetToDropZone);
    document.getElementById('image-cancel').addEventListener('click', closeImageModal);

    // Max colours slider — live reprocess
    const slider = document.getElementById('image-max-colors');
    const label = document.getElementById('image-max-colors-value');
    slider.addEventListener('input', () => {
        label.textContent = slider.value;
        if (imageData) processImage();
    });

    // Row/col — respond to both typing (input) and blur (change)
    // Debounce the 'input' event so we don't reprocess on every keystroke
    let dimsTimer = null;
    function debouncedDimsChange(e) {
        clearTimeout(dimsTimer);
        dimsTimer = setTimeout(() => onDimsChange(e), 400);
    }
    document.getElementById('image-rows').addEventListener('input', debouncedDimsChange);
    document.getElementById('image-cols').addEventListener('input', debouncedDimsChange);
    document.getElementById('image-rows').addEventListener('change', onDimsChange);
    document.getElementById('image-cols').addEventListener('change', onDimsChange);
});

// ── Modal open / close ─────────────────────────────────────────────

function openImageModal() {
    document.getElementById('image-modal').classList.add('open');
    // Pre-fill dimensions from current grid
    document.getElementById('image-rows').value = state.rows;
    document.getElementById('image-cols').value = state.cols;

    // "Place on existing grid" is always available — the user may want to
    // integrate the image into a garment outline, a repeating pattern, or
    // any grid they've already started working on.
    const placeLabel = document.getElementById('image-apply-place-label');
    if (placeLabel) placeLabel.style.display = '';

    resetToDropZone();
}

function resetToDropZone() {
    imageData = null;
    imagePattern = null;
    extractedPalette = [];
    document.getElementById('image-controls').style.display = 'none';
    document.getElementById('image-footer').style.display = 'none';
    document.getElementById('drop-zone').style.display = 'block';
}

function closeImageModal() {
    document.getElementById('image-modal').classList.remove('open');
}

// ── Aspect ratio lock / reprocess on change ────────────────────────

function onDimsChange(e) {
    if (imageData && document.getElementById('image-lock-ratio').checked) {
        const aspect = imageData.naturalWidth / imageData.naturalHeight;
        if (e.target.id === 'image-rows') {
            const rows = clamp(+document.getElementById('image-rows').value, 4, 1000);
            document.getElementById('image-cols').value = clamp(Math.round(rows * aspect), 4, 1000);
        } else {
            const cols = clamp(+document.getElementById('image-cols').value, 4, 1000);
            document.getElementById('image-rows').value = clamp(Math.round(cols / aspect), 4, 1000);
        }
    }
    if (imageData) processImage();
}

// ── Load image ─────────────────────────────────────────────────────

function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            imageData = img;
            // Smart default resolution: ~ 60 rows (reasonable stitch count)
            const aspect = img.naturalWidth / img.naturalHeight;
            let rows = 60;
            let cols = Math.round(rows * aspect);
            rows = clamp(rows, 4, 1000);
            cols = clamp(cols, 4, 1000);
            document.getElementById('image-rows').value = rows;
            document.getElementById('image-cols').value = cols;

            // Show controls + footer, hide drop zone
            document.getElementById('drop-zone').style.display = 'none';
            document.getElementById('image-controls').style.display = 'block';
            document.getElementById('image-footer').style.display = '';

            renderOriginalPreview(img);
            processImage();
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

function renderOriginalPreview(img) {
    const canvas = document.getElementById('image-original-canvas');
    const ctx = canvas.getContext('2d');
    // Fixed 200×200 canvas — image drawn centred, preserving aspect ratio
    const fixedSize = 200;
    canvas.width = fixedSize;
    canvas.height = fixedSize;
    const scale = Math.min(fixedSize / img.naturalWidth, fixedSize / img.naturalHeight, 1);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const x = Math.floor((fixedSize - w) / 2);
    const y = Math.floor((fixedSize - h) / 2);
    ctx.fillStyle = '#fbf7ec';
    ctx.fillRect(0, 0, fixedSize, fixedSize);
    ctx.drawImage(img, x, y, w, h);
}

// ═══════════════════════════════════════════════════════════════════
//  Median-Cut Colour Quantisation
// ═══════════════════════════════════════════════════════════════════

function medianCutQuantize(pixels, numColors) {
    if (pixels.length === 0) return [];
    if (numColors <= 1) return [avgColor(pixels)];

    let buckets = [pixels.slice()];

    while (buckets.length < numColors) {
        // Find bucket with the widest colour range on any channel
        let maxRange = -1, maxIdx = 0, maxCh = 0;
        for (let i = 0; i < buckets.length; i++) {
            const b = buckets[i];
            if (b.length < 2) continue;
            for (let ch = 0; ch < 3; ch++) {
                let lo = 255, hi = 0;
                for (const p of b) {
                    if (p[ch] < lo) lo = p[ch];
                    if (p[ch] > hi) hi = p[ch];
                }
                if (hi - lo > maxRange) {
                    maxRange = hi - lo;
                    maxIdx = i;
                    maxCh = ch;
                }
            }
        }
        if (maxRange <= 0) break; // all remaining buckets are uniform

        // Sort that bucket by its widest channel and split at the median
        const bucket = buckets[maxIdx];
        bucket.sort((a, b) => a[maxCh] - b[maxCh]);
        const mid = Math.floor(bucket.length / 2);
        buckets.splice(maxIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    // Sort result by luminance (dark → light) for nicer palette display
    const result = buckets.filter(b => b.length > 0).map(avgColor);
    result.sort((a, b) => luminance(a) - luminance(b));
    return result;
}

function avgColor(pixels) {
    let r = 0, g = 0, b = 0;
    for (const p of pixels) { r += p[0]; g += p[1]; b += p[2]; }
    const n = pixels.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function luminance([r, g, b]) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ── Extract palette from image ─────────────────────────────────────

function extractImagePalette(img, numColors) {
    // Sample at a manageable size for fast colour extraction
    const maxSample = 120;
    const scale = Math.min(maxSample / img.naturalWidth,
                           maxSample / img.naturalHeight, 1);
    const sw = Math.max(1, Math.round(img.naturalWidth * scale));
    const sh = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;

    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue; // skip transparent
        pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
    if (pixels.length === 0) return [];

    return medianCutQuantize(pixels, numColors);
}

// ── Display extracted palette ──────────────────────────────────────

function renderExtractedPalette(colors) {
    const container = document.getElementById('image-color-picks');
    container.innerHTML = '';
    for (const rgb of colors) {
        const hex = rgbToHex(rgb);
        const swatch = document.createElement('div');
        swatch.className = 'random-swatch picked';
        swatch.style.background = hex;
        swatch.title = hex;
        container.appendChild(swatch);
    }
}

// ═══════════════════════════════════════════════════════════════════
//  Process image → pattern
// ═══════════════════════════════════════════════════════════════════

function processImage() {
    if (!imageData) return;

    const rows = clamp(+document.getElementById('image-rows').value, 4, 1000);
    const cols = clamp(+document.getElementById('image-cols').value, 4, 1000);
    const maxColors = +document.getElementById('image-max-colors').value;

    // Extract palette from the image itself (median cut)
    const rgbPalette = extractImagePalette(imageData, maxColors);
    extractedPalette = rgbPalette.map(rgb => ({
        hex: rgbToHex(rgb),
        rgb
    }));
    renderExtractedPalette(rgbPalette);

    // Draw image scaled to target resolution
    const offscreen = document.createElement('canvas');
    offscreen.width = cols;
    offscreen.height = rows;
    const octx = offscreen.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(imageData, 0, 0, cols, rows);

    const pixels = octx.getImageData(0, 0, cols, rows).data;

    // Map every pixel to nearest palette colour
    imagePattern = [];
    for (let r = 0; r < rows; r++) {
        imagePattern[r] = [];
        for (let c = 0; c < cols; c++) {
            const i = (r * cols + c) * 4;
            if (pixels[i + 3] < 128) {
                imagePattern[r][c] = null;
                continue;
            }
            imagePattern[r][c] = findNearestColor(
                [pixels[i], pixels[i + 1], pixels[i + 2]],
                extractedPalette);
        }
    }

    renderPatternPreview(imagePattern, rows, cols);
}

function findNearestColor(rgb, palette) {
    let bestHex = palette[0].hex;
    let bestDist = Infinity;
    for (const entry of palette) {
        const dr = rgb[0] - entry.rgb[0];
        const dg = rgb[1] - entry.rgb[1];
        const db = rgb[2] - entry.rgb[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
            bestDist = dist;
            bestHex = entry.hex;
        }
    }
    return bestHex;
}

// ── Helpers ─────────────────────────────────────────────────────────

function hexToRGBArr(hex) {
    const c = hex.replace('#', '');
    return [
        parseInt(c.substr(0, 2), 16),
        parseInt(c.substr(2, 2), 16),
        parseInt(c.substr(4, 2), 16),
    ];
}

function rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map(v =>
        Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// ── Preview rendering ──────────────────────────────────────────────

function renderPatternPreview(pattern, rows, cols) {
    const canvas = document.getElementById('image-pattern-canvas');
    const ctx = canvas.getContext('2d');

    // Fixed canvas size so the overlay doesn't jump when resolution changes
    const fixedSize = 200;
    canvas.width = fixedSize;
    canvas.height = fixedSize;

    // Scale cells to fill the fixed canvas, preserving aspect ratio
    const cellW = fixedSize / cols;
    const cellH = fixedSize / rows;

    ctx.fillStyle = '#fbf7ec';
    ctx.fillRect(0, 0, fixedSize, fixedSize);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const color = pattern[r][c];
            ctx.fillStyle = color || '#fbf7ec';
            ctx.fillRect(
                Math.floor(c * cellW),
                Math.floor(r * cellH),
                Math.ceil(cellW),
                Math.ceil(cellH)
            );
        }
    }

    // Show grid lines only at low resolutions where they're visible
    if (Math.min(cellW, cellH) >= 5) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 0.5;
        for (let r = 0; r <= rows; r++) {
            const y = Math.floor(r * cellH);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(fixedSize, y); ctx.stroke();
        }
        for (let c = 0; c <= cols; c++) {
            const x = Math.floor(c * cellW);
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, fixedSize); ctx.stroke();
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  Apply to grid
// ═══════════════════════════════════════════════════════════════════

function applyImagePattern() {
    if (!imagePattern) {
        showToast('Process an image first');
        return;
    }

    const mode = document.querySelector(
        'input[name="image-apply-mode"]:checked')?.value || 'replace';

    if (mode === 'place') {
        placeImageOnGrid();
    } else {
        replaceGridWithImage();
    }
}

// ── Replace entire grid ────────────────────────────────────────────

function replaceGridWithImage() {
    const rows = imagePattern.length;
    const cols = imagePattern[0].length;

    ensureImageColorsInPalette();

    state.rows = rows;
    state.cols = cols;
    state.grid = [];
    state.stitchGrid = [];
    for (let r = 0; r < rows; r++) {
        state.grid[r] = [];
        state.stitchGrid[r] = [];
        for (let c = 0; c < cols; c++) {
            state.grid[r][c] = imagePattern[r][c];
            state.stitchGrid[r][c] = null;
        }
    }

    document.getElementById('grid-rows').value = rows;
    document.getElementById('grid-cols').value = cols;
    renderGrid();
    pushHistory();
    closeImageModal();
    showToast('Image pattern applied');
}

// ── Place on existing grid (garment-aware) ─────────────────────────

function placeImageOnGrid() {
    const patRows = imagePattern.length;
    const patCols = imagePattern[0].length;

    // Find the available (non-no-stitch) bounding box on the current grid
    const avail = findAvailableArea();

    if (patRows > avail.rows || patCols > avail.cols) {
        // Too large — offer to rescale to fit
        const scale = Math.min(avail.rows / patRows, avail.cols / patCols);
        const newRows = Math.max(4, Math.floor(patRows * scale));
        const newCols = Math.max(4, Math.floor(patCols * scale));

        if (!confirm(
            `Image (${patRows}×${patCols}) is larger than the available area ` +
            `(${avail.rows}×${avail.cols}).\n\nRescale to ${newRows}×${newCols} to fit?`
        )) return;

        // Reprocess at the smaller size, then re-apply
        document.getElementById('image-rows').value = newRows;
        document.getElementById('image-cols').value = newCols;
        processImage();
        placeImageOnGrid();      // recurse with the resized pattern
        return;
    }

    ensureImageColorsInPalette();

    // Centre the image in the available area
    const startRow = avail.top + Math.floor((avail.rows - patRows) / 2);
    const startCol = avail.left + Math.floor((avail.cols - patCols) / 2);

    for (let r = 0; r < patRows; r++) {
        for (let c = 0; c < patCols; c++) {
            const gr = startRow + r;
            const gc = startCol + c;
            if (gr < 0 || gr >= state.rows || gc < 0 || gc >= state.cols) continue;
            // Only paint onto non-no-stitch cells
            if (state.stitchGrid[gr] && state.stitchGrid[gr][gc] === 'no-stitch') continue;
            const color = imagePattern[r][c];
            if (color !== null) {
                state.grid[gr][gc] = color;
            }
        }
    }

    renderGrid();
    pushHistory();
    closeImageModal();
    showToast(`Image placed at row ${startRow + 1}, col ${startCol + 1} ` +
              `(${patRows}×${patCols})`);
}

// ── Find available non-no-stitch bounding box ──────────────────────

function findAvailableArea() {
    let minR = state.rows, maxR = -1, minC = state.cols, maxC = -1;
    let hasNoStitch = false;

    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            if (state.stitchGrid[r] && state.stitchGrid[r][c] === 'no-stitch') {
                hasNoStitch = true;
            } else {
                if (r < minR) minR = r;
                if (r > maxR) maxR = r;
                if (c < minC) minC = c;
                if (c > maxC) maxC = c;
            }
        }
    }

    if (!hasNoStitch || maxR < 0) {
        // No garment outline — entire grid is available
        return { top: 0, left: 0, rows: state.rows, cols: state.cols };
    }

    return {
        top: minR, left: minC,
        rows: maxR - minR + 1,
        cols: maxC - minC + 1,
    };
}

// ── Ensure extracted colours are in the app palette ────────────────

function ensureImageColorsInPalette() {
    // The grid stores arbitrary hex values, so painting works even without
    // adding to COLORS. But adding them lets the user continue to paint
    // with those colours after the modal closes.
    // We append unique non-duplicate swatches to the palette area.
    const palette = document.getElementById('color-palette');
    if (!palette) return;

    const existing = new Set(
        Array.from(palette.querySelectorAll('.color-swatch'))
            .map(s => s.dataset.color));

    for (const entry of extractedPalette) {
        if (existing.has(entry.hex)) continue;
        existing.add(entry.hex);
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.background = entry.hex;
        swatch.dataset.color = entry.hex;
        swatch.addEventListener('click', () => selectColor(entry.hex));
        // Insert before the "+" custom-colour button
        const customBtn = palette.querySelector('.color-swatch-custom');
        palette.insertBefore(swatch, customBtn);
    }
}
