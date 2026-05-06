// True when the keystroke target is a text-entry surface — used by global
// keydown handlers to skip workbench / knit-mode shortcuts so the user can
// type letters, spaces, arrows, Ctrl+Z etc. into inputs without the rest of
// the app stealing them.
function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

// === State ===
const state = {
    rows: 20,
    cols: 20,
    grid: [],           // 2D array: null = empty, string = color
    stitchGrid: [],     // 2D array: null = knit, 'purl', or {type,dir,width,pos,id}
    activeColor: null,
    activeTool: 'paint', // 'paint', 'fill', 'select', 'stitch'
    activeStitch: null,  // null, 'knit', 'purl', 'left-cross', 'right-cross', etc.
    // Erase toggles — independent of activeTool. When either is on, clicking
    // a cell erases that aspect (stitch and/or colour). Both can be on at
    // once. Selecting Paint / Fill / Select clears both back to false.
    eraseStitch: false,
    eraseColour: false,
    isPainting: false,
    // Drag-vs-click detection: the initial cell on mousedown, and whether
    // we've moved to another cell (= dragging). Drag-mode paints additively
    // (never toggles off) so sweeping across cells doesn't flicker them.
    paintStartCell: null,
    paintDragged: false,
    // Chart zoom — 1.0 = default cell size. Ctrl+wheel adjusts; clamped in
    // setZoom(). Also reflected in CSS via the --zoom custom property.
    zoom: 1.0,
    history: [],
    historyIndex: -1,
    maxHistory: 50,
    patternName: '',
    knittingMode: 'flat', // 'flat' or 'round'
    firstRow: 'RS', // 'RS' or 'WS' — which side is Row 1 on (flat only)
    customInstructions: null, // user-edited instruction text, saved with pattern
    // Selection / copy-paste
    selection: null,
    clipboard: null,
    isSelecting: false,
    isPasting: false,
    pasteGhostPos: null,
    // Cable placement
    cableDragStart: null, // { row, col } when dragging a cable
    cableDragEnd: null,
    // Stitches the user wants visible in the palette for THIS pattern. Set of
    // string ids; built-ins and user stitches alike participate. The effective
    // active set (see getEffectiveActiveStitches) also unions in anything used
    // by the grid + the always-on Erase tool, so a stitch can never go
    // un-selectable just because it was toggled off.
    activeStitches: null,
};

// New-project default: the ten built-in stitches the palette has historically
// shown out of the box. Erase tool is always-on outside this set.
function defaultActiveStitches() {
    return new Set([
        'knit', 'purl', 'left-cross', 'right-cross',
        'k-right', 'k-left', 'm1r', 'm1l', 'hole', 'no-stitch',
    ]);
}

// Stitch ids actually placed in the current chart. Used to (a) keep grid-used
// stitches visible in the palette regardless of toggle state, and (b) prevent
// the gallery overlay from deactivating something that's in use.
function getStitchesUsedInGrid() {
    const used = new Set();
    for (const row of state.stitchGrid || []) {
        if (!row) continue;
        for (const s of row) {
            if (!s) continue;
            if (typeof s === 'string') used.add(s);
            else if (typeof s === 'object') {
                if (s.type === 'cross') used.add(s.dir === 'left' ? 'left-cross' : 'right-cross');
                else if (s.type === 'user-multi' && s.stitchId) used.add(s.stitchId);
            }
        }
    }
    return used;
}

// Palette filter: explicit active set ∪ grid-used ∪ erase. A null
// state.activeStitches (legacy file with no list) falls back to "show every
// known stitch", matching pre-gallery behaviour.
function getEffectiveActiveStitches() {
    const active = state.activeStitches
        ? new Set(state.activeStitches)
        : new Set((typeof StitchRegistry !== 'undefined' ? StitchRegistry.getAll() : []).map(s => s.id));
    for (const id of getStitchesUsedInGrid()) active.add(id);
    active.add('stitch-erase');
    return active;
}

// Grid-cell ids that aren't in the registry — typically a borrowed pattern
// referencing a custom stitch the recipient doesn't have. Reported on Load.
function getMissingGridStitches() {
    if (typeof StitchRegistry === 'undefined') return [];
    const missing = new Set();
    for (const id of getStitchesUsedInGrid()) {
        if (!StitchRegistry.hasId(id)) missing.add(id);
    }
    return [...missing];
}

// Atelier palette — warm, natural, earthy tones.
// Each hue occupies the same 1:1 slot as the old bright palette.
const COLORS = [
    '#c8392d', // madder (red)
    '#c76b2b', // rust (orange)
    '#d9a441', // ochre (yellow)
    '#7a8a5a', // sage (green)
    '#5a8a82', // verdigris (teal)
    '#4f6e88', // indigo (blue)
    '#7a5a8a', // heather (purple)
    '#b85c6e', // rose (pink)
    '#6b4a2f', // walnut (brown)
    '#e0d5b0', // cream (deeper oat)
    '#2a2e3c', // midnight (navy)
    '#1b1612', // soot (black)
];

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
    state.activeColor = COLORS[0];
    state.activeStitches = defaultActiveStitches();
    initPalette();
    initGrid(state.rows, state.cols);
    bindEvents();
    bindZoom();
    updateZoomIndicator();
    pushHistory();
});

// === Palette ===
function initPalette() {
    const palette = document.getElementById('color-palette');
    palette.innerHTML = '';

    COLORS.forEach(color => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch' + (color === state.activeColor ? ' active' : '');
        swatch.style.background = color;
        swatch.dataset.color = color;
        swatch.addEventListener('click', () => selectColor(color));
        palette.appendChild(swatch);
    });

    // Custom color picker
    const customBtn = document.createElement('button');
    customBtn.className = 'color-swatch-custom';
    customBtn.textContent = '+';
    customBtn.title = 'Custom colour';
    const customInput = document.createElement('input');
    customInput.type = 'color';
    customInput.id = 'custom-color-input';
    customInput.value = '#ff6600';
    customBtn.appendChild(customInput);
    customBtn.addEventListener('click', () => customInput.click());
    customInput.addEventListener('input', (e) => {
        selectColor(e.target.value);
    });
    customInput.addEventListener('click', (e) => e.stopPropagation());
    palette.appendChild(customBtn);
}

function selectColor(color) {
    state.activeColor = color;
    // Picking a colour is implicitly "I want to paint with this" — switch to
    // Paint unless the user is in Fill mode, which legitimately consumes a
    // colour without needing a tool change. Select / Stitch modes used to be
    // exceptions too, but the user reported wanting to drop straight into
    // Paint from those.
    if (state.activeTool !== 'fill') {
        state.activeTool = 'paint';
    }
    updateToolButtons();
    document.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color === color);
    });
}

// === Grid ===
function initGrid(rows, cols) {
    state.rows = rows;
    state.cols = cols;

    // Preserve existing data where possible
    const oldGrid = state.grid;
    const oldStitchGrid = state.stitchGrid;
    state.grid = [];
    state.stitchGrid = [];
    for (let r = 0; r < rows; r++) {
        state.grid[r] = [];
        state.stitchGrid[r] = [];
        for (let c = 0; c < cols; c++) {
            state.grid[r][c] = (oldGrid[r] && oldGrid[r][c]) || null;
            state.stitchGrid[r][c] = (oldStitchGrid[r] && oldStitchGrid[r][c]) || null;
        }
    }

    renderGrid();
}

function renderGrid() {
    // Hand the grid off to the canvas-backed GridView — it clears any DOM
    // cells, sizes itself to the current rows/cols and zoom, and paints
    // every cell from state.grid in a single pass.
    GridView.init(state.rows, state.cols);

    renderNumbers();
    if (typeof renderStitchOverlay === 'function') renderStitchOverlay();
    updateStatusBar();
}

// When cells shrink under zoom, row/col labels overlap — show only every Nth.
// Always keep the first row/col and the last knitting row/col visible.
function labelStride(cellPx) {
    if (cellPx >= 14) return 1;
    if (cellPx >= 9)  return 2;
    if (cellPx >= 6)  return 5;
    if (cellPx >= 4)  return 10;
    return 25;
}

function renderNumbers() {
    const leftNums = document.getElementById('row-numbers-left');
    const rightNums = document.getElementById('row-numbers-right');
    const colNumsTop = document.getElementById('col-numbers');
    const colNumsBot = document.getElementById('col-numbers-bottom');
    leftNums.innerHTML = '';
    rightNums.innerHTML = '';
    colNumsTop.innerHTML = '';
    if (colNumsBot) colNumsBot.innerHTML = '';

    const cellPx = (typeof GridView !== 'undefined') ? GridView.getCellSize() : 22;
    const stride = labelStride(cellPx);

    function makeArrow(arrow) {
        return `<span class="row-arrow">${arrow}</span>`;
    }

    // Whether this knitting-row number should display a label. Hide
    // intermediate labels when cells are small so they don't overlap.
    function showRow(kRow) {
        return kRow === 1 || kRow === state.rows || (kRow % stride === 0);
    }
    function showCol(cNum) {
        return cNum === 1 || cNum === state.cols || (cNum % stride === 0);
    }

    // Row number rules:
    //   In the round — all row numbers on the right, all arrows ◀ (R→L).
    //   Flat, R1 = RS — odd rows (RS) on RIGHT with ◀; even rows (WS) on LEFT with ▶.
    //   Flat, R1 = WS — odd rows (WS) on LEFT with ▶; even rows (RS) on RIGHT with ◀.
    for (let r = 0; r < state.rows; r++) {
        const knittingRow = state.rows - r;
        const isOdd = (knittingRow % 2 === 1);
        const show = showRow(knittingRow);

        const leftEl = document.createElement('div');
        leftEl.className = 'row-number';
        const rightEl = document.createElement('div');
        rightEl.className = 'row-number';

        if (state.knittingMode === 'round') {
            leftEl.classList.add('row-hidden');
            if (show) {
                rightEl.innerHTML = makeArrow('\u25C0') + knittingRow;
                rightEl.classList.add('row-rs');
                rightEl.title = `Rnd ${knittingRow} — work right to left`;
            } else {
                rightEl.classList.add('row-hidden');
            }
        } else {
            const isRS = (state.firstRow === 'RS') ? isOdd : !isOdd;
            const side = isRS ? 'right' : 'left';
            if (side === 'right') {
                leftEl.classList.add('row-hidden');
                if (show) {
                    rightEl.innerHTML = makeArrow('\u25C0') + knittingRow;
                    rightEl.classList.add(isRS ? 'row-rs' : 'row-ws');
                    rightEl.title = `Row ${knittingRow} (${isRS ? 'RS' : 'WS'}) — work right to left`;
                } else {
                    rightEl.classList.add('row-hidden');
                }
            } else {
                if (show) {
                    leftEl.innerHTML = knittingRow + makeArrow('\u25B6');
                    leftEl.classList.add(isRS ? 'row-rs' : 'row-ws');
                    leftEl.title = `Row ${knittingRow} (${isRS ? 'RS' : 'WS'}) — work left to right`;
                } else {
                    leftEl.classList.add('row-hidden');
                }
                rightEl.classList.add('row-hidden');
            }
        }

        leftNums.appendChild(leftEl);
        rightNums.appendChild(rightEl);
    }

    // Column numbers — read right-to-left: rightmost cell is column 1, leftmost is column N
    for (let c = 0; c < state.cols; c++) {
        const colNumber = state.cols - c;
        const show = showCol(colNumber);
        const top = document.createElement('div');
        top.className = 'col-number';
        if (show) top.textContent = colNumber;
        else top.classList.add('col-hidden');
        colNumsTop.appendChild(top);
        if (colNumsBot) {
            const bot = document.createElement('div');
            bot.className = 'col-number';
            if (show) bot.textContent = colNumber;
            else bot.classList.add('col-hidden');
            colNumsBot.appendChild(bot);
        }
    }
}

function paintCell(row, col) {
    if (row < 0 || row >= state.rows || col < 0 || col >= state.cols) return;

    // Erase toggles take priority over the active tool — both can be on at
    // once, in which case the click clears stitch AND colour.
    if (state.eraseStitch || state.eraseColour) {
        if (state.eraseStitch) clearStitchInCell(row, col);
        if (state.eraseColour) state.grid[row][col] = null;
    } else if (state.activeTool === 'fill') {
        floodFill(row, col, state.grid[row][col], state.activeColor);
    } else {
        // Toggle: if cell already has the active colour, clear it
        if (state.grid[row][col] === state.activeColor) {
            state.grid[row][col] = null;
        } else {
            state.grid[row][col] = state.activeColor;
        }
    }

    updateCellDOM(row, col);
    if (state.eraseStitch && typeof renderStitchOverlay === 'function') renderStitchOverlay();
}

// Clear the stitch from a single cell — extracted so the Erase Stitch toggle
// (Tool section) and the legacy stitch-erase tile both go through one place.
// Erasing a cell that's part of a multi-cell crossing clears the whole group.
function clearStitchInCell(row, col) {
    if (!state.stitchGrid[row]) return;
    const existing = state.stitchGrid[row][col];
    if (existing && typeof existing === 'object' && existing.id) {
        const id = existing.id;
        for (let cc = 0; cc < state.cols; cc++) {
            const s = state.stitchGrid[row][cc];
            if (s && typeof s === 'object' && s.id === id) {
                state.stitchGrid[row][cc] = null;
            }
        }
    } else {
        state.stitchGrid[row][col] = null;
    }
}

// Additive paint: used during a drag stroke. Only sets the cell to the active
// colour (never toggles off) so sweeping across already-painted cells doesn't
// flicker them. Erase/fill fall through to the toggling paintCell behaviour.
function paintCellAdditive(row, col) {
    if (row < 0 || row >= state.rows || col < 0 || col >= state.cols) return;
    // Erase toggles + Fill: drag through paintCell so each cell on the stroke
    // gets its full erase / flood-fill behaviour.
    if (state.eraseStitch || state.eraseColour || state.activeTool === 'fill') {
        paintCell(row, col);
        return;
    }
    if (state.grid[row][col] !== state.activeColor) {
        state.grid[row][col] = state.activeColor;
        updateCellDOM(row, col);
    }
}

function updateCellDOM(row, col) {
    // Preserved name for minimal diff across callers — canvas path now.
    GridView.redrawCell(row, col);
}

function floodFill(row, col, targetColor, fillColor) {
    if (targetColor === fillColor) return;
    if (row < 0 || row >= state.rows || col < 0 || col >= state.cols) return;
    if (state.grid[row][col] !== targetColor) return;

    const stack = [[row, col]];
    const visited = new Set();

    while (stack.length) {
        const [r, c] = stack.pop();
        const key = `${r},${c}`;
        if (visited.has(key)) continue;
        if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) continue;
        if (state.grid[r][c] !== targetColor) continue;

        visited.add(key);
        state.grid[r][c] = fillColor;
        updateCellDOM(r, c);

        stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
    }
}

// === Events ===
function bindEvents() {
    const container = document.getElementById('grid-container');

    // Mouse painting & selection — hit-test via GridView (no more DOM cells).
    container.addEventListener('mousedown', (e) => {
        const hit = GridView.cellAt(e.clientX, e.clientY);
        if (!hit) return;
        e.preventDefault();
        const r = hit.r, c = hit.c;

        // Erase toggles always win — when either is on, click erases that
        // aspect (stitch and/or colour) regardless of the current tool mode.
        // Selection / stitch / fill modes are suspended for the duration.
        if (state.eraseStitch || state.eraseColour) {
            state.isPainting = true;
            state.paintStartCell = { r, c };
            state.paintDragged = false;
            paintCell(r, c);
            return;
        }

        if (state.activeTool === 'select') {
            if (state.isPasting) {
                // Left-click commits and STAYS armed so successive clicks
                // multi-paste. Non-left buttons are handled by the contextmenu
                // listener (right-click dismisses the ghost) — letting them
                // through here would also commit, which is the bug the user
                // saw as "right-click removes the colour".
                if (e.button !== 0) return;
                commitPaste(r, c);
                return;
            }
            state.isSelecting = true;
            state.selection = { startRow: r, startCol: r, endRow: r, endCol: c };
            state.selection.startCol = c;
            renderSelectionOverlay();
            return;
        }

        // Stitch tool handled in cables.js (capture phase)
        if (state.activeTool === 'stitch') return;

        state.isPainting = true;
        state.paintStartCell = { r, c };
        state.paintDragged = false;
        // First cell still uses toggle semantics — a bare click on an
        // already-active cell should clear it. If the user then drags, the
        // move handler promotes this stroke to additive and undoes the toggle
        // if needed.
        paintCell(r, c);
    });

    container.addEventListener('mousemove', (e) => {
        const hit = GridView.cellAt(e.clientX, e.clientY);
        if (!hit) return;
        const r = hit.r, c = hit.c;

        // Drag-erase: continue erasing across cells while either toggle is on.
        if ((state.eraseStitch || state.eraseColour) && state.isPainting) {
            const start = state.paintStartCell;
            if (start && r === start.r && c === start.c) return;
            state.paintDragged = true;
            paintCellAdditive(r, c);
            return;
        }

        if (state.activeTool === 'select') {
            if (state.isSelecting) {
                state.selection.endRow = r;
                state.selection.endCol = c;
                renderSelectionOverlay();
            }
            if (state.isPasting) {
                state.pasteGhostPos = { row: r, col: c };
                renderPasteGhost();
            }
            return;
        }

        // Stitch tool handled in cables.js (capture phase)
        if (state.activeTool === 'stitch') return;

        if (!state.isPainting || state.activeTool === 'fill') return;

        // Still on the same cell as mousedown — nothing to do yet
        const start = state.paintStartCell;
        if (start && r === start.r && c === start.c) return;

        // We've moved to a different cell → this is a drag, not a click.
        // On the first move, promote the stroke to additive-only and repair
        // the start cell if the initial toggle cleared it.
        if (!state.paintDragged && start) {
            state.paintDragged = true;
            if (!state.eraseStitch && !state.eraseColour && state.activeTool !== 'fill') {
                if (state.grid[start.r][start.c] !== state.activeColor) {
                    state.grid[start.r][start.c] = state.activeColor;
                    updateCellDOM(start.r, start.c);
                }
            }
        }

        paintCellAdditive(r, c);
    });

    document.addEventListener('mouseup', () => {
        if (state.isSelecting) {
            state.isSelecting = false;
            const actions = document.getElementById('selection-actions');
            if (actions) actions.style.display = 'flex';
            return;
        }
        if (state.isPainting) {
            state.isPainting = false;
            state.paintStartCell = null;
            state.paintDragged = false;
            pushHistory();
        }
    });

    // Right-click: cancel paste-ghost mode if armed (no commit, no erase),
    // otherwise erase the right-clicked cell's colour. The "no commit" half
    // matters because mousedown fires before contextmenu — without the
    // mousedown guard above, right-click would commit AND erase, dropping a
    // visible hole into the just-pasted block.
    container.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (state.isPasting) { cancelPaste(); return; }
        const hit = GridView.cellAt(e.clientX, e.clientY);
        if (!hit) return;
        state.grid[hit.r][hit.c] = null;
        updateCellDOM(hit.r, hit.c);
        pushHistory();
    });

    // Touch support — mirrors the mouse tap/drag logic so a sweep only paints.
    container.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        const hit = GridView.cellAt(touch.clientX, touch.clientY);
        if (!hit) return;
        e.preventDefault();
        const r = hit.r, c = hit.c;
        state.isPainting = true;
        state.paintStartCell = { r, c };
        state.paintDragged = false;
        paintCell(r, c);
    }, { passive: false });

    container.addEventListener('touchmove', (e) => {
        if (!state.isPainting || state.activeTool === 'fill') return;
        const touch = e.touches[0];
        const hit = GridView.cellAt(touch.clientX, touch.clientY);
        if (!hit) return;
        e.preventDefault();
        const r = hit.r, c = hit.c;

        const start = state.paintStartCell;
        if (start && r === start.r && c === start.c) return;

        if (!state.paintDragged && start) {
            state.paintDragged = true;
            if (!state.eraseStitch && !state.eraseColour && state.activeTool !== 'fill') {
                if (state.grid[start.r][start.c] !== state.activeColor) {
                    state.grid[start.r][start.c] = state.activeColor;
                    updateCellDOM(start.r, start.c);
                }
            }
        }

        paintCellAdditive(r, c);
    }, { passive: false });

    container.addEventListener('touchend', () => {
        if (state.isPainting) {
            state.isPainting = false;
            state.paintStartCell = null;
            state.paintDragged = false;
            pushHistory();
        }
    });

    // Knitting mode toggle
    document.getElementById('knitting-mode').addEventListener('change', (e) => {
        state.knittingMode = e.target.value;
        updateFirstRowPickerVisibility();
        renderNumbers();
        updateStatusBar();
    });

    // R1 RS/WS picker (flat mode only)
    document.querySelectorAll('input[name="first-row"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                state.firstRow = e.target.value;
                renderNumbers();
            }
        });
    });
    updateFirstRowPickerVisibility();

    // Toolbar buttons
    document.getElementById('btn-resize').addEventListener('click', () => {
        const rows = clamp(+document.getElementById('grid-rows').value, 2, 1000);
        const cols = clamp(+document.getElementById('grid-cols').value, 2, 1000);
        document.getElementById('grid-rows').value = rows;
        document.getElementById('grid-cols').value = cols;
        // Knit mode caches per-row instructions for the CURRENT grid geometry;
        // if dimensions change out from under it, those indices point into
        // empty space. Safest: exit knit mode and let the user re-enter.
        if (typeof knitState !== 'undefined' && knitState.active && typeof exitKnitMode === 'function') {
            exitKnitMode();
            showToast('Exited knit mode (grid resized)');
        }
        initGrid(rows, cols);
        pushHistory();
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
        for (let r = 0; r < state.rows; r++)
            for (let c = 0; c < state.cols; c++) {
                state.grid[r][c] = null;
                if (state.stitchGrid[r]) state.stitchGrid[r][c] = null;
            }
        renderGrid();
        pushHistory();
    });

    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
    document.getElementById('btn-preview').addEventListener('click', openPreview);
    document.getElementById('btn-save').addEventListener('click', saveToFile);
    document.getElementById('btn-load').addEventListener('click', loadFromFile);

    // Tool buttons
    document.getElementById('tool-paint').addEventListener('click', () => setTool('paint'));
    document.getElementById('tool-fill').addEventListener('click', () => setTool('fill'));
    document.getElementById('tool-select').addEventListener('click', () => setTool('select'));
    document.getElementById('tool-erase-stitch')?.addEventListener('click', toggleEraseStitch);
    document.getElementById('tool-erase-colour')?.addEventListener('click', toggleEraseColour);

    // Selection action buttons
    document.getElementById('btn-copy').addEventListener('click', copySelection);
    document.getElementById('btn-cut').addEventListener('click', cutSelection);
    document.getElementById('btn-paste').addEventListener('click', pasteClipboard);
    document.getElementById('btn-deselect').addEventListener('click', clearSelection);

    // File input handler
    document.getElementById('file-input').addEventListener('change', handleFileLoad);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Don't hijack keys while the user is typing — Ctrl+Z should undo
        // textbox content, Delete should delete a character, etc. Escape is
        // exempt so the user can still dismiss a paste-in-progress / clear
        // a grid selection without having to click out of the field first.
        const editing = isEditableTarget(e.target);
        if (editing && e.key !== 'Escape') return;
        if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
        if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
        if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveToFile(); }
        if (e.ctrlKey && e.key === 'c' && state.selection) { e.preventDefault(); copySelection(); }
        if (e.ctrlKey && e.key === 'x' && state.selection) { e.preventDefault(); cutSelection(); }
        if (e.ctrlKey && e.key === 'v' && state.clipboard) { e.preventDefault(); pasteClipboard(); }
        if (e.key === 'Escape') {
            if (state.isPasting) cancelPaste();
            else if (state.selection) clearSelection();
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection && !state.isPasting) {
            e.preventDefault();
            deleteSelection();
        }
    });

    // Preview modal
    document.getElementById('preview-close').addEventListener('click', closePreview);
    document.getElementById('preview-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closePreview();
    });
    document.getElementById('btn-refresh-preview').addEventListener('click', renderPreview);
    document.getElementById('preview-repeat').addEventListener('change', renderPreview);
    document.getElementById('preview-tiles').addEventListener('change', renderPreview);
}

function setTool(tool) {
    if (state.activeTool === 'select' && tool !== 'select') {
        clearSelection();
    }
    state.activeTool = tool;
    // Picking a primary tool clears both erase toggles — they're modal
    // additions, not paint modes themselves.
    state.eraseStitch = false;
    state.eraseColour = false;
    updateToolButtons();
}

// Toggle one of the erase modifiers. They're independent of activeTool and
// of each other; both can be on at once.
function toggleEraseStitch() {
    state.eraseStitch = !state.eraseStitch;
    updateToolButtons();
}
function toggleEraseColour() {
    state.eraseColour = !state.eraseColour;
    updateToolButtons();
}

function updateToolButtons() {
    // While either erase toggle is on, Paint / Fill / Select read as
    // "suspended" — clicking still does erase work, so the highlight
    // shouldn't lie about what's actually happening. The underlying
    // state.activeTool is kept intact so toggling erase off restores
    // the previous mode visually.
    const erasing = state.eraseStitch || state.eraseColour;
    document.querySelectorAll('.tool-btn').forEach(btn => {
        if (btn.id === 'tool-erase-stitch' || btn.id === 'tool-erase-colour') return;
        btn.classList.toggle('active', !erasing && btn.id === `tool-${state.activeTool}`);
    });
    document.getElementById('tool-erase-stitch')?.classList.toggle('active', state.eraseStitch);
    document.getElementById('tool-erase-colour')?.classList.toggle('active', state.eraseColour);
}

// === History (Undo/Redo) ===
function deepCopyStitchGrid(sg) {
    return sg.map(row => row.map(cell =>
        cell === null || typeof cell === 'string' ? cell : { ...cell }
    ));
}

// Adapt the undo cap to grid size. At 1000×1000 with 50 snapshots we'd burn
// ~800MB of memory just for history; targeting ~50MB total instead by scaling
// the cap down for big grids. A 200×200 chart still gets the full 50 levels;
// big-pattern users get fewer levels in exchange for the app actually running.
function effectiveMaxHistory() {
    const cells = (state.rows || 1) * (state.cols || 1);
    return Math.max(5, Math.min(state.maxHistory, Math.floor(3_000_000 / cells)));
}

function pushHistory() {
    const snapshot = state.grid.map(row => [...row]);
    const stitchSnapshot = deepCopyStitchGrid(state.stitchGrid);
    // Remove any future states after current index
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push({ grid: snapshot, stitchGrid: stitchSnapshot, rows: state.rows, cols: state.cols });
    const cap = effectiveMaxHistory();
    while (state.history.length > cap) {
        state.history.shift();
    }
    state.historyIndex = state.history.length - 1;
    updateUndoRedoButtons();
    updateStatusBar();
}

function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    restoreHistory();
}

function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    restoreHistory();
}

function restoreHistory() {
    const snap = state.history[state.historyIndex];
    state.rows = snap.rows;
    state.cols = snap.cols;
    state.grid = snap.grid.map(row => [...row]);
    state.stitchGrid = snap.stitchGrid ? deepCopyStitchGrid(snap.stitchGrid) : initEmptyStitchGrid(snap.rows, snap.cols);
    document.getElementById('grid-rows').value = state.rows;
    document.getElementById('grid-cols').value = state.cols;
    renderGrid();
    updateUndoRedoButtons();
}

function initEmptyStitchGrid(rows, cols) {
    const sg = [];
    for (let r = 0; r < rows; r++) {
        sg[r] = [];
        for (let c = 0; c < cols; c++) sg[r][c] = null;
    }
    return sg;
}

function updateUndoRedoButtons() {
    document.getElementById('btn-undo').disabled = state.historyIndex <= 0;
    document.getElementById('btn-redo').disabled = state.historyIndex >= state.history.length - 1;
}

// === File Save/Load ===
function restorePatternData(data) {
    // Loading a pattern replaces the whole grid; any active knit-mode session
    // is referring to the previous grid's geometry. Bail out of it cleanly.
    if (typeof knitState !== 'undefined' && knitState.active && typeof exitKnitMode === 'function') {
        exitKnitMode();
    }
    state.rows = data.rows;
    state.cols = data.cols;
    state.grid = data.grid;
    state.stitchGrid = data.stitchGrid || initEmptyStitchGrid(data.rows, data.cols);
    state.patternName = data.name || '';
    state.knittingMode = data.knittingMode || 'flat';
    state.firstRow = data.firstRow || 'RS';
    state.customInstructions = data.customInstructions || null;
    if (Array.isArray(data.activeStitches)) {
        state.activeStitches = new Set(data.activeStitches);
    } else {
        // Legacy pattern file with no active list — preserve the old behaviour
        // (every known stitch visible) so loading it doesn't silently shrink
        // the palette. The user can prune via the gallery overlay.
        state.activeStitches = new Set(
            (typeof StitchRegistry !== 'undefined' ? StitchRegistry.getAll() : []).map(s => s.id)
        );
    }
    document.getElementById('grid-rows').value = state.rows;
    document.getElementById('grid-cols').value = state.cols;
    document.getElementById('pattern-name').value = state.patternName;
    document.getElementById('knitting-mode').value = state.knittingMode;
    // Restore R1 radio
    const firstRowRadio = document.querySelector(`input[name="first-row"][value="${state.firstRow}"]`);
    if (firstRowRadio) firstRowRadio.checked = true;
    updateFirstRowPickerVisibility();
    // The active set changed, so the palette must reflect it (built-ins may
    // have been hidden, or new user stitches added that the loaded project
    // wants visible).
    if (typeof initStitchPalette === 'function') initStitchPalette();
    renderGrid();
    state.history = [];
    state.historyIndex = -1;
    pushHistory();
    markSaved();
}

// Collect every user-defined stitch the current pattern is actually using,
// as plain JSON records (no function refs). Saved alongside the grid so the
// pattern renders correctly when opened on a fresh device.
function collectUsedUserStitches() {
    if (typeof StitchRegistry === 'undefined') return [];
    const used = new Set();
    for (const row of state.stitchGrid) {
        if (!row) continue;
        for (const s of row) {
            if (typeof s === 'string') used.add(s);
            else if (s && typeof s === 'object' && s.type === 'user-multi' && s.stitchId) {
                used.add(s.stitchId);
            }
        }
    }
    const records = [];
    for (const id of used) {
        const def = StitchRegistry.get(id);
        if (!def || def.source !== 'user') continue;
        // The hydrated entry holds function refs; fall back to the raw stored
        // record if we have one, otherwise rebuild a clean serialisable copy.
        if (def._record) {
            records.push(def._record);
        } else {
            records.push({
                id: def.id,
                label: def.label,
                sublabel: def.sublabel || null,
                title: def.title || '',
                code: def.code || def.id,
                detailedInstructions: def.detailedInstructions || '',
                shapes: def.shapes || [],
                source: 'user',
                order: def.order ?? 500,
            });
        }
    }
    return records;
}

function saveToFile() {
    const name = document.getElementById('pattern-name').value.trim() || 'untitled';
    state.patternName = name;
    const data = {
        version: 3,
        name: name,
        rows: state.rows,
        cols: state.cols,
        grid: state.grid,
        stitchGrid: state.stitchGrid,
        knittingMode: state.knittingMode,
        firstRow: state.firstRow,
        customInstructions: state.customInstructions,
        // Custom stitches the pattern depends on. Empty array if none used.
        userStitches: collectUsedUserStitches(),
        // Which stitches the palette is showing for this project. Loader
        // restores this verbatim; legacy files without it fall back to
        // "everything visible" (see restorePatternData).
        activeStitches: state.activeStitches ? [...state.activeStitches] : [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9_-]/gi, '_')}.knit.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Saved "${name}"`);
    markSaved();
}

// === Masthead saved-status indicator ===
let lastSavedAt = null;
function markSaved() {
    lastSavedAt = Date.now();
    updateSavedLabel();
}
function updateSavedLabel() {
    const el = document.getElementById('masthead-saved');
    if (!el) return;
    if (!lastSavedAt) {
        el.textContent = 'Unsaved';
        el.classList.add('unsaved');
        return;
    }
    const mins = Math.floor((Date.now() - lastSavedAt) / 60000);
    el.classList.remove('unsaved');
    if (mins < 1) el.textContent = 'Saved · just now';
    else if (mins === 1) el.textContent = 'Saved · 1m ago';
    else if (mins < 60) el.textContent = `Saved · ${mins}m ago`;
    else {
        const hrs = Math.floor(mins / 60);
        el.textContent = `Saved · ${hrs}h ago`;
    }
}
// Update the "Saved Xm ago" label every 30s
setInterval(updateSavedLabel, 30000);

function updateFirstRowPickerVisibility() {
    const picker = document.getElementById('first-row-picker');
    if (!picker) return;
    picker.classList.toggle('hidden', state.knittingMode !== 'flat');
}

// === Status Bar ===
// === Zoom ===
// Excel-style: Ctrl + scroll wheel changes zoom, Ctrl +/- and Ctrl 0 keyboard.
// All paths anchor to the cursor (or last cursor position over the canvas)
// so the point under the cursor stays under the cursor across the zoom.
const ZOOM_MIN = 0.1;   // ~2px cells — lets a 300x300 chart fit a laptop screen
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 1.15;

function setZoom(newZoom, anchorClientX, anchorClientY) {
    newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    const oldZoom = state.zoom;
    if (Math.abs(newZoom - oldZoom) < 0.001) return;

    const canvasArea = document.querySelector('.canvas-area');
    const gridWrapper = document.querySelector('.grid-wrapper');

    // Pre-zoom: capture the content-space position under the anchor so we can
    // restore it after the reflow.
    let contentX = null, contentY = null, viewX = null, viewY = null;
    if (canvasArea && gridWrapper && anchorClientX != null) {
        const wrapRect = gridWrapper.getBoundingClientRect();
        const areaRect = canvasArea.getBoundingClientRect();
        viewX = anchorClientX - areaRect.left;
        viewY = anchorClientY - areaRect.top;
        contentX = anchorClientX - wrapRect.left;
        contentY = anchorClientY - wrapRect.top;
    }

    state.zoom = newZoom;
    document.documentElement.style.setProperty('--zoom', String(newZoom));

    // Resize + repaint the canvas grid at the new scale.
    if (typeof GridView !== 'undefined') GridView.rerender();
    // Row/col labels may need to thin out (or fill back in) at the new cell size.
    renderNumbers();
    if (typeof renderStitchOverlay === 'function') renderStitchOverlay();
    if (typeof renderSelectionOverlay === 'function') renderSelectionOverlay();

    // Restore the anchor: after the wrapper resizes by (newZoom/oldZoom),
    // nudge the scroll so the same content point sits under the cursor.
    if (canvasArea && gridWrapper && contentX != null) {
        const ratio = newZoom / oldZoom;
        const targetContentX = contentX * ratio;
        const targetContentY = contentY * ratio;
        const newWrapRect = gridWrapper.getBoundingClientRect();
        const newAreaRect = canvasArea.getBoundingClientRect();
        const currentContentX = anchorClientX - newWrapRect.left;
        const currentContentY = anchorClientY - newWrapRect.top;
        canvasArea.scrollLeft += targetContentX - currentContentX;
        canvasArea.scrollTop  += targetContentY - currentContentY;
    }

    updateZoomIndicator();
}

function updateZoomIndicator() {
    const el = document.getElementById('status-zoom');
    if (el) el.textContent = `${Math.round(state.zoom * 100)}%`;
}

function bindZoom() {
    const canvasArea = document.querySelector('.canvas-area');
    if (!canvasArea) return;

    // Track the last cursor position over the canvas so keyboard zoom
    // (Ctrl +/-) can anchor to wherever the user is looking. Wheel-zoom
    // gets its anchor from the wheel event itself; this is for the paths
    // that don't carry one.
    let lastCanvasX = null, lastCanvasY = null;
    canvasArea.addEventListener('mousemove', (e) => {
        lastCanvasX = e.clientX;
        lastCanvasY = e.clientY;
    });
    canvasArea.addEventListener('mouseleave', () => {
        // Forget the cursor on leave — falling back to the canvas centre is
        // less surprising than zooming toward an off-canvas anchor that's
        // probably stale (e.g. user moved to the side panels).
        lastCanvasX = null;
        lastCanvasY = null;
    });

    // Ctrl (or Cmd) + wheel = zoom; pass wheel through for scroll otherwise.
    canvasArea.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        const factor = dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        setZoom(state.zoom * factor, e.clientX, e.clientY);
    }, { passive: false });

    // Pick the anchor for keyboard / pill-click zoom: cursor if we have
    // one, otherwise the centre of the visible canvas area so the user's
    // current view doesn't drift toward the top-left after a resize.
    const keyboardAnchor = () => {
        if (lastCanvasX != null && lastCanvasY != null) {
            return { x: lastCanvasX, y: lastCanvasY };
        }
        const rect = canvasArea.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    // Keyboard shortcuts — Ctrl +/-/0. Match against both layouts.
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        // Skip when typing in an input / editable surface
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            const a = keyboardAnchor();
            setZoom(state.zoom * ZOOM_STEP, a.x, a.y);
        } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            const a = keyboardAnchor();
            setZoom(state.zoom / ZOOM_STEP, a.x, a.y);
        } else if (e.key === '0') {
            e.preventDefault();
            const a = keyboardAnchor();
            setZoom(1.0, a.x, a.y);
        }
    });

    // Click the status-bar zoom pill to reset to 100%.
    const pill = document.getElementById('status-zoom');
    if (pill) pill.addEventListener('click', () => setZoom(1.0));
}

function updateStatusBar() {
    const stitchesEl = document.getElementById('status-stitches');
    const coloursEl = document.getElementById('status-colours');
    const modeEl = document.getElementById('status-mode');
    if (!stitchesEl) return;

    // Count "active" stitches (cells that aren't no-stitch and have either colour or stitch data)
    let active = 0;
    const coloursSet = new Set();
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            const stitch = state.stitchGrid[r] ? state.stitchGrid[r][c] : null;
            if (stitch === 'no-stitch') continue;
            const color = state.grid[r][c];
            if (color !== null || stitch) active++;
            if (color) coloursSet.add(color);
        }
    }

    stitchesEl.textContent = `${active} stitch${active === 1 ? '' : 'es'}`;
    const cn = coloursSet.size;
    coloursEl.textContent = `${cn} colour${cn === 1 ? '' : 's'}`;
    modeEl.textContent = state.knittingMode === 'round' ? 'in the round' : 'flat';
}

function loadFromFile() {
    document.getElementById('file-input').click();
}

// Import any custom-stitch definitions the pattern file carries with it.
// Uses the deferred-conflict path: new stitches imported silently, identical
// ones no-op'd, and conflicting ones returned for review (they are NOT applied
// to the gallery — the recipient's existing icons are kept until the user
// reviews the conflicts via the import-conflict banner).
async function importUserStitchesFromPattern(data) {
    const list = Array.isArray(data && data.userStitches) ? data.userStitches : [];
    if (list.length === 0 || typeof mergePatternUserStitches !== 'function') {
        return { imported: 0, identical: 0, conflicts: [], failed: 0 };
    }
    return await mergePatternUserStitches(list);
}

function handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (!data.rows || !data.cols || !data.grid) {
                showToast('Invalid pattern file', { tone: 'error' });
                return;
            }
            // Hydrate any user stitches BEFORE restoring the grid so the
            // overlay renderer has every stitch definition it needs.
            const result = await importUserStitchesFromPattern(data);
            restorePatternData(data);

            // Surface conflicts via the review banner, not a blocking dialog —
            // the pattern always opens; gallery is never silently mutated.
            if (typeof showImportConflictBanner === 'function') {
                if (result.conflicts && result.conflicts.length > 0) {
                    showImportConflictBanner(result.conflicts);
                } else if (typeof hideImportConflictBanner === 'function') {
                    hideImportConflictBanner();
                }
            }

            const base = `Loaded "${data.name || file.name}"`;
            const bits = [];
            if (result.imported)             bits.push(`${result.imported} added`);
            if (result.identical)            bits.push(`${result.identical} matched`);
            if (result.conflicts?.length)    bits.push(`${result.conflicts.length} differ — review`);
            if (result.failed)               bits.push(`${result.failed} failed`);
            showToast(bits.length ? `${base} — ${bits.join(', ')}` : base);

            const missing = getMissingGridStitches();
            if (missing.length) {
                const ids = missing.map(id => `'${id}'`).join(', ');
                const noun = missing.length === 1 ? 'a stitch' : `${missing.length} stitches`;
                showToast(
                    `Pattern uses ${noun} not in your gallery: ${ids}. Cells will show the code as text — add the stitch to replace it with an icon.`,
                    { tone: 'warn' }
                );
            }
        } catch (err) {
            console.error(err);
            showToast('Could not read file', { tone: 'error' });
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

// === Utility ===
function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

// Toast — bottom-centre status message. The × dismisses immediately; otherwise
// it fades out after TOAST_LIFETIME_MS so the stack doesn't accumulate. Editor-
// linked toasts are also cleared when the editor overlay closes (see
// closeStitchEditor); the timer is just a safety net for stray ones.
//
// `tone` controls the colour treatment:
//   'info'  (default) — soft sage green, matches the workbench's "Right side"
//                       indicator; for confirmations and neutral status.
//   'error'           — soft red, matches the masthead accent; for failures,
//                       validation issues, missing-stitch warnings.
const TOAST_LIFETIME_MS = 10_000;
const TOAST_FADE_MS = 400;
function showToast(msg, opts = {}) {
    let stack = document.getElementById('toast-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toast-stack';
        stack.className = 'toast-stack';
        document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    const tone = opts.tone === 'error' ? 'error' : 'info';
    toast.className = 'toast toast-' + tone;
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = msg;
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.title = 'Dismiss';
    close.innerHTML = '&times;';
    close.addEventListener('click', () => toast.remove());
    toast.appendChild(text);
    toast.appendChild(close);
    stack.appendChild(toast);
    // Auto-fade so the stack doesn't grow unbounded if the user ignores them.
    setTimeout(() => {
        if (!toast.parentElement) return;
        toast.classList.add('toast-fading');
        setTimeout(() => toast.remove(), TOAST_FADE_MS);
    }, TOAST_LIFETIME_MS);
}

// Styled replacement for window.confirm — same modal aesthetic as the rest of
// the app, supports 2 or 3 buttons. Returns a Promise resolving to the chosen
// button id (or null if dismissed via overlay click / Escape).
//
// buttons: array of { id, label, kind?: 'primary' | 'danger' }. The first
// button is treated as the "default" (focused on open).
function confirmDialog({ title = 'Are you sure?', message = '', buttons = [] }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay confirm-overlay open';
        overlay.style.display = 'flex';
        const modal = document.createElement('div');
        modal.className = 'modal modal-narrow confirm-modal';
        modal.innerHTML = '<div class="modal-header"><h2></h2></div>'
            + '<div class="modal-body confirm-body"><p class="confirm-message"></p></div>'
            + '<div class="modal-footer confirm-footer"></div>';
        modal.querySelector('h2').textContent = title;
        modal.querySelector('.confirm-message').textContent = message;
        const footer = modal.querySelector('.confirm-footer');
        let resolved = false;
        const close = (id) => {
            if (resolved) return;
            resolved = true;
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(id);
        };
        let firstBtn = null;
        for (const def of buttons) {
            const b = document.createElement('button');
            b.textContent = def.label;
            if (def.kind === 'primary') b.className = 'btn-primary';
            else if (def.kind === 'danger') b.className = 'btn-danger';
            b.addEventListener('click', () => close(def.id));
            footer.appendChild(b);
            if (!firstBtn) firstBtn = b;
        }
        const onKey = (e) => {
            if (e.key === 'Escape') close(null);
            else if (e.key === 'Enter' && firstBtn) firstBtn.click();
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        document.addEventListener('keydown', onKey);
        // Don't autofocus — Enter still triggers via onKey, and a focus ring on
        // the first button is distracting in a "are you sure" dialog.
    });
}

// === Pattern region ===
// The "pattern" is whatever the user will get instructions / knit mode for.
// Rule: if there's a useful selection, that's the pattern. Otherwise the
// whole grid is the pattern (no auto-trim). This matches what most users
// expect at larger grid sizes — if you resized to 300×300 on purpose, that's
// your pattern, blank cells included (they'll read as BG in instructions).
function getPatternBounds() {
    const sel = normalizeSelection();
    const selIsUseful = sel && (sel.maxR > sel.minR || sel.maxC > sel.minC);
    if (selIsUseful) {
        return { minR: sel.minR, maxR: sel.maxR, minC: sel.minC, maxC: sel.maxC };
    }
    // Whole grid — if the grid is empty we return null so callers can bail.
    if (state.rows === 0 || state.cols === 0) return null;
    return { minR: 0, maxR: state.rows - 1, minC: 0, maxC: state.cols - 1 };
}

// Returns the colour grid for the current pattern region, or null if empty.
function getPatternRegion() {
    const bounds = getPatternBounds();
    if (!bounds) return null;
    const pattern = [];
    for (let r = bounds.minR; r <= bounds.maxR; r++) {
        const row = [];
        for (let c = bounds.minC; c <= bounds.maxC; c++) {
            row.push(state.grid[r][c]);
        }
        pattern.push(row);
    }
    // If a selection is in play and the region is entirely blank (no colour
    // AND no stitch), treat as empty so preview/instructions don't generate
    // a meaningless all-BG output.
    const sel = normalizeSelection();
    const selIsUseful = sel && (sel.maxR > sel.minR || sel.maxC > sel.minC);
    if (selIsUseful) {
        const hasContent = pattern.some((row, ri) => row.some((c, ci) => {
            if (c !== null) return true;
            const sr = bounds.minR + ri, sc = bounds.minC + ci;
            return !!(state.stitchGrid[sr] && state.stitchGrid[sr][sc]);
        }));
        if (!hasContent) return null;
    }
    return pattern;
}

// Kept under its old name for the few callers that still use it; forwards
// to getPatternBounds so the region stays consistent everywhere.
function getTrimmedBounds() {
    return getPatternBounds();
}

// === Selection / Copy-Paste ===
function normalizeSelection() {
    if (!state.selection) return null;
    const s = state.selection;
    return {
        minR: Math.min(s.startRow, s.endRow),
        maxR: Math.max(s.startRow, s.endRow),
        minC: Math.min(s.startCol, s.endCol),
        maxC: Math.max(s.startCol, s.endCol),
    };
}

function renderSelectionOverlay() {
    const sel = normalizeSelection();

    // Tint the selected cells via the canvas overlay.
    GridView.setSelection(sel);

    // Rebuild the dashed selection box — positioned in grid-canvas-wrapper
    // space using GridView cell bounds. grid-container sits at (0, 0) of the
    // wrapper, so cell bounds translate straight across.
    let box = document.getElementById('selection-box');
    if (box) box.remove();
    if (!sel) return;

    const tl = GridView.cellBoundsWrapper(sel.minR, sel.minC);
    const br = GridView.cellBoundsWrapper(sel.maxR, sel.maxC);

    box = document.createElement('div');
    box.id = 'selection-box';
    box.style.cssText = `
        position: absolute;
        border: 2px dashed #2a211a;
        box-shadow: 0 0 0 1px rgba(251, 247, 236, 0.9);
        pointer-events: none;
        z-index: 6;
        border-radius: 2px;
        box-sizing: border-box;
        left: ${tl.x - 1}px;
        top: ${tl.y - 1}px;
        width: ${(br.x + br.w) - tl.x + 2}px;
        height: ${(br.y + br.h) - tl.y + 2}px;
    `;

    const container = document.getElementById('grid-container');
    const wrapper = container.closest('.grid-canvas-wrapper');
    if (wrapper) wrapper.appendChild(box);
}

function clearSelection() {
    state.selection = null;
    state.isSelecting = false;
    cancelPaste();
    GridView.clearSelectionHighlight();
    const box = document.getElementById('selection-box');
    if (box) box.remove();
    const actions = document.getElementById('selection-actions');
    if (actions) actions.style.display = 'none';
}

function cancelPaste() {
    state.isPasting = false;
    state.pasteGhostPos = null;
    clearPasteGhost();
}

function clearPasteGhost() {
    GridView.clearPasteGhost();
}

function copySelection() {
    const sel = normalizeSelection();
    if (!sel) return;
    state.clipboard = [];
    state.clipboardStitches = [];
    for (let r = sel.minR; r <= sel.maxR; r++) {
        const colorRow = [];
        const stitchRow = [];
        for (let c = sel.minC; c <= sel.maxC; c++) {
            colorRow.push(state.grid[r][c]);
            const s = state.stitchGrid[r] ? state.stitchGrid[r][c] : null;
            stitchRow.push(s === null || typeof s === 'string' ? s : { ...s });
        }
        state.clipboard.push(colorRow);
        state.clipboardStitches.push(stitchRow);
    }
    // Arm the ghost immediately so the cursor shows where the paste will land
    // — selecting a colour and then pressing Ctrl+C is the user's "I want to
    // place this somewhere" gesture; making them press Ctrl+V too is friction.
    armPasteGhost(sel);
    showToast('Copied — click to place (multi-paste), right-click or Esc to cancel');
}

function cutSelection() {
    const sel = normalizeSelection();
    if (!sel) return;
    // Capture the clipboard FIRST (without arming the ghost — we'll do that
    // ourselves below, after clearing the source region).
    state.clipboard = [];
    state.clipboardStitches = [];
    for (let r = sel.minR; r <= sel.maxR; r++) {
        const colorRow = [];
        const stitchRow = [];
        for (let c = sel.minC; c <= sel.maxC; c++) {
            colorRow.push(state.grid[r][c]);
            const s = state.stitchGrid[r] ? state.stitchGrid[r][c] : null;
            stitchRow.push(s === null || typeof s === 'string' ? s : { ...s });
        }
        state.clipboard.push(colorRow);
        state.clipboardStitches.push(stitchRow);
    }
    // Clear the source region.
    for (let r = sel.minR; r <= sel.maxR; r++) {
        for (let c = sel.minC; c <= sel.maxC; c++) {
            state.grid[r][c] = null;
            if (state.stitchGrid[r]) state.stitchGrid[r][c] = null;
            updateCellDOM(r, c);
        }
    }
    clearSelection();
    renderGrid();
    pushHistory();
    armPasteGhost(sel);
    showToast('Cut — click to place (multi-paste), right-click or Esc to cancel');
}

// Ctrl+V (or Paste button) entry point. Two cases:
//   - Ghost is already armed (e.g. user just hit Ctrl+C and is hovering over
//     the chart): commit at the current ghost position.
//   - Ghost is NOT armed (e.g. user copied earlier, did other work, then
//     reached for Ctrl+V): arm it so the next click commits.
function pasteClipboard() {
    if (!state.clipboard) {
        showToast('Nothing to paste');
        return;
    }
    if (state.isPasting && state.pasteGhostPos) {
        const { row, col } = state.pasteGhostPos;
        commitPaste(row, col);
        return;
    }
    armPasteGhost(normalizeSelection());
    showToast('Click to place (multi-paste) · right-click or Esc to cancel');
}

// Enter paste-ghost mode. Pre-positions the ghost at `seed.minR/minC` if a
// selection-shaped seed is supplied so something visible appears before the
// user moves the mouse — otherwise the ghost stays empty until first hover.
function armPasteGhost(seed) {
    if (!state.clipboard) return;
    state.activeTool = 'select';
    updateToolButtons();
    state.isPasting = true;
    state.pasteGhostPos = seed ? { row: seed.minR, col: seed.minC } : null;
    renderPasteGhost();
}

function renderPasteGhost() {
    if (!state.isPasting || !state.pasteGhostPos || !state.clipboard) {
        GridView.clearPasteGhost();
        return;
    }
    const { row: startR, col: startC } = state.pasteGhostPos;
    const clipRows = state.clipboard.length;
    const clipCols = state.clipboard[0].length;
    const cells = [];
    for (let dr = 0; dr < clipRows; dr++) {
        for (let dc = 0; dc < clipCols; dc++) {
            const r = startR + dr, c = startC + dc;
            if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) continue;
            const color = state.clipboard[dr][dc];
            const stitch = state.clipboardStitches && state.clipboardStitches[dr]
                ? state.clipboardStitches[dr][dc] : null;
            // Skip cells that have neither a colour nor a stitch — they'd
            // paste as blank and don't need to appear in the ghost footprint.
            if (color === null && (stitch === null || stitch === undefined)) continue;
            // Use the cell's colour if it has one; otherwise a faint ink tint
            // so stitch-only cells still appear in the ghost. Without this,
            // copying a stitches-only region produced an invisible ghost.
            cells.push({ r, c, color: color || 'rgba(42,33,26,0.22)' });
        }
    }
    GridView.setPasteGhost(cells);
}

let pasteIdSeq = 0;
function commitPaste(row, col) {
    if (!state.clipboard) return;
    const clipRows = state.clipboard.length;
    const clipCols = state.clipboard[0].length;
    const pasteIdMap = {}; // maps old crossing IDs to new unique ones
    for (let dr = 0; dr < clipRows; dr++) {
        for (let dc = 0; dc < clipCols; dc++) {
            const r = row + dr, c = col + dc;
            if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) continue;
            // Paste colour
            const color = state.clipboard[dr][dc];
            if (color !== null) {
                state.grid[r][c] = color;
            }
            // Paste stitch
            if (state.clipboardStitches && state.clipboardStitches[dr]) {
                const stitch = state.clipboardStitches[dr][dc];
                if (stitch !== null && stitch !== undefined) {
                    if (state.stitchGrid[r]) {
                        if (typeof stitch === 'string') {
                            state.stitchGrid[r][c] = stitch;
                        } else {
                            // Clone with a new unique ID so it doesn't conflict with the original
                            const newId = pasteIdMap[stitch.id] || ('p' + (++pasteIdSeq));
                            pasteIdMap[stitch.id] = newId;
                            state.stitchGrid[r][c] = { ...stitch, id: newId };
                        }
                    }
                }
            }
        }
    }
    renderGrid();
    pushHistory();
    // Stay armed for multi-paste: the ghost remains so successive clicks
    // (or Ctrl+V presses) keep dropping copies. Right-click or Esc dismisses.
    // Re-render the ghost on top of the freshly-pasted content.
    renderPasteGhost();
    // No toast — the pasted region appears immediately; the visual change is
    // its own confirmation.
}

function deleteSelection() {
    const sel = normalizeSelection();
    if (!sel) return;
    for (let r = sel.minR; r <= sel.maxR; r++) {
        for (let c = sel.minC; c <= sel.maxC; c++) {
            state.grid[r][c] = null;
            if (state.stitchGrid[r]) state.stitchGrid[r][c] = null;
            updateCellDOM(r, c);
        }
    }
    clearSelection();
    renderGrid();
    pushHistory();
}
