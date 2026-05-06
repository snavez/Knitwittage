// === Random Pattern Generator ===

let randomPattern = null; // Temporary 2D array before applying

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-random').addEventListener('click', openRandomModal);
    document.getElementById('random-close').addEventListener('click', closeRandomModal);
    document.getElementById('random-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeRandomModal();
    });
    document.getElementById('btn-random-generate').addEventListener('click', generateRandomPattern);
    document.getElementById('btn-random-apply').addEventListener('click', applyRandomPattern);

    // Density slider label
    const slider = document.getElementById('random-density');
    const label = document.getElementById('random-density-value');
    slider.addEventListener('input', () => {
        label.textContent = slider.value + '%';
    });

    initRandomColorPicks();
});

function initRandomColorPicks() {
    const container = document.getElementById('random-color-picks');
    container.innerHTML = '';

    // Create toggleable swatches from the COLORS palette
    COLORS.forEach((color, i) => {
        const swatch = document.createElement('div');
        swatch.className = 'random-swatch';
        swatch.style.background = color;
        swatch.dataset.color = color;
        // Default: first 2 colors selected
        if (i < 2) swatch.classList.add('picked');
        swatch.addEventListener('click', () => {
            swatch.classList.toggle('picked');
        });
        container.appendChild(swatch);
    });
}

function getPickedColors() {
    const swatches = document.querySelectorAll('#random-color-picks .random-swatch.picked');
    const colors = [];
    swatches.forEach(s => colors.push(s.dataset.color));
    return colors.length > 0 ? colors : [COLORS[0]]; // fallback to at least one
}

function openRandomModal() {
    document.getElementById('random-modal').classList.add('open');
    // Pre-fill rows/cols from current grid
    document.getElementById('random-rows').value = state.rows;
    document.getElementById('random-cols').value = state.cols;
}

function closeRandomModal() {
    document.getElementById('random-modal').classList.remove('open');
}

function generateRandomPattern() {
    const rows = clamp(+document.getElementById('random-rows').value, 2, 1000);
    const cols = clamp(+document.getElementById('random-cols').value, 2, 1000);
    const mirror = document.getElementById('random-mirror').value;
    const density = +document.getElementById('random-density').value / 100;
    const colors = getPickedColors();

    // Determine the "seed" quadrant size based on mirroring
    const mirrorH = (mirror === 'horizontal' || mirror === 'both');
    const mirrorV = (mirror === 'vertical' || mirror === 'both');

    // Seed dimensions: the unique region we randomize
    const seedRows = mirrorH ? Math.ceil(rows / 2) : rows;
    const seedCols = mirrorV ? Math.ceil(cols / 2) : cols;

    // Generate seed quadrant
    const seed = [];
    for (let r = 0; r < seedRows; r++) {
        seed[r] = [];
        for (let c = 0; c < seedCols; c++) {
            if (Math.random() < density) {
                seed[r][c] = colors[Math.floor(Math.random() * colors.length)];
            } else {
                seed[r][c] = null;
            }
        }
    }

    // Expand seed into full pattern with mirroring
    randomPattern = [];
    for (let r = 0; r < rows; r++) {
        randomPattern[r] = [];
        // Which seed row to sample from
        const sr = mirrorH && r >= seedRows ? (rows - 1 - r) : r;
        const clampedSR = Math.min(sr, seedRows - 1);

        for (let c = 0; c < cols; c++) {
            // Which seed col to sample from
            const sc = mirrorV && c >= seedCols ? (cols - 1 - c) : c;
            const clampedSC = Math.min(sc, seedCols - 1);

            randomPattern[r][c] = seed[clampedSR][clampedSC];
        }
    }

    renderRandomPreview(randomPattern, rows, cols);
}

function renderRandomPreview(pattern, rows, cols) {
    const canvas = document.getElementById('random-preview-canvas');
    const ctx = canvas.getContext('2d');

    const maxW = 400;
    const maxH = 300;
    let cellSize = Math.min(Math.floor(maxW / cols), Math.floor(maxH / rows));
    cellSize = clamp(cellSize, 3, 20);

    const w = cols * cellSize;
    const h = rows * cellSize;
    canvas.width = w;
    canvas.height = h;

    // Empty-cell fill tracks the warm paper-cream of the rest of the app.
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
    if (cellSize >= 6) {
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

function applyRandomPattern() {
    if (!randomPattern) {
        showToast('Generate a pattern first');
        return;
    }

    const rows = randomPattern.length;
    const cols = randomPattern[0].length;

    // Resize grid if needed
    if (rows !== state.rows || cols !== state.cols) {
        state.rows = rows;
        state.cols = cols;
        state.grid = [];
        for (let r = 0; r < rows; r++) {
            state.grid[r] = [];
            for (let c = 0; c < cols; c++) {
                state.grid[r][c] = null;
            }
        }
        document.getElementById('grid-rows').value = rows;
        document.getElementById('grid-cols').value = cols;
    }

    // Apply pattern to grid
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            state.grid[r][c] = randomPattern[r][c];
        }
    }

    renderGrid();
    pushHistory();
    closeRandomModal();
    showToast('Random pattern applied');
}
