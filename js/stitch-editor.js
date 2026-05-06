// === Add Stitch Type editor ===
// Modal with a 0..100-coordinate drawing surface + code/instructions form.
// Shapes are stored as JSON (see drawUserStitchShapes in js/stitches.js);
// on save the record persists to IndexedDB and becomes a live registry entry.

const editorState = {
    open: false,
    mode: 'create',         // 'create' | 'edit'  (edit replaces an existing id)
    editingId: null,         // original id when editing
    tool: 'freehand',
    stroke: '#2a211a',
    eraserActive: false,
    strokeWidth: 6,
    // Fill colour for rect/ellipse — independent of the stroke colour.
    // null = "no fill" (stroke-only shape).
    fill: null,
    // True for stitches placed by click-and-drag across 2+ cells (like the
    // built-in cable crosses). The icon renders once on the lead cell with
    // faint echoes on the flanking cells.
    multiCell: false,
    shapes: [],              // committed shapes, painted in order
    pending: null,           // most-recently drawn shape — still editable
    drawing: null,           // shape in progress during a pointer drag
    moving: null,            // { startPoint, origShape } while dragging pending
    draggingHandle: null,    // { handle, startPoint, origShape } while editing a curve vertex
    canvas: null,
    ctx: null,
    detailedTouched: false,
    // Live text-overlay state (see showTextOverlay / commitLiveText)
    textOverlayOpen: false,
    textFontSize: 72,
};

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-add-stitch');
    if (!btn) return;

    btn.addEventListener('click', () => openStitchEditor());
    document.getElementById('stitch-editor-close').addEventListener('click', closeStitchEditor);
    document.getElementById('stitch-editor-cancel').addEventListener('click', closeStitchEditor);
    document.getElementById('stitch-editor-save').addEventListener('click', saveStitch);
    document.getElementById('st-done').addEventListener('click', commitEditing);
    document.getElementById('st-undo').addEventListener('click', undoLastShape);
    document.getElementById('st-clear').addEventListener('click', clearCanvas);

    document.querySelectorAll('#stitch-editor-modal .st-tool-btn').forEach(b => {
        b.addEventListener('click', () => selectTool(b.dataset.tool));
    });

    document.getElementById('st-multi-cell').addEventListener('change', (e) => {
        editorState.multiCell = e.target.checked;
    });

    document.getElementById('st-stroke-width').addEventListener('input', (e) => {
        editorState.strokeWidth = Number(e.target.value);
        // Live-update the pending shape so the user sees the new stroke on the
        // shape they just drew without having to redraw it.
        if (editorState.pending) {
            editorState.pending.strokeWidth = editorState.strokeWidth;
            redrawCanvas();
            renderEditorTilePreview();
        }
    });
    // Fill swatches (4 colours + None). Built lazily in renderColorSwatches.

    // Live text-overlay wiring
    wireTextOverlay();
    document.getElementById('st-text-size').addEventListener('input', (e) => {
        editorState.textFontSize = Number(e.target.value);
        applyOverlayFontSize();
    });

    const codeInput = document.getElementById('st-code');
    codeInput.addEventListener('input', onCodeInput);

    document.getElementById('st-detailed').addEventListener('input', () => {
        editorState.detailedTouched = true;
    });

    document.getElementById('stitch-editor-modal').addEventListener('click', (e) => {
        if (e.target.id === 'stitch-editor-modal') closeStitchEditor();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && editorState.open) closeStitchEditor();
    });
});

// Open in create or edit mode. `existing` is a user-stitch registry entry.
function openStitchEditor(existing = null) {
    resetEditor();
    if (existing) {
        editorState.mode = 'edit';
        editorState.editingId = existing.id;
        editorState.shapes = JSON.parse(JSON.stringify(existing.shapes || []));
        editorState.multiCell = !!existing.multiCell;
        document.getElementById('st-code').value = existing.code || existing.id;
        document.getElementById('st-detailed').value = existing.detailedInstructions || '';
        document.getElementById('st-multi-cell').checked = editorState.multiCell;
        editorState.detailedTouched = !!existing.detailedInstructions;
        document.getElementById('stitch-editor-title').textContent = `Edit Stitch: ${existing.label || existing.id}`;
        document.getElementById('stitch-editor-save').textContent = 'Save changes';
    } else {
        editorState.mode = 'create';
        editorState.editingId = null;
        document.getElementById('stitch-editor-title').textContent = 'Add Stitch Type';
        document.getElementById('stitch-editor-save').textContent = 'Save stitch';
    }

    const modal = document.getElementById('stitch-editor-modal');
    modal.classList.add('open');
    modal.style.display = 'flex';
    editorState.open = true;
    setupCanvas();
    renderEditorTilePreview();
    // Wait one frame so layout has settled before measuring the canvas.
    requestAnimationFrame(updateTextSliderRange);
    setTimeout(() => document.getElementById('st-code').focus(), 50);
}

function closeStitchEditor() {
    const modal = document.getElementById('stitch-editor-modal');
    modal.classList.remove('open');
    modal.style.display = 'none';
    editorState.open = false;
    // Dismiss any validation/error toasts raised from inside the editor.
    // Success toasts (shown after close) aren't tagged, so they survive.
    document.querySelectorAll('.toast.toast-editor').forEach(t => t.remove());
}

// Raise a toast tagged as editor-linked so closeStitchEditor can clear it.
// Use for validation/error messages shown while the overlay is open. Tone
// defaults to 'error' since these are almost always validation failures.
function showEditorToast(msg, opts = {}) {
    showToast(msg, { tone: opts.tone || 'error' });
    const stack = document.getElementById('toast-stack');
    const last = stack && stack.lastElementChild;
    if (last) last.classList.add('toast-editor');
}

function resetEditor() {
    editorState.tool = 'freehand';
    editorState.stroke = STITCH_DESIGN_COLORS[0].hex;
    editorState.eraserActive = false;
    editorState.strokeWidth = 6;
    editorState.fill = null;
    editorState.multiCell = false;
    editorState.shapes = [];
    editorState.pending = null;
    editorState.drawing = null;
    editorState.moving = null;
    editorState.draggingHandle = null;
    editorState.detailedTouched = false;
    editorState.textOverlayOpen = false;
    editorState.textFontSize = 72;

    document.getElementById('st-code').value = '';
    document.getElementById('st-detailed').value = '';
    document.getElementById('st-stroke-width').value = '6';
    document.getElementById('st-text-size').value = '72';
    document.getElementById('st-multi-cell').checked = false;
    document.getElementById('st-text-row').style.display = 'none';
    hideTextOverlay({ commit: false });
    document.querySelectorAll('#stitch-editor-modal .st-tool-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === 'freehand');
    });
    renderColorSwatches();
    renderFillSwatches();
}

function renderColorSwatches() {
    const host = document.getElementById('stitch-editor-colors');
    if (!host) return;
    host.innerHTML = '';
    for (const c of STITCH_DESIGN_COLORS) {
        const sw = document.createElement('button');
        sw.className = 'st-swatch' + (!editorState.eraserActive && c.hex === editorState.stroke ? ' active' : '');
        sw.style.background = c.hex;
        sw.title = c.name;
        sw.addEventListener('click', () => {
            editorState.stroke = c.hex;
            editorState.eraserActive = false;
            renderColorSwatches();
            if (editorState.textOverlayOpen) applyOverlayColour();
            applyColourToPending();
        });
        host.appendChild(sw);
    }
    const eraser = document.createElement('button');
    eraser.className = 'st-swatch st-swatch-eraser' + (editorState.eraserActive ? ' active' : '');
    eraser.title = 'Eraser — paint with the paper colour to hide previous strokes';
    eraser.innerHTML = '<span>&#x2715;</span>';
    eraser.addEventListener('click', () => {
        editorState.eraserActive = true;
        editorState.stroke = STITCH_COLORS.bg;
        renderColorSwatches();
        if (editorState.textOverlayOpen) applyOverlayColour();
        applyColourToPending();
    });
    host.appendChild(eraser);
}

// Push the current stroke colour to the still-editing shape. Fill is now
// tracked independently so changing stroke doesn't change fill.
function applyColourToPending() {
    const p = editorState.pending;
    if (!p) return;
    p.stroke = editorState.stroke;
    redrawCanvas();
    renderEditorTilePreview();
}

function renderFillSwatches() {
    const host = document.getElementById('stitch-editor-fill');
    if (!host) return;
    host.innerHTML = '';

    // "None" first — the default
    const none = document.createElement('button');
    none.className = 'st-swatch st-swatch-none' + (editorState.fill == null ? ' active' : '');
    none.title = 'No fill — stroke only';
    none.addEventListener('click', () => {
        editorState.fill = null;
        renderFillSwatches();
        applyFillToPending();
    });
    host.appendChild(none);

    for (const c of STITCH_DESIGN_COLORS) {
        const sw = document.createElement('button');
        sw.className = 'st-swatch' + (editorState.fill === c.hex ? ' active' : '');
        sw.style.background = c.hex;
        sw.title = `Fill: ${c.name}`;
        sw.addEventListener('click', () => {
            editorState.fill = c.hex;
            renderFillSwatches();
            applyFillToPending();
        });
        host.appendChild(sw);
    }
}

function applyFillToPending() {
    const p = editorState.pending;
    if (!p) return;
    if (p.type !== 'rect' && p.type !== 'ellipse') return;
    if (editorState.fill == null) delete p.fill;
    else p.fill = editorState.fill;
    redrawCanvas();
    renderEditorTilePreview();
}

// The slider's CSS-pixel range needs to track the canvas's display size, or
// "max" stops mapping to "fills the drawing board". Recompute when the editor
// opens (or when overlay shows) — character glyph at slider max should fit
// comfortably in the wrapper.
function updateTextSliderRange() {
    const wrapper = document.querySelector('.stitch-editor-canvas-wrapper');
    const slider = document.getElementById('st-text-size');
    if (!wrapper || !slider) return;
    const wr = wrapper.getBoundingClientRect();
    if (!wr.height) return;
    // Aim for: at slider max, the cap-height of a single glyph ≈ canvas height
    // (i.e. a capital "K" or "M" pretty much fills the drawing board). For a
    // typical serif font, cap-height ≈ 0.7·font-size, so font-size ≈ 1.4·box.
    // We use 1.3 as a slight conservative — leaves a pixel or two of margin
    // for letters with descenders/diacritics so they don't fully clip.
    const newMax = Math.max(60, Math.floor(wr.height * 1.3));
    slider.max = String(newMax);
    if (Number(slider.value) > newMax) {
        slider.value = String(newMax);
        editorState.textFontSize = newMax;
        applyOverlayFontSize();
    }
}

function selectTool(tool) {
    // Switching tools locks in any in-progress edits — the live text overlay
    // or a still-pending drawn shape both become regular committed shapes.
    if (editorState.tool === 'text' && tool !== 'text') {
        commitLiveText();
    }
    commitPending();

    editorState.tool = tool;
    document.querySelectorAll('#stitch-editor-modal .st-tool-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === tool);
    });
    document.getElementById('st-text-row').style.display = (tool === 'text') ? 'flex' : 'none';
    if (tool === 'text') {
        showTextOverlay();
    } else {
        hideTextOverlay({ commit: false });
    }
}

// ---------- Canvas drawing ----------

function setupCanvas() {
    const canvas = document.getElementById('stitch-editor-canvas');
    editorState.canvas = canvas;
    editorState.ctx = canvas.getContext('2d');

    if (canvas.dataset.wired !== '1') {
        canvas.dataset.wired = '1';
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('pointerleave', onPointerUp);
    }
    redrawCanvas();
}

function clamp01(v) {
    return Math.max(0, Math.min(100, v));
}

// Returns the trail point with the greatest perpendicular distance from the
// straight line (x1,y1)→(x2,y2), or null if the line has zero length.
function farthestFromLine(trail, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) return null;
    let best = null;
    let bestD2 = 0;
    for (const p of trail) {
        // Perpendicular distance squared from p to the line
        const cross = (p.x - x1) * dy - (p.y - y1) * dx;
        const d2 = (cross * cross) / len2;
        if (d2 > bestD2) { bestD2 = d2; best = p; }
    }
    return best;
}

function canvasToShape(e) {
    const rect = editorState.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top)  / rect.height) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
}

function currentShapeBase() {
    const base = { stroke: editorState.stroke, strokeWidth: editorState.strokeWidth };
    if (editorState.fill != null) base.fill = editorState.fill;
    return base;
}

function onPointerDown(e) {
    const p = canvasToShape(e);
    const tool = editorState.tool;
    const base = currentShapeBase();

    if (tool === 'text') return;

    // Pending shape: check for a handle hit first. Lines, curves, rects, and
    // ellipses all expose handles — dragging one tweaks just that vertex/edge,
    // while clicking inside the bounding box moves the whole shape as before.
    if (editorState.pending) {
        const handle = hitTestPendingHandle(editorState.pending, p);
        if (handle) {
            editorState.draggingHandle = { handle, startPoint: p,
                origShape: JSON.parse(JSON.stringify(editorState.pending)) };
            editorState.canvas.setPointerCapture?.(e.pointerId);
            return;
        }
    }

    // Otherwise: click inside the pending shape's bounds → start moving it.
    if (editorState.pending && hitTestShape(editorState.pending, p)) {
        editorState.moving = {
            startPoint: p,
            origShape: JSON.parse(JSON.stringify(editorState.pending)),
        };
        editorState.canvas.setPointerCapture?.(e.pointerId);
        return;
    }

    // Starting a new shape commits the previous pending one so it stops
    // responding to slider/swatch changes.
    commitPending();

    editorState.canvas.setPointerCapture?.(e.pointerId);

    if (tool === 'freehand') {
        editorState.drawing = { type: 'path', points: [p], ...base };
    } else if (tool === 'line') {
        editorState.drawing = { type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...base };
    } else if (tool === 'curve') {
        editorState.drawing = { type: 'curve', x1: p.x, y1: p.y, cx: p.x, cy: p.y, x2: p.x, y2: p.y, _trail: [p], ...base };
    } else if (tool === 'rect') {
        editorState.drawing = { type: 'rect', _startX: p.x, _startY: p.y, x: p.x, y: p.y, w: 0, h: 0, ...base };
    } else if (tool === 'ellipse') {
        editorState.drawing = { type: 'ellipse', _startX: p.x, _startY: p.y, cx: p.x, cy: p.y, rx: 0, ry: 0, ...base };
    }
    redrawCanvas();
}

function onPointerMove(e) {
    const p = canvasToShape(e);

    // Dragging a vertex / edge handle — updates only that handle on the
    // pending shape. Endpoints (line/curve/control) move with delta from
    // the original; rect/ellipse edges snap directly to the pointer.
    if (editorState.draggingHandle) {
        const h = editorState.draggingHandle;
        const dx = p.x - h.startPoint.x;
        const dy = p.y - h.startPoint.y;
        const orig = h.origShape;
        const pending = editorState.pending;
        if (pending.type === 'line' || pending.type === 'curve') {
            if (h.handle === 'x1') {
                pending.x1 = clamp01(orig.x1 + dx); pending.y1 = clamp01(orig.y1 + dy);
            } else if (h.handle === 'x2') {
                pending.x2 = clamp01(orig.x2 + dx); pending.y2 = clamp01(orig.y2 + dy);
            } else if (h.handle === 'cx') {
                pending.cx = clamp01(orig.cx + dx); pending.cy = clamp01(orig.cy + dy);
            }
        } else if (pending.type === 'rect') {
            const e = rectEdges(orig);
            if (h.handle === 'top')         e.top    = clamp01(p.y);
            else if (h.handle === 'bottom') e.bottom = clamp01(p.y);
            else if (h.handle === 'left')   e.left   = clamp01(p.x);
            else if (h.handle === 'right')  e.right  = clamp01(p.x);
            const r = rectFromEdges(e);
            pending.x = r.x; pending.y = r.y; pending.w = r.w; pending.h = r.h;
        } else if (pending.type === 'ellipse') {
            const e = ellipseEdges(orig);
            if (h.handle === 'top')         e.top    = clamp01(p.y);
            else if (h.handle === 'bottom') e.bottom = clamp01(p.y);
            else if (h.handle === 'left')   e.left   = clamp01(p.x);
            else if (h.handle === 'right')  e.right  = clamp01(p.x);
            const ell = ellipseFromEdges(e);
            pending.cx = ell.cx; pending.cy = ell.cy; pending.rx = ell.rx; pending.ry = ell.ry;
        }
        redrawCanvas();
        renderEditorTilePreview();
        return;
    }

    // Dragging the pending shape around
    if (editorState.moving) {
        const m = editorState.moving;
        const dx = p.x - m.startPoint.x;
        const dy = p.y - m.startPoint.y;
        translateShape(editorState.pending, m.origShape, dx, dy);
        redrawCanvas();
        renderEditorTilePreview();
        return;
    }

    if (!editorState.drawing) return;
    const d = editorState.drawing;
    if (d.type === 'path') {
        d.points.push(p);
    } else if (d.type === 'line') {
        d.x2 = p.x; d.y2 = p.y;
    } else if (d.type === 'curve') {
        d._trail.push(p);
        d.x2 = p.x; d.y2 = p.y;
        // Control point = the trail point FURTHEST from the straight line A→B.
        // That makes the rendered curve peak where the user's arc peaked —
        // intuitive, and the quadratic bezier visibly tracks the drag shape.
        // (Technically we pull the control out to 2x the apex distance, since
        // a quadratic bezier only reaches halfway to its control point.)
        // For a quadratic Bezier B(0.5) = 0.25·A + 0.5·C + 0.25·B, so
        // C = 2·apex − (A+B)/2 puts the curve's midpoint at the apex.
        // Clamp to [0,100] so the control handle never lands off-canvas
        // (a strongly-curved drag could otherwise push it well outside).
        const apex = farthestFromLine(d._trail, d.x1, d.y1, d.x2, d.y2);
        if (apex) {
            d.cx = clamp01(2 * apex.x - (d.x1 + d.x2) / 2);
            d.cy = clamp01(2 * apex.y - (d.y1 + d.y2) / 2);
        } else {
            d.cx = (d.x1 + d.x2) / 2;
            d.cy = (d.y1 + d.y2) / 2;
        }
    } else if (d.type === 'rect') {
        d.x = Math.min(d._startX, p.x);
        d.y = Math.min(d._startY, p.y);
        d.w = Math.abs(p.x - d._startX);
        d.h = Math.abs(p.y - d._startY);
    } else if (d.type === 'ellipse') {
        d.cx = (d._startX + p.x) / 2;
        d.cy = (d._startY + p.y) / 2;
        d.rx = Math.abs(p.x - d._startX) / 2;
        d.ry = Math.abs(p.y - d._startY) / 2;
    }
    redrawCanvas();
}

function onPointerUp() {
    if (editorState.draggingHandle) {
        editorState.draggingHandle = null;
        return;
    }
    if (editorState.moving) {
        editorState.moving = null;
        return;
    }
    if (!editorState.drawing) return;
    const d = editorState.drawing;
    let keep = true;
    if (d.type === 'path' && d.points.length < 2) keep = false;
    if (d.type === 'rect' && (d.w < 0.5 || d.h < 0.5)) keep = false;
    if (d.type === 'ellipse' && (d.rx < 0.5 || d.ry < 0.5)) keep = false;
    if (d.type === 'line' && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 0.5) keep = false;
    if (d.type === 'curve' && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 0.5) keep = false;

    if (keep) {
        delete d._startX; delete d._startY; delete d._trail;
        // Freehand (pen) strokes commit straight away — there's nothing
        // useful to tweak afterwards. Everything else stays pending so the
        // user can adjust colour/stroke/fill or drag it to a new spot.
        if (d.type === 'path') {
            editorState.shapes.push(d);
        } else {
            editorState.pending = d;
        }
    }
    editorState.drawing = null;
    redrawCanvas();
    renderEditorTilePreview();
}

// ---------- Pending shape helpers (move / hit-test / commit) ----------

function shapeBoundingBox(s) {
    if (!s) return null;
    if (s.type === 'line' || s.type === 'curve') {
        return {
            minX: Math.min(s.x1, s.x2), maxX: Math.max(s.x1, s.x2),
            minY: Math.min(s.y1, s.y2), maxY: Math.max(s.y1, s.y2),
        };
    }
    if (s.type === 'rect') {
        return { minX: s.x, maxX: s.x + s.w, minY: s.y, maxY: s.y + s.h };
    }
    if (s.type === 'ellipse') {
        return { minX: s.cx - s.rx, maxX: s.cx + s.rx, minY: s.cy - s.ry, maxY: s.cy + s.ry };
    }
    return null;
}

function hitTestShape(s, p) {
    const bb = shapeBoundingBox(s);
    if (!bb) return false;
    const pad = 3; // 0..100-unit tolerance so thin strokes are still easy to grab
    return p.x >= bb.minX - pad && p.x <= bb.maxX + pad &&
           p.y >= bb.minY - pad && p.y <= bb.maxY + pad;
}

function translateShape(target, orig, dx, dy) {
    if (target.type === 'line' || target.type === 'curve') {
        target.x1 = orig.x1 + dx; target.y1 = orig.y1 + dy;
        target.x2 = orig.x2 + dx; target.y2 = orig.y2 + dy;
        if ('cx' in orig) { target.cx = orig.cx + dx; target.cy = orig.cy + dy; }
    } else if (target.type === 'rect') {
        target.x = orig.x + dx; target.y = orig.y + dy;
    } else if (target.type === 'ellipse') {
        target.cx = orig.cx + dx; target.cy = orig.cy + dy;
    }
}

function commitPending() {
    if (!editorState.pending) return;
    editorState.shapes.push(editorState.pending);
    editorState.pending = null;
    redrawCanvas();
    renderEditorTilePreview();
}

// Done button / explicit "lock everything in" — flushes pending shape and
// the live text overlay, leaves the current tool active.
function commitEditing() {
    if (editorState.textOverlayOpen) commitLiveText();
    commitPending();
}

function redrawCanvas() {
    const ctx = editorState.ctx;
    const canvas = editorState.canvas;
    if (!ctx || !canvas) return;
    const W = canvas.width, H = canvas.height;

    // Keep the canvas fully transparent so the wrapper's paper+grid CSS
    // background shows through.
    ctx.clearRect(0, 0, W, H);

    const allShapes = editorState.shapes.slice();
    if (editorState.pending) allShapes.push(editorState.pending);
    if (editorState.drawing) allShapes.push(editorState.drawing);

    // Walk shapes in z-order. Erase strokes punch holes via destination-out
    // so they only affect what's BENEATH them on the canvas — anything drawn
    // afterwards layers cleanly on top, no longer "ink-phobic". A coloured
    // fill paired with an erase stroke must NOT be punched out — only the
    // stroke ring erases, and the fill paints normally on top (matching the
    // tile-preview / chart behaviour).
    const isEraseShape = (s) => s && s.stroke === STITCH_COLORS.bg;
    const hasColouredFill = (s) => s && s.fill && s.fill !== STITCH_COLORS.bg;
    for (const s of allShapes) {
        if (isEraseShape(s)) {
            // Fill first (transparent stroke so it doesn't double-paint),
            // then punch the stroke ring with destination-out. Mirrors the
            // tile-preview order (fill then bg-coloured stroke overpaints),
            // so the inner half of the erase ring eats into the new fill
            // exactly like the bg stroke does in the preview.
            if (hasColouredFill(s)) {
                drawUserStitchShapes(ctx, [{ ...s, stroke: 'rgba(0,0,0,0)' }], 0, 0, W, H);
            }
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            drawUserStitchShapes(ctx, [{ ...s, fill: null }], 0, 0, W, H);
            ctx.restore();
        } else {
            drawUserStitchShapes(ctx, [s], 0, 0, W, H);
        }
    }

    // During a Curve drag: preview the apex (where the curve peak will land)
    const d = editorState.drawing;
    if (d && d.type === 'curve' && d._trail && d._trail.length > 3) {
        const apex = farthestFromLine(d._trail, d.x1, d.y1, d.x2, d.y2);
        if (apex) drawVertexHandle(ctx, apex.x, apex.y, W, H, '#9b2f2a');
    }

    // Pending shape: draggable handles. Line/curve get endpoint handles
    // (curve also gets a control-point handle in accent red); rect and
    // ellipse get four edge-midpoint handles for independent stretching.
    const pending = editorState.pending;
    if (pending) {
        for (const h of pendingHandlePositions(pending)) {
            const color = h.kind === 'control' ? '#9b2f2a' : '#2a211a';
            drawVertexHandle(ctx, h.x, h.y, W, H, color);
        }
    }
}

// Positions of all draggable handles on a pending shape, in 0..100 coords.
// Returns [{ key, x, y, kind }] where kind = 'endpoint' | 'control'.
function pendingHandlePositions(shape) {
    if (!shape) return [];
    if (shape.type === 'line') {
        return [
            { key: 'x1', x: shape.x1, y: shape.y1, kind: 'endpoint' },
            { key: 'x2', x: shape.x2, y: shape.y2, kind: 'endpoint' },
        ];
    }
    if (shape.type === 'curve') {
        return [
            { key: 'x1', x: shape.x1, y: shape.y1, kind: 'endpoint' },
            { key: 'x2', x: shape.x2, y: shape.y2, kind: 'endpoint' },
            { key: 'cx', x: shape.cx, y: shape.cy, kind: 'control' },
        ];
    }
    if (shape.type === 'rect') {
        const e = rectEdges(shape);
        const mx = (e.left + e.right) / 2;
        const my = (e.top + e.bottom) / 2;
        return [
            { key: 'top',    x: mx,      y: e.top,    kind: 'endpoint' },
            { key: 'right',  x: e.right, y: my,       kind: 'endpoint' },
            { key: 'bottom', x: mx,      y: e.bottom, kind: 'endpoint' },
            { key: 'left',   x: e.left,  y: my,       kind: 'endpoint' },
        ];
    }
    if (shape.type === 'ellipse') {
        const e = ellipseEdges(shape);
        const mx = (e.left + e.right) / 2;
        const my = (e.top + e.bottom) / 2;
        return [
            { key: 'top',    x: mx,      y: e.top,    kind: 'endpoint' },
            { key: 'right',  x: e.right, y: my,       kind: 'endpoint' },
            { key: 'bottom', x: mx,      y: e.bottom, kind: 'endpoint' },
            { key: 'left',   x: e.left,  y: my,       kind: 'endpoint' },
        ];
    }
    return [];
}

// Edge helpers for rect/ellipse. Each "edge" is the absolute coordinate of
// the side; rectFromEdges / ellipseFromEdges normalise so dragging a side
// past its opposite flips the shape rather than producing negative w/h.
function rectEdges(s)   { return { top: s.y, bottom: s.y + s.h, left: s.x, right: s.x + s.w }; }
function rectFromEdges(e) {
    const x = Math.min(e.left, e.right);
    const y = Math.min(e.top, e.bottom);
    return { x, y, w: Math.abs(e.right - e.left), h: Math.abs(e.bottom - e.top) };
}
function ellipseEdges(s) { return { top: s.cy - s.ry, bottom: s.cy + s.ry, left: s.cx - s.rx, right: s.cx + s.rx }; }
function ellipseFromEdges(e) {
    const cx = (e.left + e.right) / 2;
    const cy = (e.top + e.bottom) / 2;
    return { cx, cy, rx: Math.abs(e.right - e.left) / 2, ry: Math.abs(e.bottom - e.top) / 2 };
}

// Small filled circle with a light ring — draws a handle at (px, py) given in
// 0..100 shape coords. Color identifies the handle type (dark = endpoint,
// accent red = control).
function drawVertexHandle(ctx, px, py, W, H, color) {
    const sx = W / 100, sy = H / 100;
    const r = 6;
    const x = px * sx, y = py * sy;
    ctx.save();
    ctx.fillStyle = '#fbf7ec';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// Hit-test a point against the pending shape's handles. Returns the handle
// key (e.g. 'x1' / 'top' / 'cx') or null if the point isn't on a handle.
// Tolerance is in 0..100 shape units.
function hitTestPendingHandle(shape, p) {
    const tol2 = 36; // 6^2
    const handles = pendingHandlePositions(shape);
    let best = null;
    for (const h of handles) {
        const d2 = (h.x - p.x) ** 2 + (h.y - p.y) ** 2;
        if (d2 < tol2 && (!best || d2 < best.d2)) best = { key: h.key, d2 };
    }
    return best ? best.key : null;
}

function undoLastShape() {
    // If a shape is still being edited, Undo throws it away rather than
    // popping a committed one — matches what "undo" feels like mid-edit.
    if (editorState.pending) {
        editorState.pending = null;
    } else {
        editorState.shapes.pop();
    }
    redrawCanvas();
    renderEditorTilePreview();
}

function clearCanvas() {
    editorState.shapes = [];
    editorState.pending = null;
    editorState.drawing = null;
    editorState.moving = null;
    redrawCanvas();
    renderEditorTilePreview();
}

function renderEditorTilePreview() {
    const canvas = document.getElementById('st-preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = STITCH_COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const shapes = editorState.shapes.slice();
    if (editorState.pending) shapes.push(editorState.pending);
    drawUserStitchShapes(ctx, shapes, 0, 0, canvas.width, canvas.height);
}

// ---------- Live text overlay ----------

function wireTextOverlay() {
    const overlay = document.getElementById('st-text-overlay');
    const handle = overlay.querySelector('.st-text-overlay-handle');
    const content = document.getElementById('st-text-overlay-content');
    if (overlay.dataset.wired === '1') return;
    overlay.dataset.wired = '1';

    // Belt-and-braces: any scroll on the editor body (e.g. browser
    // auto-scroll-into-view from typing in the contenteditable at huge font
    // sizes) gets reset immediately so the toolstrip stays fixed. CSS
    // overflow:clip handles this in modern browsers; this listener covers
    // older engines and any other source of stray scrolling.
    const body = document.querySelector('.stitch-editor-body');
    if (body) body.addEventListener('scroll', () => { body.scrollTop = 0; body.scrollLeft = 0; });

    // Dragging: click + drag the handle to move the overlay. Position is
    // stored as percentages of the canvas-wrapper so it scales with the modal.
    let dragStart = null;
    handle.addEventListener('pointerdown', (e) => {
        const wrapper = overlay.parentElement;
        const wr = wrapper.getBoundingClientRect();
        dragStart = {
            px: e.clientX, py: e.clientY,
            // offsetLeft/Top are relative to the positioned parent (the wrapper)
            startLeft: overlay.offsetLeft, startTop: overlay.offsetTop,
            wrapperW: wr.width, wrapperH: wr.height,
        };
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
        if (!dragStart) return;
        const dx = e.clientX - dragStart.px;
        const dy = e.clientY - dragStart.py;
        const newLeft = dragStart.startLeft + dx;
        const newTop = dragStart.startTop + dy;
        overlay.style.left = (newLeft / dragStart.wrapperW * 100) + '%';
        overlay.style.top  = (newTop  / dragStart.wrapperH * 100) + '%';
    });
    handle.addEventListener('pointerup', () => { dragStart = null; });
    handle.addEventListener('pointercancel', () => { dragStart = null; });

    // Enter submits nothing special — let the user add newlines. We intercept
    // only Escape, which commits and exits the text tool.
    content.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            selectTool('freehand');
        }
    });
}

function showTextOverlay(existing = null) {
    const overlay = document.getElementById('st-text-overlay');
    const content = document.getElementById('st-text-overlay-content');
    if (!overlay) return;

    if (existing) {
        // (reserved for future "double-click to edit" support)
        content.textContent = existing.text || '';
    } else {
        content.textContent = '';
        overlay.style.left = '10%';
        overlay.style.top  = '25%';
    }
    overlay.style.display = 'flex';
    // Defensive: belt-and-braces against any stray scroll position the
    // browser may have applied while the overlay was hidden. (overflow:clip
    // prevents new scrolling, but doesn't undo state set when it was hidden
    // and overflow was different.) Zero on every show.
    overlay.scrollTop = 0;
    overlay.scrollLeft = 0;
    editorState.textOverlayOpen = true;
    // Calibrate the slider's range to the current canvas size so "max" maps
    // to a glyph that fills the drawing board.
    updateTextSliderRange();
    applyOverlayFontSize();
    applyOverlayColour();
    // Focus & place caret inside the contenteditable. preventScroll keeps
    // the modal from auto-scrolling the focused element into view, which
    // can drag the editor toolstrip off the top if the content box is tall.
    setTimeout(() => {
        content.focus({ preventScroll: true });
        // Position caret at end
        const range = document.createRange();
        range.selectNodeContents(content);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }, 20);
}

function hideTextOverlay({ commit }) {
    const overlay = document.getElementById('st-text-overlay');
    if (!overlay) return;
    if (commit && editorState.textOverlayOpen) commitLiveText();
    overlay.style.display = 'none';
    editorState.textOverlayOpen = false;
}

function applyOverlayFontSize() {
    const content = document.getElementById('st-text-overlay-content');
    if (content) content.style.fontSize = editorState.textFontSize + 'px';
}

function applyOverlayColour() {
    const content = document.getElementById('st-text-overlay-content');
    if (content) content.style.color = editorState.eraserActive ? STITCH_COLORS.bg : editorState.stroke;
}

// Capture the live overlay (text, position, size, colour) as a text shape and
// hide the overlay. Idempotent — safe to call multiple times.
function commitLiveText() {
    if (!editorState.textOverlayOpen) return;
    const overlay = document.getElementById('st-text-overlay');
    const content = document.getElementById('st-text-overlay-content');
    if (!overlay || !content) { editorState.textOverlayOpen = false; return; }

    // innerText preserves visible line breaks (between <br>s and block
    // wrappers that contenteditable inserts on Enter); textContent would
    // collapse them to a single string. Trim outer blank lines but keep
    // interior \n so multi-line stitches render exactly as typed.
    const raw = (content.innerText || '').replace(/\r\n/g, '\n');
    const text = raw.replace(/^\n+|\n+$/g, '');
    editorState.textOverlayOpen = false;

    if (text) {
        const canvas = editorState.canvas;
        const canvasRect = canvas.getBoundingClientRect();
        // Range rect over all content. For multi-line, getClientRects() yields
        // one rect per line; we union them so textRect bounds the whole block.
        const range = document.createRange();
        range.selectNodeContents(content);
        const rects = range.getClientRects();
        let textRect = range.getBoundingClientRect();
        if (rects.length > 0) {
            let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
            for (const r of rects) {
                if (r.width === 0 || r.height === 0) continue;
                minL = Math.min(minL, r.left);
                minT = Math.min(minT, r.top);
                maxR = Math.max(maxR, r.right);
                maxB = Math.max(maxB, r.bottom);
            }
            if (maxR > minL) textRect = { left: minL, top: minT, right: maxR, bottom: maxB, width: maxR - minL, height: maxB - minT };
        }

        // Visual centre of the whole text block (single or multi-line). For
        // single-line this matches the previous glyph-centre computation
        // because the union rect IS the glyph's line-box.
        const blockCentreXViewport = textRect.left + textRect.width / 2;
        const blockCentreYViewport = textRect.top + textRect.height / 2;

        const centreX = (blockCentreXViewport - canvasRect.left) / canvasRect.width * 100;
        const centreY = (blockCentreYViewport - canvasRect.top) / canvasRect.height * 100;
        const fontSize100 = editorState.textFontSize * 100 / canvasRect.width;

        editorState.shapes.push({
            type: 'text',
            x: centreX, y: centreY,
            text: text,
            fontSize: fontSize100,
            stroke: editorState.eraserActive ? STITCH_COLORS.bg : editorState.stroke,
        });
    }

    content.textContent = '';
    overlay.style.display = 'none';
    redrawCanvas();
    renderEditorTilePreview();
}

// ---------- Code + auto-fill ----------

function onCodeInput(e) {
    if (editorState.detailedTouched) return;
    const code = e.target.value.trim();
    const detailedEl = document.getElementById('st-detailed');
    if (!detailedEl) return;
    if (!code) { detailedEl.value = ''; return; }
    // Case-insensitive match against the library. When the typed code stops
    // matching anything, clear the description — otherwise typing "K" then
    // growing it to "K3into1" would leave the K explanation lingering under
    // a code it no longer applies to.
    const match = Object.keys(STITCH_CODE_LIBRARY).find(k => k.toLowerCase() === code.toLowerCase());
    detailedEl.value = match ? STITCH_CODE_LIBRARY[match] : '';
}

// ---------- Save ----------

async function saveStitch() {
    // Lock in anything still in edit mode so it's included in the saved shapes.
    if (editorState.textOverlayOpen) commitLiveText();
    commitPending();

    const code = document.getElementById('st-code').value.trim();
    const detailed = document.getElementById('st-detailed').value.trim();

    if (!code) {
        showEditorToast('Give the stitch a code first (e.g. "C4B").');
        document.getElementById('st-code').focus();
        return;
    }
    // No "must draw something" block: an iconless or erase-only stitch is
    // valid — the renderer falls back to drawing the code as text in the
    // cell, so it's never invisible. (See isEffectivelyEmpty / drawCodeAsText
    // in js/stitches.js.)

    const id = code;
    const existing = StitchRegistry.get(id);
    const isEditingSame = editorState.mode === 'edit' && editorState.editingId === id;

    if (!isEditingSame) {
        if (existing && existing.source !== 'user') {
            const choice = await confirmDialog({
                title: 'Override built-in stitch?',
                message: `"${code}" is a built-in stitch. Saving will override it with your custom drawing.`,
                buttons: [
                    { id: 'cancel', label: 'Cancel' },
                    { id: 'continue', label: 'Override', kind: 'primary' },
                ],
            });
            if (choice !== 'continue') return;
        } else if (existing && existing.source === 'user') {
            const choice = await confirmDialog({
                title: 'Replace existing stitch?',
                message: `A user stitch with code "${code}" already exists in your gallery. Overwrite it with this drawing?`,
                buttons: [
                    { id: 'cancel', label: 'Cancel' },
                    { id: 'overwrite', label: 'Overwrite', kind: 'primary' },
                ],
            });
            if (choice !== 'overwrite') return;
        }
    }

    // If editing changed the code (renamed), delete the old record.
    if (editorState.mode === 'edit' && editorState.editingId && editorState.editingId !== id) {
        try {
            await deleteUserStitchFromDB(editorState.editingId);
            StitchRegistry.removeUserStitch(editorState.editingId);
        } catch (err) {
            console.warn('Old stitch record delete failed:', err);
        }
    }

    const record = {
        id,
        label: code,
        sublabel: null,
        title: detailed ? detailed.split(/[.\n]/)[0] : `Custom stitch: ${code}`,
        code,
        detailedInstructions: detailed,
        shapes: editorState.shapes,
        multiCell: editorState.multiCell,
        source: 'user',
        order: existing?.order ?? 500,
        createdAt: existing?._record?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
    };

    try {
        await saveUserStitchToDB(record);
    } catch (err) {
        console.error('Failed to save stitch', err);
        showEditorToast('Could not save — ' + (err?.message || 'unknown error'));
        return;
    }

    StitchRegistry.upsertUserStitch(record);
    // A stitch you just created/edited belongs in the current project's
    // palette. The gallery toggle gives the user a way to hide it later.
    if (typeof state !== 'undefined' && state.activeStitches) state.activeStitches.add(id);
    document.dispatchEvent(new CustomEvent('stitch-registry-updated'));
    closeStitchEditor();
    showToast(editorState.mode === 'edit'
        ? `"${code}" updated.`
        : `"${code}" added to your stitch gallery.`);
}

// ---------- Public delete (used by the palette context menu) ----------

async function deleteUserStitch(id) {
    const def = StitchRegistry.get(id);
    if (!def || def.source !== 'user') return;
    const choice = await confirmDialog({
        title: 'Delete stitch?',
        message: `Delete the custom stitch "${def.label || id}"? Any cells using it will fall back to plain knit.`,
        buttons: [
            { id: 'cancel', label: 'Cancel' },
            { id: 'delete', label: 'Delete', kind: 'danger' },
        ],
    });
    if (choice !== 'delete') return;
    try {
        await deleteUserStitchFromDB(id);
    } catch (err) {
        showToast('Could not delete — ' + (err?.message || 'unknown error'), { tone: 'error' });
        return;
    }
    StitchRegistry.removeUserStitch(id);
    // If the deleted stitch was the active selection, clear it.
    if (state.activeStitch === id) state.activeStitch = null;
    document.dispatchEvent(new CustomEvent('stitch-registry-updated'));
    // Ensure the grid re-renders in case the deleted stitch was on it.
    if (typeof renderStitchOverlay === 'function') renderStitchOverlay();
    // Per user request, no success toast — the tile vanishing from the
    // palette is confirmation enough, and the dialog already required two
    // intentional clicks.
}
