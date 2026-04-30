// === Stitch Gallery overlay ===
// Manages the per-project active set (which stitches show in the palette) and
// import/export of the user's full custom-stitch library to/from JSON files.
// Edit/delete of user stitches stays on the palette context menu — the gallery
// is just for activation and library transfer.

const GalleryUI = { open: false };

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-view-gallery')?.addEventListener('click', openGalleryOverlay);
    document.getElementById('gallery-close')?.addEventListener('click', closeGalleryOverlay);
    document.getElementById('gallery-done')?.addEventListener('click', closeGalleryOverlay);
    document.getElementById('gallery-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'gallery-modal') closeGalleryOverlay();
    });
    document.getElementById('gallery-save')?.addEventListener('click', saveGalleryFile);
    document.getElementById('gallery-load')?.addEventListener('click', () => {
        document.getElementById('gallery-load-input')?.click();
    });
    document.getElementById('gallery-load-input')?.addEventListener('change', handleGalleryFileLoad);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && GalleryUI.open) closeGalleryOverlay();
    });
    // Keep the list in sync if the registry changes while the overlay is up
    // (e.g. the user loads another gallery file without closing first).
    document.addEventListener('stitch-registry-updated', () => {
        if (GalleryUI.open) renderGalleryList();
    });
});

function openGalleryOverlay() {
    const modal = document.getElementById('gallery-modal');
    if (!modal) return;
    modal.classList.add('open');
    modal.style.display = 'flex';
    GalleryUI.open = true;
    renderGalleryList();
}

function closeGalleryOverlay() {
    const modal = document.getElementById('gallery-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.style.display = 'none';
    GalleryUI.open = false;
}

function renderGalleryList() {
    const list = document.getElementById('gallery-list');
    if (!list || typeof StitchRegistry === 'undefined') return;
    list.innerHTML = '';
    const effective = (typeof getEffectiveActiveStitches === 'function')
        ? getEffectiveActiveStitches() : null;
    const usedInGrid = (typeof getStitchesUsedInGrid === 'function')
        ? getStitchesUsedInGrid() : new Set();
    for (const stitch of StitchRegistry.getAll()) {
        // The Erase tool is always available; it's not a stitch in the
        // gallery sense, so it doesn't appear here.
        if (stitch.id === 'stitch-erase') continue;
        list.appendChild(buildGalleryItem(stitch, effective, usedInGrid));
    }
}

function buildGalleryItem(stitch, effectiveSet, usedSet) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gallery-item';
    const isActive = effectiveSet ? effectiveSet.has(stitch.id) : true;
    const isLocked = usedSet.has(stitch.id);
    if (isActive) item.classList.add('is-active');
    if (isLocked) {
        item.classList.add('is-locked');
        item.title = 'Used in the current chart — clear it from the grid before hiding it.';
    } else {
        item.title = (stitch.source === 'user')
            ? `${stitch.label || stitch.id} — click to toggle. Right-click the tile in the palette to edit or delete.`
            : `${stitch.label || stitch.id} — click to toggle. Built-in stitches can't be edited or deleted.`;
    }

    let iconEl;
    if (stitch.useGlyph) {
        iconEl = document.createElement('span');
        iconEl.className = 'gallery-item-glyph';
        iconEl.textContent = stitch.useGlyph;
    } else {
        iconEl = document.createElement('canvas');
        iconEl.className = 'gallery-item-icon';
        iconEl.width = 40;
        iconEl.height = 40;
    }
    item.appendChild(iconEl);

    const text = document.createElement('div');
    text.className = 'gallery-item-text';
    const code = document.createElement('div');
    code.className = 'gallery-item-code';
    code.textContent = stitch.label || stitch.id;
    text.appendChild(code);
    if (stitch.sublabel) {
        const sub = document.createElement('div');
        sub.className = 'gallery-item-sub';
        sub.textContent = stitch.sublabel;
        text.appendChild(sub);
    }
    item.appendChild(text);

    item.addEventListener('click', () => {
        if (isLocked) return;
        if (!state.activeStitches) state.activeStitches = new Set();
        if (state.activeStitches.has(stitch.id)) state.activeStitches.delete(stitch.id);
        else state.activeStitches.add(stitch.id);
        item.classList.toggle('is-active');
        if (typeof initStitchPalette === 'function') initStitchPalette();
    });

    if (iconEl.tagName === 'CANVAS' && typeof stitch.drawIcon === 'function') {
        const ctx = iconEl.getContext('2d');
        ctx.fillStyle = STITCH_COLORS.bg;
        ctx.fillRect(0, 0, 40, 40);
        stitch.drawIcon(ctx, 40);
    }
    return item;
}

// ---------- Save Gallery ----------

function saveGalleryFile() {
    const records = StitchRegistry.getAll()
        .filter(s => s.source === 'user')
        .map(serialiseUserStitch);
    if (records.length === 0) {
        showToast('No custom stitches to save yet — design one with "+ Add Stitch Type" first.');
        return;
    }
    const data = {
        // Marker only — the loader is permissive (it accepts any file with a
        // 'stitches' or 'userStitches' array) so old 'knitwit-gallery' files
        // still load fine.
        type: 'knitwittage-gallery',
        version: 1,
        exportedAt: new Date().toISOString(),
        stitches: records,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `knitwittage-gallery-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const noun = records.length === 1 ? 'stitch' : 'stitches';
    showToast(`Gallery saved (${records.length} ${noun}).`);
}

// Hydrated registry entries hold function refs; pull the raw stored record
// where we have one, otherwise rebuild a clean serialisable copy.
function serialiseUserStitch(s) {
    if (s._record) return s._record;
    return {
        id: s.id,
        label: s.label,
        sublabel: s.sublabel || null,
        title: s.title || '',
        code: s.code || s.id,
        detailedInstructions: s.detailedInstructions || '',
        shapes: s.shapes || [],
        multiCell: !!s.multiCell,
        source: 'user',
        order: s.order ?? 500,
    };
}

// ---------- Load Gallery ----------

function handleGalleryFileLoad(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            // Accept both gallery files (data.stitches) and pattern files'
            // userStitches arrays — handy for bootstrapping a gallery from a
            // borrowed pattern without loading the pattern itself.
            const list = Array.isArray(data && data.stitches) ? data.stitches
                       : Array.isArray(data && data.userStitches) ? data.userStitches
                       : null;
            if (!list) {
                showToast('Not a valid gallery file.', { tone: 'error' });
                return;
            }
            await mergeUserStitches(list);
            if (GalleryUI.open) renderGalleryList();
        } catch (err) {
            console.error(err);
            showToast('Could not read gallery file.', { tone: 'error' });
        }
    };
    reader.readAsText(file);
}

// Shared collision-aware import path. Used by both the gallery overlay's
// "Load gallery" button AND the pattern-file loader (importUserStitchesFromPattern
// in app.js). Built-in id collisions are silently skipped — patterns/galleries
// can't override the app's own stitch library. User-id collisions trigger ONE
// batch confirm() listing every conflict, with overwrite as the OK action.
//
// Returns { imported, overwritten, skipped, failed } so callers can compose
// their own toast (silent: true) or rely on the default summary toast.
async function mergeUserStitches(list, opts = {}) {
    if (typeof StitchRegistry === 'undefined') {
        return { imported: 0, overwritten: 0, skipped: 0, failed: 0 };
    }
    const valid = list.filter(rec =>
        rec && typeof rec.id === 'string' && Array.isArray(rec.shapes));
    const fresh = [], collisions = [];
    for (const rec of valid) {
        const existing = StitchRegistry.get(rec.id);
        if (existing && existing.source !== 'user') continue; // built-in collision: skip
        if (existing) collisions.push(rec);
        else fresh.push(rec);
    }
    let toOverwrite = [];
    let importFresh = true;
    if (collisions.length > 0) {
        const lines = collisions.map(r => `• ${r.id}`).join('\n');
        const noun = collisions.length === 1 ? 'stitch already exists' : 'stitches already exist';
        const choice = await confirmDialog({
            title: collisions.length === 1 ? 'Stitch already exists' : 'Stitches already exist',
            message:
                `The following ${noun} in your gallery:\n\n${lines}\n\n` +
                `Keep your existing versions, or overwrite them with the ones being imported? Either way, any brand-new stitches in the file will still be added.`,
            buttons: [
                { id: 'cancel',    label: 'Cancel' },
                { id: 'keep',      label: 'Keep mine' },
                { id: 'overwrite', label: 'Overwrite with imported', kind: 'primary' },
            ],
        });
        if (choice === null || choice === 'cancel') {
            importFresh = false; // user aborted everything
        } else if (choice === 'overwrite') {
            toOverwrite = collisions;
        }
        // 'keep' → toOverwrite stays empty, fresh still imports
    }
    let imported = 0, overwritten = 0, failed = 0;
    if (importFresh) {
        for (const rec of fresh) {
            try { await saveUserStitchToDB(rec); StitchRegistry.upsertUserStitch(rec); imported++; }
            catch (err) { console.warn('Could not import stitch:', rec.id, err); failed++; }
        }
        for (const rec of toOverwrite) {
            try { await saveUserStitchToDB(rec); StitchRegistry.upsertUserStitch(rec); overwritten++; }
            catch (err) { console.warn('Could not overwrite stitch:', rec.id, err); failed++; }
        }
    }
    const skipped = importFresh ? (collisions.length - toOverwrite.length) : collisions.length;
    const cancelled = !importFresh && (fresh.length + collisions.length) > 0;
    if (imported || overwritten) {
        document.dispatchEvent(new CustomEvent('stitch-registry-updated'));
    }
    if (!opts.silent) {
        if (cancelled) {
            showToast('Gallery import cancelled — no changes made.');
        } else {
            const parts = [];
            if (imported)    parts.push(`${imported} added`);
            if (overwritten) parts.push(`${overwritten} overwritten`);
            if (skipped)     parts.push(`${skipped} kept as-is`);
            if (failed)      parts.push(`${failed} failed`);
            showToast(parts.length ? `Gallery import: ${parts.join(', ')}.` : 'Gallery file had no usable stitches.');
        }
    }
    return { imported, overwritten, skipped, failed, cancelled };
}

// ---------- Pattern-load merge (deferred conflict review) ----------
// Pattern files routinely arrive with a userStitches block, and a synchronous
// "yours vs theirs" dialog mid-load was hostile UX — the user just wanted to
// open a chart. Instead we partition silently:
//   - new (code not in your gallery)        → import immediately
//   - identical (code + same shapes)        → no-op
//   - conflicting (code matches, shapes ≠)  → held pending, NOT applied
// The pattern always opens with the recipient's existing icons; the caller
// surfaces the pending conflicts via a non-blocking review banner so the user
// can decide later (or ignore — gallery is never silently mutated).
async function mergePatternUserStitches(list) {
    const out = { imported: 0, identical: 0, conflicts: [], failed: 0 };
    if (typeof StitchRegistry === 'undefined' || !Array.isArray(list)) return out;
    const valid = list.filter(rec => rec && typeof rec.id === 'string' && Array.isArray(rec.shapes));
    for (const rec of valid) {
        const existing = StitchRegistry.get(rec.id);
        if (existing && existing.source !== 'user') continue; // built-in: never overridden
        if (!existing) {
            try {
                await saveUserStitchToDB(rec);
                StitchRegistry.upsertUserStitch(rec);
                out.imported++;
            } catch (err) {
                console.warn('Could not import stitch:', rec.id, err);
                out.failed++;
            }
            continue;
        }
        const yoursRecord = existing._record || serialiseUserStitch(existing);
        if (areStitchesIdentical(yoursRecord, rec)) {
            out.identical++;
        } else {
            // typeMismatch flags the worst case: the multiCell flag differs.
            // The grid renders correctly only when the per-cell records and
            // the registry's flag agree, so "keep mine" for these conflicts
            // also rewrites the loaded grid (commitImportReview handles it).
            const typeMismatch = !!yoursRecord.multiCell !== !!rec.multiCell;
            out.conflicts.push({ id: rec.id, yours: yoursRecord, theirs: rec, typeMismatch });
        }
    }
    if (out.imported) document.dispatchEvent(new CustomEvent('stitch-registry-updated'));
    return out;
}

// Two stitches are "identical" for import purposes when the visuals and
// drag-placement behaviour match — the user-facing decision is whether the
// icon they'll see is the same. Labels / detailed instructions can drift
// without forcing a review: those are metadata, not chart appearance.
function areStitchesIdentical(a, b) {
    if (!a || !b) return false;
    if ((a.code || a.id) !== (b.code || b.id)) return false;
    if (!!a.multiCell !== !!b.multiCell) return false;
    return JSON.stringify(a.shapes || []) === JSON.stringify(b.shapes || []);
}

// ---------- Import review banner + modal ----------
// Pending conflicts surface as a persistent banner under the masthead. The
// banner is dismissible (clears pending state — gallery stays untouched) and
// has a Review action that opens the per-stitch comparison modal.

let pendingImportConflicts = [];

function showImportConflictBanner(conflicts) {
    pendingImportConflicts = conflicts.slice();
    const banner = document.getElementById('import-conflict-banner');
    const text = document.getElementById('import-conflict-text');
    if (!banner || !text) return;
    const n = pendingImportConflicts.length;
    if (n === 0) { hideImportConflictBanner(); return; }
    text.textContent = n === 1
        ? `1 stitch in this pattern differs from your gallery (showing your version).`
        : `${n} stitches in this pattern differ from your gallery (showing your versions).`;
    banner.hidden = false;
}

function hideImportConflictBanner() {
    pendingImportConflicts = [];
    const banner = document.getElementById('import-conflict-banner');
    if (banner) banner.hidden = true;
}

// Each pending conflict carries a `decision` ('mine' | 'theirs', default 'mine')
// while the modal is open. Decisions are toggled per row; nothing is committed
// until the user clicks Done. A single secondary confirm fires before any
// global gallery mutation, summarising every overwrite at once.
function openImportReviewModal() {
    if (pendingImportConflicts.length === 0) return;
    const modal = document.getElementById('import-review-modal');
    if (!modal) return;
    // Default every row to "keep mine" — gallery is never silently mutated.
    for (const c of pendingImportConflicts) {
        if (c.decision !== 'mine' && c.decision !== 'theirs') c.decision = 'mine';
    }
    modal.classList.add('open');
    modal.style.display = 'flex';
    renderImportReviewList();
}

function closeImportReviewModal() {
    const modal = document.getElementById('import-review-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.style.display = 'none';
}

function renderImportReviewList() {
    const list = document.getElementById('import-review-list');
    if (!list) return;
    list.innerHTML = '';
    if (pendingImportConflicts.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'review-empty';
        empty.textContent = 'All conflicts resolved.';
        list.appendChild(empty);
        return;
    }
    for (const conflict of pendingImportConflicts) {
        list.appendChild(buildReviewRow(conflict));
    }
}

function buildReviewRow(conflict) {
    const row = document.createElement('div');
    row.className = 'review-row' + (conflict.typeMismatch ? ' has-type-mismatch' : '');
    row.dataset.id = conflict.id;

    const code = document.createElement('div');
    code.className = 'review-row-code';
    code.textContent = conflict.id;
    if (conflict.typeMismatch) {
        const tag = document.createElement('span');
        tag.className = 'review-row-tag';
        tag.textContent = 'layout mismatch';
        code.appendChild(tag);
    }
    row.appendChild(code);

    if (conflict.typeMismatch) {
        // Spell out the consequence of "Keep mine" so the user knows what
        // the grid will look like after they commit. Different message for
        // each direction since the rewrite differs.
        const warn = document.createElement('div');
        warn.className = 'review-row-warning';
        if (conflict.theirs.multiCell && !conflict.yours.multiCell) {
            warn.textContent = `Pattern uses "${conflict.id}" as a multi-cell stitch; your version is single-cell. Keeping yours will split each cluster in this pattern into separate single-cell stitches.`;
        } else if (!conflict.theirs.multiCell && conflict.yours.multiCell) {
            warn.textContent = `Pattern uses "${conflict.id}" as a single-cell stitch; your version is multi-cell. Keeping yours will group consecutive cells into multi-cell clusters using your stitch.`;
        }
        row.appendChild(warn);
    }

    const pair = document.createElement('div');
    pair.className = 'review-pair';
    const setDecision = (next) => {
        conflict.decision = next;
        // Re-paint just this row so the toggle highlight tracks state without
        // reflowing the whole list.
        const fresh = buildReviewRow(conflict);
        row.replaceWith(fresh);
    };
    pair.appendChild(buildReviewCell('Yours',     conflict.yours,  conflict.decision === 'mine',   () => setDecision('mine')));
    pair.appendChild(buildReviewCell("Pattern's", conflict.theirs, conflict.decision === 'theirs', () => setDecision('theirs')));
    row.appendChild(pair);
    return row;
}

// Replace every user-multi cluster cell that references `stitchId` with the
// plain stitch-id string. Used when the user picks "Keep mine" for a
// multi → single type mismatch — without this, the renderer would draw
// fade-echo cluster spans against a single-cell icon, which looks broken.
function flattenMultiCellClustersInGrid(stitchId) {
    if (typeof state === 'undefined' || !Array.isArray(state.stitchGrid)) return 0;
    let rewritten = 0;
    for (const row of state.stitchGrid) {
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (cell && typeof cell === 'object' && cell.type === 'user-multi' && cell.stitchId === stitchId) {
                row[c] = stitchId;
                rewritten++;
            }
        }
    }
    return rewritten;
}

// Inverse of flatten: when the user picks "Keep mine" for a single → multi
// mismatch, the recipient's gallery def is multi-cell but the loaded grid
// holds plain string IDs (single-cell placements from the pattern file).
// Promote contiguous runs of that ID in each row into one multi-cell cluster
// per run, so the chart renders with the clustered look the user's stitch
// was designed for. Lone cells become width-1 clusters (same visual as
// before but consistent in the data model).
let _userMultiImportClusterCounter = 0;
function clusterizeSinglePlacementsInGrid(stitchId) {
    if (typeof state === 'undefined' || !Array.isArray(state.stitchGrid)) return 0;
    let runsCreated = 0;
    for (const row of state.stitchGrid) {
        if (!row) continue;
        let i = 0;
        while (i < row.length) {
            if (row[i] === stitchId) {
                let j = i;
                while (j < row.length && row[j] === stitchId) j++;
                const width = j - i;
                const groupId = 'umi' + (++_userMultiImportClusterCounter);
                const lead = Math.floor((width - 1) / 2);
                for (let k = 0; k < width; k++) {
                    row[i + k] = {
                        type: 'user-multi', stitchId, id: groupId,
                        width, pos: k, lead,
                    };
                }
                runsCreated++;
                i = j;
            } else {
                i++;
            }
        }
    }
    return runsCreated;
}

function buildReviewCell(label, record, isSelected, onToggle) {
    const cell = document.createElement('div');
    cell.className = 'review-cell' + (isSelected ? ' is-selected' : '');

    const lbl = document.createElement('div');
    lbl.className = 'review-cell-label';
    lbl.textContent = label;
    cell.appendChild(lbl);

    const icon = document.createElement('canvas');
    icon.className = 'review-cell-icon';
    icon.width = 64;
    icon.height = 64;
    cell.appendChild(icon);
    const ctx = icon.getContext('2d');
    ctx.fillStyle = STITCH_COLORS.bg;
    ctx.fillRect(0, 0, 64, 64);
    if (isEffectivelyEmpty(record.shapes)) {
        drawCodeAsText(ctx, record.code || record.id, 0, 0, 64, 64);
    } else {
        drawUserStitchShapes(ctx, record.shapes, 0, 0, 64, 64);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = isSelected ? 'btn-primary' : '';
    btn.textContent = label === "Pattern's" ? "Use pattern's" : 'Keep mine';
    btn.addEventListener('click', onToggle);
    cell.appendChild(btn);
    return cell;
}

// Done: commit every row's decision in one pass. Rows where the user picked
// "Use pattern's" require a single secondary confirm summarising the global
// gallery mutations — knitters who chose "Keep mine" for everything see no
// confirm at all, since nothing changes.
//
// Type mismatches (multiCell flag differs) on Keep-mine rows trigger a grid
// rewrite for the multi → single direction so the loaded chart renders
// cleanly with the recipient's single-cell icon. The single → multi
// direction needs no rewrite — cells stay as plain strings and render
// once per cell with the recipient's multi-cell icon at single-cell size
// (warned about in the modal).
async function commitImportReview() {
    const overwrites    = pendingImportConflicts.filter(c => c.decision === 'theirs');
    const flattens      = pendingImportConflicts.filter(c =>
        c.decision === 'mine' && c.typeMismatch && c.theirs.multiCell && !c.yours.multiCell
    );
    const clusterizes   = pendingImportConflicts.filter(c =>
        c.decision === 'mine' && c.typeMismatch && !c.theirs.multiCell && c.yours.multiCell
    );

    if (overwrites.length > 0) {
        const ids = overwrites.map(c => `• ${c.id}`).join('\n');
        const noun = overwrites.length === 1 ? 'this stitch' : 'these stitches';
        const choice = await confirmDialog({
            title: overwrites.length === 1 ? 'Replace stitch in your gallery?' : 'Replace stitches in your gallery?',
            message:
                `Replace ${noun} with the imported version?\n\n${ids}\n\n` +
                `This changes the stitch in every saved pattern that uses the same code, ` +
                `not just the one you're viewing.`,
            buttons: [
                { id: 'cancel',  label: 'Cancel' },
                { id: 'replace', label: overwrites.length === 1 ? 'Replace globally' : 'Replace all globally', kind: 'primary' },
            ],
        });
        if (choice !== 'replace') return; // user backed out — modal stays open
        let failed = 0;
        for (const c of overwrites) {
            try {
                await saveUserStitchToDB(c.theirs);
                StitchRegistry.upsertUserStitch(c.theirs);
            } catch (err) {
                console.warn('Could not replace', c.id, err);
                failed++;
            }
        }
        if (failed < overwrites.length) {
            document.dispatchEvent(new CustomEvent('stitch-registry-updated'));
        }
        if (failed > 0) {
            showToast(`Replaced ${overwrites.length - failed}, ${failed} failed.`, { tone: 'error' });
        }
    }

    // Rewrite the loaded grid for any keep-mine + type-mismatch decisions so
    // the per-cell records line up with the recipient's multiCell flag.
    //   multi → single: flatten cluster cells to plain strings
    //   single → multi: group contiguous string runs into clusters
    let cellsFlattened = 0;
    let runsClusterized = 0;
    for (const c of flattens)    cellsFlattened  += flattenMultiCellClustersInGrid(c.id);
    for (const c of clusterizes) runsClusterized += clusterizeSinglePlacementsInGrid(c.id);
    if ((cellsFlattened || runsClusterized) && typeof renderStitchOverlay === 'function') {
        renderStitchOverlay();
    }

    // Build a single end-of-flow toast summarising the whole batch.
    const kept = pendingImportConflicts.length - overwrites.length;
    const parts = [];
    if (overwrites.length) parts.push(`${overwrites.length} replaced`);
    if (kept)              parts.push(`${kept} kept`);
    if (cellsFlattened)    parts.push(`${cellsFlattened} cell${cellsFlattened === 1 ? '' : 's'} flattened`);
    if (runsClusterized)   parts.push(`${runsClusterized} run${runsClusterized === 1 ? '' : 's'} clustered`);
    if (parts.length) showToast(`Review complete — ${parts.join(', ')}.`);
    pendingImportConflicts = [];
    closeImportReviewModal();
    hideImportConflictBanner();
}

// Legacy per-row resolvers kept as no-ops in case anything still calls them.
function resolveConflictKeepMine(id) {
    const c = pendingImportConflicts.find(x => x.id === id);
    if (c) c.decision = 'mine';
}
function resolveConflictUseTheirs(conflict) {
    const c = pendingImportConflicts.find(x => x.id === conflict.id);
    if (c) c.decision = 'theirs';
}

function afterResolution(id, summary) {
    showToast(`"${id}" — ${summary}.`);
    if (pendingImportConflicts.length === 0) {
        closeImportReviewModal();
        hideImportConflictBanner();
    } else {
        renderImportReviewList();
        // Update the banner count too
        const text = document.getElementById('import-conflict-text');
        if (text) {
            const n = pendingImportConflicts.length;
            text.textContent = n === 1
                ? `1 stitch in this pattern differs from your gallery (showing your version).`
                : `${n} stitches in this pattern differ from your gallery (showing your versions).`;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('import-conflict-review')?.addEventListener('click', openImportReviewModal);
    document.getElementById('import-conflict-dismiss')?.addEventListener('click', () => {
        hideImportConflictBanner();
    });
    document.getElementById('import-review-close')?.addEventListener('click', closeImportReviewModal);
    document.getElementById('import-review-done')?.addEventListener('click', commitImportReview);
    document.getElementById('import-review-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'import-review-modal') closeImportReviewModal();
    });
});
