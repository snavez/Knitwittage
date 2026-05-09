// === Active Knitting Mode ===
// Follow along row by row while knitting from the pattern.

const knitState = {
    active: false,
    currentKnitRow: 1, // knitting row number (1 = bottom)
    totalRows: 0,
    instructions: [],   // cached per-row instructions
    arrayRows: [],      // kRow-1 → arrayRow (matches instructions.js skip rules)
    fullscreen: false,
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-knit').addEventListener('click', enterKnitMode);
    document.getElementById('knit-exit').addEventListener('click', exitKnitMode);
    document.getElementById('knit-prev').addEventListener('click', prevRow);
    document.getElementById('knit-next').addEventListener('click', nextRow);
    document.getElementById('knit-fullscreen').addEventListener('click', toggleFullscreen);

    document.getElementById('knit-fs-prev').addEventListener('click', prevRow);
    document.getElementById('knit-fs-next').addEventListener('click', nextRow);
    document.getElementById('knit-fs-grid').addEventListener('click', () => {
        knitState.fullscreen = false;
        document.getElementById('knit-fullscreen-view').style.display = 'none';
        document.getElementById('knit-overlay').style.display = 'block';
        updateKnitDisplay();
    });
    document.getElementById('knit-fs-exit').addEventListener('click', exitKnitMode);

    // Keyboard navigation when in knit mode
    document.addEventListener('keydown', (e) => {
        if (!knitState.active) return;
        // Don't steal keys while the user is typing in a text field — Space,
        // arrows, and f/F must reach inputs, textareas, and contenteditable
        // surfaces. Escape still escapes here, since a modal's own Escape
        // handler is what actually closes it.
        if (isEditableTarget(e.target) && e.key !== 'Escape') return;
        // Knitting goes bottom-up, so the highlight should travel up the chart
        // when the user advances. Up = next row (toward the top), Down = previous
        // row (toward the bottom). Right/Space stay as "forward", Left as "back".
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === ' ') {
            e.preventDefault();
            nextRow();
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            prevRow();
        }
        if (e.key === 'Escape') {
            exitKnitMode();
        }
        if (e.key === 'f' || e.key === 'F') {
            toggleFullscreen();
        }
    });
});

function enterKnitMode() {
    const pattern = getPatternRegion();
    if (!pattern) {
        showToast('Add some stitches or paint cells first!');
        return;
    }

    const mode = state.knittingMode;

    // Work out which rows survive skipping (all-no-stitch rows don't count)
    const stitchRegion = (typeof getStitchRegion === 'function')
        ? getStitchRegion(pattern.length, pattern[0].length) : null;
    knitState.arrayRows = getActiveKnittingRows(pattern, stitchRegion);
    knitState.totalRows = knitState.arrayRows.length;
    if (knitState.totalRows === 0) {
        showToast('Every row is "no stitch" — nothing to knit!');
        return;
    }

    knitState.active = true;
    knitState.currentKnitRow = 1;

    // Generate instructions using the same path as the Instructions modal
    // Parse the full instruction text and extract per-row instructions
    const fullText = formatInstructionsText(pattern, mode);

    knitState.instructions = [];
    const lines = fullText.split('\n');
    for (let kRow = 1; kRow <= knitState.totalRows; kRow++) {
        // Find the line for this row
        const prefix = mode === 'flat' ? `Row ${kRow} ` : `Rnd ${kRow}`;
        const line = lines.find(l => l.startsWith(prefix));
        if (line) {
            // Extract just the instruction part after the colon
            const colonIdx = line.indexOf(':');
            knitState.instructions.push(colonIdx >= 0 ? line.substring(colonIdx + 2) : line);
        } else {
            knitState.instructions.push('');
        }
    }

    document.getElementById('knit-overlay').style.display = 'block';
    document.body.classList.add('knit-active');
    updateKnitDisplay();
    showToast('Knitting mode! Use arrow keys or buttons to navigate rows.');
}

function exitKnitMode() {
    knitState.active = false;
    knitState.fullscreen = false;
    document.getElementById('knit-overlay').style.display = 'none';
    document.getElementById('knit-fullscreen-view').style.display = 'none';
    document.body.classList.remove('knit-active');
    clearKnitHighlight();
}

function nextRow() {
    if (!knitState.totalRows) return;
    // Wrap back to R1 once we're past the top of the chart — repeating a motif
    // is the common case, and the button otherwise goes dead after the last row.
    knitState.currentKnitRow = knitState.currentKnitRow >= knitState.totalRows
        ? 1 : knitState.currentKnitRow + 1;
    updateKnitDisplay();
}

function prevRow() {
    if (!knitState.totalRows) return;
    knitState.currentKnitRow = knitState.currentKnitRow <= 1
        ? knitState.totalRows : knitState.currentKnitRow - 1;
    updateKnitDisplay();
}

function toggleFullscreen() {
    knitState.fullscreen = !knitState.fullscreen;
    if (knitState.fullscreen) {
        document.getElementById('knit-overlay').style.display = 'none';
        document.getElementById('knit-fullscreen-view').style.display = 'flex';
    } else {
        document.getElementById('knit-fullscreen-view').style.display = 'none';
        document.getElementById('knit-overlay').style.display = 'block';
    }
    updateKnitDisplay();
}

function updateKnitDisplay() {
    const kRow = knitState.currentKnitRow;
    const isFlat = state.knittingMode === 'flat';
    const r1IsWS = (state.firstRow === 'WS');
    const isOdd = (kRow % 2 === 1);
    const isRS = isFlat ? (r1IsWS ? !isOdd : isOdd) : true;

    let rowLabel, directionText;
    if (isFlat) {
        const side = isRS ? 'RS' : 'WS';
        const arrow = isRS ? '\u25C0 Work right to left' : '\u25B6 Work left to right';
        rowLabel = `Row ${kRow} (${side})`;
        directionText = arrow;
    } else {
        rowLabel = `Rnd ${kRow}`;
        directionText = '\u25C0 Work right to left';
    }

    const instruction = knitState.instructions[kRow - 1] || '';
    const progress = `${kRow} / ${knitState.totalRows}`;

    // Update bar overlay — instruction beside row label on the top bar,
    // working direction in the strip below
    document.getElementById('knit-row-label').textContent = rowLabel;
    document.getElementById('knit-direction').textContent = instruction;
    document.getElementById('knit-instruction').textContent = directionText;

    // Update fullscreen view
    document.getElementById('knit-fs-row').textContent = rowLabel;
    document.getElementById('knit-fs-direction').textContent = directionText;
    document.getElementById('knit-fs-instruction').textContent = instruction;
    document.getElementById('knit-fs-progress').textContent = `Row ${progress}`;

    // Highlight current row on the grid
    highlightKnitRow(kRow);
}

function highlightKnitRow(kRow) {
    clearKnitHighlight();
    const arrayRow = knitState.arrayRows[kRow - 1];
    const bounds = getTrimmedBounds();
    if (!bounds || arrayRow === undefined) return;
    const gridRow = bounds.minR + arrayRow;

    // Per-cell red outline on the active row — drawn by GridView on its
    // overlay canvas (no DOM class toggling on tens of thousands of cells).
    GridView.setKnitActiveRow(gridRow);

    // Full-width red highlight bar that extends past the grid edges
    positionKnitRowBar(gridRow);

    // Scroll the row into view — vertically centre the row, AND scroll
    // horizontally so the side where the row starts is visible (the
    // knitter wants to see where they pick up the needle, not the
    // far-end finish).
    //   RS rows are knitted right→left, so they start at knitting col 1
    //   = chart's rightmost cell → scroll all the way right.
    //   WS rows go left→right, so they start at the leftmost cell →
    //   scroll all the way left.
    //   Round mode is always RS-style (right→left).
    const container = document.getElementById('grid-container');
    const canvasArea = document.querySelector('.canvas-area');
    if (container && canvasArea) {
        const bounds = GridView.cellBoundsWrapper(gridRow, 0);
        const containerRect = container.getBoundingClientRect();
        const areaRect = canvasArea.getBoundingClientRect();
        const rowTop = (containerRect.top - areaRect.top) + bounds.y + canvasArea.scrollTop;
        const targetTop = rowTop - (canvasArea.clientHeight / 2) + (bounds.h / 2);

        const isRS = state.knittingMode === 'round'
            ? true
            : ((state.firstRow === 'RS') ? (kRow % 2 === 1) : (kRow % 2 === 0));
        const startsRight = isRS;
        const targetLeft = startsRight
            ? Math.max(0, canvasArea.scrollWidth - canvasArea.clientWidth)
            : 0;

        canvasArea.scrollTo({ top: targetTop, left: targetLeft, behavior: 'smooth' });
    }
}

function positionKnitRowBar(gridRow) {
    const wrapper = document.querySelector('.grid-wrapper');
    const container = document.getElementById('grid-container');
    if (!wrapper || !container) return;

    let bar = document.getElementById('knit-row-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'knit-row-bar';
        bar.className = 'knit-row-bar';
        wrapper.appendChild(bar);
    }

    // Row position comes from GridView; then translate from grid-container
    // space into grid-wrapper space (the bar's positioning parent).
    const bounds = GridView.cellBoundsWrapper(gridRow, 0);
    if (!bounds) { bar.classList.remove('visible'); return; }

    const wrapRect = wrapper.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const containerOffsetY = containerRect.top - wrapRect.top;
    const top = containerOffsetY + bounds.y;

    bar.style.top = `${top}px`;
    bar.style.height = `${bounds.h}px`;
    bar.classList.add('visible');
}

function clearKnitHighlight() {
    if (typeof GridView !== 'undefined') GridView.clearKnitActiveRow();
    const bar = document.getElementById('knit-row-bar');
    if (bar) bar.classList.remove('visible');
}
