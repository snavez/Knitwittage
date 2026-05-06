// === Image Import ===

let imageData = null;       // Original Image element
let imagePattern = null;    // Processed 2D pattern array

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('image-modal');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('image-file-input');

    document.getElementById('btn-image').addEventListener('click', openImageModal);
    document.getElementById('image-close').addEventListener('click', closeImageModal);
    modal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeImageModal();
    });

    // Drop zone click → file picker
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
    document.getElementById('btn-image-reprocess').addEventListener('click', processImage);
    document.getElementById('btn-image-apply').addEventListener('click', applyImagePattern);
    document.getElementById('btn-image-change').addEventListener('click', resetToDropZone);

    // Max colours slider label
    const slider = document.getElementById('image-max-colors');
    const label = document.getElementById('image-max-colors-value');
    slider.addEventListener('input', () => { label.textContent = slider.value; });

    // Row/col lock ratio
    document.getElementById('image-rows').addEventListener('change', onRowsChange);
    document.getElementById('image-cols').addEventListener('change', onColsChange);

    initImageColorPicks();
});

function initImageColorPicks() {
    const container = document.getElementById('image-color-picks');
    container.innerHTML = '';
    COLORS.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'random-swatch picked'; // all on by default
        swatch.style.background = color;
        swatch.dataset.color = color;
        swatch.addEventListener('click', () => swatch.classList.toggle('picked'));
        container.appendChild(swatch);
    });
}

function getImagePickedColors() {
    const swatches = document.querySelectorAll('#image-color-picks .random-swatch.picked');
    const colors = [];
    swatches.forEach(s => colors.push(s.dataset.color));
    return colors.length > 0 ? colors : COLORS;
}

function openImageModal() {
    document.getElementById('image-modal').classList.add('open');
    document.getElementById('image-rows').value = state.rows;
    document.getElementById('image-cols').value = state.cols;
    // Always start at the drop zone so user can pick a new image
    resetToDropZone();
}

function resetToDropZone() {
    imageData = null;
    imagePattern = null;
    document.getElementById('image-controls').style.display = 'none';
    document.getElementById('drop-zone').style.display = 'block';
}

function closeImageModal() {
    document.getElementById('image-modal').classList.remove('open');
}

// === Aspect ratio lock ===
function onRowsChange() {
    if (!imageData || !document.getElementById('image-lock-ratio').checked) return;
    const aspect = imageData.naturalWidth / imageData.naturalHeight;
    const rows = clamp(+document.getElementById('image-rows').value, 4, 1000);
    const cols = clamp(Math.round(rows * aspect), 4, 1000);
    document.getElementById('image-cols').value = cols;
}

function onColsChange() {
    if (!imageData || !document.getElementById('image-lock-ratio').checked) return;
    const aspect = imageData.naturalWidth / imageData.naturalHeight;
    const cols = clamp(+document.getElementById('image-cols').value, 4, 1000);
    const rows = clamp(Math.round(cols / aspect), 4, 1000);
    document.getElementById('image-rows').value = rows;
}

// === Load image ===
function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            imageData = img;
            // Set initial resolution based on aspect ratio
            const aspect = img.naturalWidth / img.naturalHeight;
            let rows = 30;
            let cols = Math.round(rows * aspect);
            rows = clamp(rows, 4, 1000);
            cols = clamp(cols, 4, 1000);
            document.getElementById('image-rows').value = rows;
            document.getElementById('image-cols').value = cols;

            // Show controls, hide drop zone
            document.getElementById('drop-zone').style.display = 'none';
            document.getElementById('image-controls').style.display = 'block';

            // Show original preview
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
    const maxSize = 200;
    const scale = Math.min(maxSize / img.naturalWidth, maxSize / img.naturalHeight, 1);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

// === Process image → pattern ===
function processImage() {
    if (!imageData) return;

    const rows = clamp(+document.getElementById('image-rows').value, 4, 1000);
    const cols = clamp(+document.getElementById('image-cols').value, 4, 1000);
    const maxColors = +document.getElementById('image-max-colors').value;
    const palette = getImagePickedColors().map(hex => ({ hex, rgb: hexToRGBArr(hex) }));

    // Draw image scaled to target resolution on offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = cols;
    offscreen.height = rows;
    const octx = offscreen.getContext('2d');
    // Use smooth scaling for better downsampling
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(imageData, 0, 0, cols, rows);

    const pixels = octx.getImageData(0, 0, cols, rows).data;

    // First pass: map every pixel to nearest palette colour
    const mapped = [];
    const colorCounts = {};
    for (let r = 0; r < rows; r++) {
        mapped[r] = [];
        for (let c = 0; c < cols; c++) {
            const i = (r * cols + c) * 4;
            const pr = pixels[i], pg = pixels[i + 1], pb = pixels[i + 2], pa = pixels[i + 3];

            // Treat near-transparent as background
            if (pa < 128) {
                mapped[r][c] = null;
                continue;
            }

            const nearest = findNearestColor([pr, pg, pb], palette);
            mapped[r][c] = nearest;
            colorCounts[nearest] = (colorCounts[nearest] || 0) + 1;
        }
    }

    // Second pass: limit to top N colours
    const sortedColors = Object.entries(colorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxColors)
        .map(e => e[0]);

    // Build a reduced palette for remapping
    const reducedPalette = sortedColors.map(hex => ({ hex, rgb: hexToRGBArr(hex) }));

    imagePattern = [];
    for (let r = 0; r < rows; r++) {
        imagePattern[r] = [];
        for (let c = 0; c < cols; c++) {
            const color = mapped[r][c];
            if (color === null) {
                imagePattern[r][c] = null;
            } else if (sortedColors.includes(color)) {
                imagePattern[r][c] = color;
            } else {
                // Remap to nearest in reduced palette
                const rgb = hexToRGBArr(color);
                imagePattern[r][c] = findNearestColor(rgb, reducedPalette);
            }
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

function hexToRGBArr(hex) {
    const c = hex.replace('#', '');
    return [
        parseInt(c.substr(0, 2), 16),
        parseInt(c.substr(2, 2), 16),
        parseInt(c.substr(4, 2), 16),
    ];
}

function renderPatternPreview(pattern, rows, cols) {
    const canvas = document.getElementById('image-pattern-canvas');
    const ctx = canvas.getContext('2d');
    const maxSize = 200;
    let cellSize = Math.min(Math.floor(maxSize / cols), Math.floor(maxSize / rows));
    cellSize = clamp(cellSize, 2, 20);

    const w = cols * cellSize;
    const h = rows * cellSize;
    canvas.width = w;
    canvas.height = h;

    // Empty-cell fill tracks the warm paper-cream of the rest of the app
    // (was a stale dark navy from the old colour scheme).
    ctx.fillStyle = '#fbf7ec';
    ctx.fillRect(0, 0, w, h);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const color = pattern[r][c];
            ctx.fillStyle = color || '#fbf7ec';
            ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
        }
    }

    // Grid lines
    if (cellSize >= 5) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 0.5;
        for (let y = 0; y <= h; y += cellSize) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        for (let x = 0; x <= w; x += cellSize) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
    }
}

// === Apply to grid ===
function applyImagePattern() {
    if (!imagePattern) {
        showToast('Process an image first');
        return;
    }

    const rows = imagePattern.length;
    const cols = imagePattern[0].length;

    state.rows = rows;
    state.cols = cols;
    state.grid = [];
    for (let r = 0; r < rows; r++) {
        state.grid[r] = [];
        for (let c = 0; c < cols; c++) {
            state.grid[r][c] = imagePattern[r][c];
        }
    }

    document.getElementById('grid-rows').value = rows;
    document.getElementById('grid-cols').value = cols;
    renderGrid();
    pushHistory();
    closeImageModal();
    showToast('Image pattern applied');
}
