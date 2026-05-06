# Knitwittage — Architecture

A reference for picking the codebase up cold. Optimised for someone (or some
agent) sitting down for the first time who needs to make a change without
breaking three other things on the way.

The app is a vanilla-JS browser app with no module system. Every script in
`js/*.js` is loaded via `<script>` tags in [index.html](index.html) (search
for `v=` to find the load block) and shares a single global scope. There is
no bundler, no transpile step, no test suite.

This document covers:

- [1. Load order + module topology](#1-load-order--module-topology)
- [2. The `state` object](#2-the-state-object)
- [3. Module responsibilities](#3-module-responsibilities)
- [4. Cross-module public API](#4-cross-module-public-api)
- [5. Key data shapes](#5-key-data-shapes)
- [6. Conventions](#6-conventions)
- [7. Fragile points + load-bearing assumptions](#7-fragile-points--load-bearing-assumptions)

When making non-trivial changes, skim sections 5 and 7 first — those are
where most "I changed X and Y broke" surprises live.

---

## 1. Load order + module topology

Scripts load in the order declared in [index.html](index.html) (around line
595–610). Order matters: every script shares one global scope, so a function
or variable redeclared later in the load order silently overwrites the
earlier one. Confirmed safe ordering, with rationale:

| # | File | Owns |
|---|------|------|
| 1 | [js/grid-view.js](js/grid-view.js) | `GridView` IIFE — canvas-backed chart renderer |
| 2 | [js/app.js](js/app.js) | `state`, app init, palette init, tools, history, file save/load, zoom, status bar, copy/paste, keyboard shortcuts |
| 3 | [js/preview.js](js/preview.js) | Pattern preview modal (`renderPreview`, `openPreview`, `closePreview`) |
| 4 | [js/print.js](js/print.js) | Print view (`preparePrint`, panel chunking, icon rasterisation, dynamic cell sizing) |
| 5 | [js/instructions.js](js/instructions.js) | Row-by-row instructions encoder, instructions modal, abbreviation block, cable notation |
| 6 | [js/random.js](js/random.js) | "Random pattern" generator |
| 7 | [js/image.js](js/image.js) | "From image" pattern import |
| 8 | [js/stitches.js](js/stitches.js) | `BUILTIN_STITCHES`, `StitchRegistry`, IndexedDB user-stitch persistence |
| 9 | [js/stitch-editor.js](js/stitch-editor.js) | "Add Stitch Type" modal, drawing canvas, `editorState`, `renderEditorTilePreview` |
| 10 | [js/gallery.js](js/gallery.js) | `GalleryUI`, gallery overlay, search filter, gallery context menu, gallery file save/load, pattern-import conflict review |
| 11 | [js/cables.js](js/cables.js) | Stitch palette tile rendering, click+drag cable/multi-cell placement, `wrapSetToolForStitchClear`, left-panel context menu |
| 12 | [js/knit-mode.js](js/knit-mode.js) | "Knit mode" step-through overlay (`knitState`) |
| 13 | [js/tabs.js](js/tabs.js) | Top tab strip (Design / Refine Instructions / Knit) |

**Why this ordering matters:**

- `state` is declared in app.js (#2). Every later file reads/writes it. If a
  file before app.js touched `state`, it'd hit a TDZ ReferenceError.
- `GridView` (#1) is referenced from app.js, cables.js, knit-mode.js. Loading
  it first means it's always callable.
- `StitchRegistry` (#8) is referenced from gallery.js (#10), stitch-editor.js
  (#9), cables.js (#11), instructions.js (#5), print.js (#4). Anywhere it's
  read in module-scope code (rare — most reads are inside event handlers and
  resolve lazily) the registry has to be defined first.
- cables.js (#11) wraps `setTool` (defined in app.js). The wrap now lives
  inside its `DOMContentLoaded` handler ([js/cables.js:30](js/cables.js)),
  so there's no longer a parse-time dependency — both files just have to be
  parsed before the handler fires, which is automatic.

**`DOMContentLoaded` handlers** are registered in: app.js, cables.js,
gallery.js (×2), image.js, random.js, knit-mode.js, tabs.js, instructions.js,
stitch-editor.js, stitches.js. They compose (multiple handlers all run), but
firing order within a single tick depends on registration order, which in
turn depends on script load order. app.js's handler is the canonical
"initialise the app" one — it builds the colour palette, calls `initGrid`,
and wires the toolbar.

---

## 2. The `state` object

Single source of truth for runtime UI/document state. Declared `const` at
[js/app.js:12](js/app.js). Mutated from every file. Saved patterns are a
subset of these fields; see [§5](#5-key-data-shapes).

| Field | Type | Owner | Description |
|---|---|---|---|
| `rows`, `cols` | number | app.js | Grid dimensions. Mutated via `initGrid()`. |
| `grid` | `(string|null)[][]` | app.js | Colour grid. `null` = empty, otherwise hex `#rrggbb`. |
| `stitchGrid` | mixed[][] | app.js + cables.js | Per-cell stitch data. See [§5.1](#51-stitchgrid-cell-variants). |
| `activeColor` | `string|null` | app.js | Selected paint colour. Set by `selectColor()`. |
| `activeTool` | `'paint'|'fill'|'select'|'stitch'` | app.js | Primary tool. Mutated via `setTool()`. |
| `activeStitch` | `string|null` | cables.js | Selected stitch id (e.g. `'knit'`, `'left-cross'`, custom id). |
| `eraseStitch`, `eraseColour` | bool | app.js | Erase modifiers — independent of `activeTool`. |
| `isPainting` | bool | app.js | Mouse-down paint loop guard. |
| `paintStartCell`, `paintDragged` | object/bool | app.js | Drag-vs-click detection for paint. |
| `zoom` | number | app.js | Chart zoom factor (1.0 = default). Set via `setZoom()`. |
| `history`, `historyIndex`, `maxHistory` | array, num, num | app.js | Undo/redo. Each entry is a deep clone of `grid` + `stitchGrid`. |
| `patternName` | string | app.js | Saved-pattern name. |
| `knittingMode` | `'flat'|'round'` | app.js, knit-mode.js | Affects row direction in instructions. |
| `firstRow` | `'RS'|'WS'` | app.js | Which side row 1 is on (flat only). |
| `customInstructions` | `string|null` | instructions.js | User-edited override of generated instructions. |
| `selection` | `{r1,c1,r2,c2}|null` | app.js | Active selection rectangle. |
| `clipboard` | object|null | app.js | Last-copied region (colour + stitch + dimensions). |
| `clipboardStitches` | mixed[][]|null | app.js | Companion stitch data for paste. |
| `isSelecting`, `isPasting`, `pasteGhostPos` | bool, bool, object | app.js | Selection / paste mode flags. |
| `cableDragStart`, `cableDragEnd` | `{row,col}|null` | cables.js | Active cable / multi-cell drag. |
| `activeStitches` | `Set<string>|null` | app.js | Project-level palette filter. `null` = "show all". See `getEffectiveActiveStitches()`. |

**State that ISN'T on `state`:** module-private state objects scoped to a
single file:

- `editorState` ([js/stitch-editor.js:6](js/stitch-editor.js)) — drawing
  canvas state for the Add Stitch Type modal.
- `knitState` ([js/knit-mode.js:4](js/knit-mode.js)) — current row, paused
  flag, etc., for Knit mode.
- `GalleryUI` ([js/gallery.js:8](js/gallery.js)) — `{ open, filter }` for
  the gallery overlay.

Module-private state is preferred over `state.foo` for anything that
genuinely belongs to one module's modal / overlay. Don't add fields to
`state` if a single file owns them end-to-end.

---

## 3. Module responsibilities

### grid-view.js — `GridView`

Canvas-backed renderer for the main chart. Public methods (called from app.js,
cables.js, knit-mode.js): `init`, `rerender`, `redrawCell`, `clearCableGhost`,
`drawCableGhost`, `cellBoundsWrapper`, `cellAtClient`. Owns three stacked
canvases inside `#grid-container`. Treats the rest of the app as untrusted —
never reads `state` directly; everything is passed in. This is the cleanest
module in the codebase.

### app.js

The "everything else" module. Contains:

- The `state` declaration (top of file).
- App boot: `initPalette`, `initGrid`, `bindCanvasEvents`, `bindKeyboard`.
- Tools: `setTool`, `toggleEraseStitch`, `toggleEraseColour`, `updateToolButtons`.
- Painting: mouse handlers that route to `paintCell`, drag-vs-click logic.
- History: `pushHistory`, `undo`, `redo`.
- Zoom: `setZoom`, wheel/keyboard zoom anchoring.
- File: `saveToFile`, `loadFromFile`, `handleFileLoad`, `restorePatternData`.
- Selection / copy-paste: `copySelection`, `cutSelection`, `pasteClipboard`,
  `armPasteGhost`, `renderPasteGhost`, `commitPaste`, `cancelPaste`,
  `clearSelection`, `normalizeSelection`, `deleteSelection`. Copy / cut
  arm the ghost immediately (Ctrl+C is the user's "I want to place this"
  gesture); Ctrl+V commits at the current ghost position if armed,
  otherwise re-arms. `commitPaste` does NOT cancel after pasting — the
  ghost stays armed for **multi-paste** (each successive left-click drops
  another copy). Right-click on the grid OR Esc dismisses. The mousedown
  handler ignores non-left buttons in paste mode so right-click reaches
  the contextmenu listener cleanly; otherwise it would commit-and-erase
  (mousedown commits, then contextmenu erases the cell). `renderPasteGhost`
  includes cells with stitches but no colour by tinting them so the ghost
  footprint is always visible.
- Pattern-region helpers: `getPatternBounds`, `getPatternRegion`,
  `getStitchRegion`, `getStitchesUsedInGrid`, `getEffectiveActiveStitches`.
- Status bar / save indicator / colour palette setup.

If you don't know where something lives, app.js is the safe first guess.

### preview.js

The Pattern Preview modal. `openPreview()`, `renderPreview()`, `closePreview()`.
Renders the chart tiled (1, vertical, horizontal, or both repeats) onto a
single `<canvas id="preview-canvas">`. Colour-only.

### print.js

`preparePrint()` is the entry point (called from the Instructions modal's
Print/PDF button). Builds the print DOM from scratch each call:

- Reads pattern + stitch region.
- Auto-fits cell size to page width (4–7mm clamp).
- Splits into multi-page panels horizontally if the grid is wider than a
  page, vertically if taller. Cluster boundaries (cables, multi-cell user
  stitches) are preserved across splits.
- Rasterises user-stitch icons to PNG via offscreen canvas when the
  "Icons in chart" toggle is on; otherwise emits text codes.
- Builds a registry-driven legend (built-ins, user stitches, cables,
  multi-cell user stitches, no-stitch marker, colours).
- Triggers `window.print()`.

Print styling lives in `@media print` blocks in [css/style.css](css/style.css)
(search for `@media print`). Per-cell sizing is injected as a dynamic
`<style id="print-dynamic-styles">` element to keep the per-cell HTML
attribute-free (a 150×150 chart with inline `style` per `<td>` produced an
unreadable PDF).

### instructions.js

Row-by-row encoder. `formatInstructionsText(pattern, mode)` is the public
entry point — produces the multi-line `Row N (RS): K20` text. Run-length
compression collapses consecutive simple stitches by `(st, color)` (built-in
K/P) or by `(text, color)` (M1R, K2tog, YO, user-defined simple stitches).
Cables and multi-cell user stitches stay one-per-cluster.

YO-balancing (passes 1 + 2 in `encodeRowWithStitches`) auto-converts a knit
between two YOs into a centred double decrease (S2KP / SP2P) and pairs
remaining unpaired YOs with the nearest knit converted to K2tog/SSK/P2tog.

The Instructions modal lives here too: open/close, regenerate, copy/download/print.

### random.js, image.js

Two pattern generators. `random.js` populates the grid with a randomised
pattern; `image.js` quantises an uploaded image to a chosen palette and
maps each pixel to a cell. Both wholly self-contained — they call
`pushHistory()` after committing changes and rely on app.js for the rest.

### stitches.js

The single source of truth for what a "stitch" is. Defines:

- `BUILTIN_STITCHES` — the 10 hardcoded built-ins (knit, purl, k-right,
  k-left, m1r, m1l, hole, left-cross, right-cross, no-stitch) plus the
  `stitch-erase` tool tile.
- `StitchRegistry` — the in-memory registry. `getAll()`, `get(id)`,
  `isCross(id)`, `isUserMulti(id)`, `setUserStitches(list)`,
  `upsertUserStitch(record)`, `removeUserStitch(id)`, etc.
- IndexedDB persistence for user stitches (`STITCH_DB_NAME = 'knitwork'`,
  store `'user_stitches'`).
- Per-stitch drawing functions (`drawKnitTileIcon`, `drawKnitCell`, etc.)
  that all the renderers (palette, grid, gallery, print) call.
- `hydrateUserStitch(record)` — converts a JSON record into a registry
  entry with bound `drawIcon` / `drawCell`.

Every other file that asks "what does this stitch look like?" or "what's
its code?" goes through `StitchRegistry.get(id)`. **Never special-case a
stitch id in another file — extend the registry instead.**

### stitch-editor.js

The "Add Stitch Type" modal. Owns `editorState` (the live drawing state).
Public-ish: `openStitchEditor(existing)` — pass nothing for a new stitch,
or a registry entry to edit. `renderEditorTilePreview()` repaints the
small live preview in the modal (do not confuse with `renderPreview` —
that's the pattern preview; see [§7](#7-fragile-points--load-bearing-assumptions)).

### gallery.js

The Stitch Gallery overlay. Read [js/gallery.js:1](js/gallery.js) — the
header comment summarises the model. Owns:

- The overlay UI (open/close/Esc/click-out).
- `renderGalleryList()` + `buildGalleryItem()` — tile grid; click toggles
  a stitch into / out of `state.activeStitches`.
- `stitchMatchesFilter()` — search filter (case-insensitive substring
  match on code / id / label / sublabel).
- `openGalleryContextMenu()` — Edit / Delete on right-click of a user
  stitch tile.
- Gallery file save / load, with batched-conflict review.
- Pattern-load conflict review (when an opened pattern brings user
  stitches whose icons differ from the recipient's). Also owns the
  "import-conflict-banner" + "import-review-modal" UI.

### cables.js

Stitch palette tile rendering AND interaction handlers for cable / multi-cell
placement. Slightly mis-named for historical reasons (started as a
cables-only module). Owns:

- `initStitchPalette()` — rebuilds the left-panel tile grid from the
  registry, filtered by `getEffectiveActiveStitches()`.
- `selectStitch(id)` — sets `state.activeStitch` and switches `activeTool`
  to `'stitch'`.
- Cable / multi-cell drag-placement: `commitCross()`, `commitUserMulti()`,
  cluster-splitting helpers (`clearOverlappedClustersInRow`).
- `wrapSetToolForStitchClear()` — wraps app.js's `setTool` so picking a
  non-stitch tool clears `state.activeStitch`. Wrap is applied inside the
  `DOMContentLoaded` handler ([js/cables.js:30](js/cables.js)) so there's
  no parse-time dependency between cables.js and app.js.
- Left-panel context menu (right-click → Hide stitch).

### knit-mode.js

"Knit mode" — the step-through overlay that walks the user row-by-row
through the chart while they knit. Owns `knitState` ({ row, paused, ... }),
the bottom-bar overlay, the fullscreen view, and key bindings while active.

### tabs.js

Top-of-screen tab strip (Design / Refine Instructions / Knit). Trivial.

---

## 4. Cross-module public API

When a function is called from a different file than it's defined in, that's
implicitly the module's public API. Listed here for orientation.

**From app.js, called by everyone:**
- `state` — read/write everywhere. The single shared mutable.
- `pushHistory()` — call after any mutation to `grid` / `stitchGrid` that
  the user could undo. Random.js, image.js, gallery.js, cables.js all do.
- `getPatternBounds()`, `getPatternRegion()`, `getStitchRegion(rows, cols)`
  — current chart region. Used by preview.js, print.js, instructions.js.
- `getStitchesUsedInGrid()` — Set of ids actually placed. Used by gallery.js,
  cables.js (palette filter).
- `getEffectiveActiveStitches()` — palette filter result (active ∪ in-use ∪
  always-on tools).
- `setTool(tool)` — wrapped by cables.js; called everywhere a tool change
  is needed.
- `selectColor(color)` — sets active colour; auto-switches to Paint unless
  in Fill mode.
- `setZoom(newZoom, anchorClientX, anchorClientY)` — chart zoom with
  cursor-anchored scroll.
- `showToast(msg, opts)` — non-blocking notification.
- `confirmDialog({title, message, buttons})` — async confirmation.
- `isLightColor(hex)`, `hexToColorName(hex)` — colour utilities.
- `markSaved()` — masthead "saved · 2m ago" indicator.
- `renderGrid()`, `renderStitchOverlay()`, `renderSelectionOverlay()`,
  `renderNumbers()` — paint passes (delegate to GridView).
- `cancelPaste()`, `clearSelection()` — modal-state helpers.

**From stitches.js:**
- `StitchRegistry` — see above.
- `BUILTIN_STITCHES` — read by gallery.js, cables.js to enumerate built-ins.
- `STITCH_COLORS` — colour palette (yarn / bg / paperShade etc.) used by
  every drawer.
- `drawUserStitchShapes(ctx, shapes, x, y, w, h)` — draws a custom-stitch's
  shape array onto a canvas. Used by stitch-editor preview, gallery item
  rendering, print icon rasterisation.
- `drawCodeAsText(ctx, code, x, y, w, h)` — fallback when a user stitch has
  no shapes; draws the code as auto-fit text.
- `isEffectivelyEmpty(shapes)` — is a user stitch's shape array empty
  (after stripping erase strokes).
- `hydrateUserStitch(record)` — JSON record → registry entry.
- `loadUserStitchesFromDB()`, `saveUserStitchToDB(rec)`, `deleteUserStitchFromDB(id)`.
- `deleteUserStitch(id)` — confirm dialog + DB delete + registry remove +
  registry-updated event.

**From cables.js:**
- `initStitchPalette()` — rebuilt from registry; called by
  `stitch-registry-updated` event handler in cables.js itself, and after
  `state.activeStitches` mutates from gallery.js.
- `selectStitch(id)` — set the active stitch.
- `buildStitchTile(stitch, options)` — used by `initStitchPalette` and by
  the gallery if/when it ever shares this code path.
- `buildCrossingNotation(stitch)` — used by instructions.js + print.js to
  render cable codes.
- `collectUniqueCrossings(stitchRegion)` — for legend.

**From gallery.js:**
- `mergeUserStitches(list, opts)` — gallery file import.
- `mergePatternUserStitches(list)` — pattern-file import (deferred conflict path).
- `showImportConflictBanner(conflicts)` — shown by app.js after pattern load.

**Events (custom DOM events):**
- `stitch-registry-updated` — fired by stitches.js / gallery.js after the
  user stitches list mutates. Listened to by cables.js (palette repaint),
  gallery.js (gallery list repaint), GridView via `renderStitchOverlay`.

---

## 5. Key data shapes

### 5.1 stitchGrid cell variants

`state.stitchGrid[r][c]` is one of:

| Value | Meaning |
|---|---|
| `null` | No stitch placed (paints as the default knit when rendering). |
| `'knit'` | Explicit knit. (Distinct from `null` only when the user has Erase Stitch'd a cell.) |
| `'purl'` | Purl. |
| `'k-right'`, `'k-left'` | K2tog / SSK (right/left-leaning decrease). |
| `'m1r'`, `'m1l'` | Make-1 right / left. |
| `'hole'` | Yarn-over (lace hole). |
| `'no-stitch'` | Chart placeholder — "no cell here". Treated as background; skipped by row count, instructions, etc. |
| Any other string | A user-defined stitch id. Look it up via `StitchRegistry.get(id)`. |
| `{type: 'cross', dir, width, pos, id, clusters}` | A cell of a cable cluster. ALL `width` consecutive cells in the row hold a copy of this object with the same `id`; `pos` is 0..width-1 within the cluster. `dir` is `'left'` or `'right'`. `clusters` holds knit/purl run breakdown for non-uniform cables. |
| `{type: 'user-multi', stitchId, id, width, pos, lead}` | A cell of a multi-cell user stitch cluster. Same shape as cable but `stitchId` points to a registry entry. `lead` is the position within the cluster that draws the icon at full opacity (others draw faded echoes). |

**Critical invariants**:

1. Every cell of a cluster (cable or user-multi) holds the **same** object
   reference (or a structurally identical one in the case of paste — see
   `pasteClipboard()` for the clone-with-new-id logic at
   [js/app.js:1466](js/app.js)).
2. `pos` is the cluster-local index; `c - cell.pos` gives the cluster's
   starting column; `cluster start + width - 1` is its last column.
3. Erasing or overwriting any cell of a cluster requires clearing the WHOLE
   cluster — see `clearOverlappedClustersInRow()` in cables.js. This is
   the "Cluster integrity" rule documented in commit `acfdf9c`.
4. When an iterator processes a cluster it should mark the cluster id in a
   `Set` (typically called `drawnClusters` or `processed`) and skip
   subsequent cells of the same cluster. See loops in print.js and
   instructions.js for the canonical pattern.

### 5.2 Pattern file format (`.knit.json`)

Saved by `saveToFile()` ([js/app.js:870](js/app.js)). Top-level fields:

```json
{
  "name": "...",
  "rows": 20,
  "cols": 20,
  "grid": [...],
  "stitchGrid": [...],
  "knittingMode": "flat",
  "firstRow": "RS",
  "customInstructions": null,
  "userStitches": [ ... ],     // user-stitch records the pattern depends on
  "activeStitches": [ ... ]    // Set serialised as array
}
```

Loader is permissive — fields can be missing on older files. `userStitches`
goes through `mergePatternUserStitches()` (deferred conflict path).

### 5.3 Gallery file format (`.json`)

Saved by `saveGalleryFile()` ([js/gallery.js:130-ish](js/gallery.js)):

```json
{
  "type": "knitwittage-gallery",
  "version": 1,
  "exportedAt": "2026-05-06T...",
  "stitches": [ <user-stitch record>, ... ]
}
```

Loader accepts files with either `stitches` OR `userStitches` (the latter
lets a knitter import the user-stitches block from a pattern as a gallery
file). Built-in id collisions are silently rejected — built-ins can't be
overridden.

### 5.4 User-stitch record

The shape stored in IndexedDB and serialised to gallery / pattern files:

```js
{
  id: 'k2tog-custom',
  label: 'My K2tog',
  sublabel: 'dec 1',
  title: 'Detailed tooltip text',
  code: 'K2T',                  // notation in instructions
  detailedInstructions: '...',   // long-form, shown once at top of instructions
  shapes: [                      // drawn in stitch editor
    { type: 'line', x1, y1, x2, y2, stroke, strokeWidth },
    { type: 'curve', x1, y1, cx, cy, x2, y2, stroke, strokeWidth },
    { type: 'rect', x, y, w, h, stroke, fill, strokeWidth },
    { type: 'ellipse', cx, cy, rx, ry, stroke, fill, strokeWidth },
    { type: 'text', x, y, text, fill, fontSize },
  ],
  multiCell: false,              // true → drag-placed cluster, lead+echoes
  source: 'user',
  order: 500
}
```

Shape coordinates are in 0–100 space (scaled to cell size at render).

---

## 6. Conventions

### 6.1 Naming

**Avoid generic names at top level.** Anything declared `function foo()`
or `const foo = ...` at file scope joins one shared namespace. Currently
collision-bait names (unique today, but easily reused):

- `commit*` — six exist (`commitCross`, `commitUserMulti`, `commitPaste`,
  `commitPending`, `commitEditing`, `commitLiveText`). Prefer
  `<verb>X<context>` like `commitCableCross` if adding more.
- `setupCanvas`, `clearCanvas`, `redrawCanvas` (stitch-editor.js).
- `nextRow`, `prevRow` (knit-mode.js).
- `clamp`, `clamp01` (utility names).

If you find yourself wanting `function render()` or `function update()`,
rename: prefix with the module's domain.

**Module-private state** lives in a named object (`editorState`,
`knitState`, `GalleryUI`), not loose top-level `let`s. The IIFE pattern
in grid-view.js is the cleanest version of this and the model worth
imitating for new modules.

### 6.2 Stitch lookups

Always go through `StitchRegistry.get(id)`. Don't write `if (id === 'knit')
{ ... } else if (id === 'purl') { ... }` outside stitches.js. The registry
holds `printSymbol`, `code`, `label`, `drawCell`, `multiCell`, etc. — use
those instead of duplicating per-stitch logic.

### 6.3 Mutating state

After any mutation that changes the chart (paint, erase, paste, generator
output, cluster placement), call `pushHistory()` exactly once for the
batch. After mutating user stitches (registry add/edit/remove), dispatch
`stitch-registry-updated` so the palette + gallery + chart overlay
repaint.

### 6.4 Versioning + cache busting

When you change shipping JS or CSS, bump:

1. `?v=NNN` on every `<script>` and `<link>` in [index.html](index.html).
2. `CACHE_VERSION` in [sw.js](sw.js).

The service worker holds an aggressive cache and won't pick up edits
otherwise. The `v=N` query string forces the browser HTTP cache to
re-fetch even when the SW is gone.

### 6.5 Testing changes

There is no automated test suite. After non-trivial changes, smoke-test:

1. Reload the page. Confirm no console errors.
2. Paint a colour, place a stitch, place a cable, hit Undo / Redo.
3. Open Preview Pattern. Confirm it renders.
4. Open Instructions, regenerate. Confirm K/P collapse + cable codes.
5. Open Print / PDF. Spot-check at 20×20 and at 70×30 (multi-panel).
6. Open Gallery overlay. Confirm search filter works and right-click on a
   user stitch shows Edit / Delete.

For a UI change, also: small chart, big chart (>30 cols), colour-only,
stitch-only, mixed colour+stitch.

---

## 7. Fragile points + load-bearing assumptions

These are the cases where a change in one place breaks something distant.
Read these BEFORE making non-trivial edits.

### 7.1 Single-namespace JS

Every `function X()` and `const X` at file top level shares ONE global
namespace. The previous regression: two files declared
`function renderPreview()` — the later one silently won, and the pattern
preview broke. Fixed by renaming the editor's helper to
`renderEditorTilePreview` ([js/stitch-editor.js:754](js/stitch-editor.js)).

**Mitigation when adding code**: grep for the function name across `js/`
before declaring it. Better, prefer module-private state objects (see
GridView IIFE pattern).

### 7.2 `state` is a single shared `const`

Declared at [js/app.js:12](js/app.js). Every file mutates it. A future
`let state` declaration in any file would TDZ the entire app at load
(ReferenceError before app.js's declaration runs).

**Mitigation**: if you're tempted to add `let state = ...` in a new file,
rename it (`editorState`, `gameState`, etc.) — never shadow `state`.

### 7.3 setTool wrap

cables.js wraps app.js's `setTool` to clear `activeStitch` when picking a
non-stitch tool. The wrap now lives inside cables.js's `DOMContentLoaded`
handler ([js/cables.js:30](js/cables.js), function
`wrapSetToolForStitchClear`), so there's no parse-time dependency.

**Mitigation if extending**: don't add a SECOND wrap of `setTool` from
another file — the second wrapper would replace the first one, dropping
cables.js's stitch-clearing behaviour. If you need additional setTool
behaviour, modify `wrapSetToolForStitchClear`.

### 7.4 Cluster cells must be cleared as a unit

A cell of a cable / user-multi cluster never makes sense alone. Helpers
`clearOverlappedClustersInRow()`, `flattenMultiCellClustersInGrid()`,
`clusterizeSinglePlacementsInGrid()` all live in cables.js / gallery.js.
**If you write new code that mutates `stitchGrid`**, check for cluster
cells first (`typeof cell === 'object'`) and either preserve the cluster
or clear all of its cells together.

### 7.5 `getEffectiveActiveStitches` always re-adds in-use stitches

The palette filter unions `state.activeStitches` ∪ `getStitchesUsedInGrid()`
∪ `{stitch-erase}`. So toggling a stitch off via the gallery (or hiding
it via right-click on the left panel) does NOT remove it from the palette
if it's still placed in the chart. The Hide-stitch right-click path
([js/cables.js:881-ish](js/cables.js), function `hideStitchFromPalette`)
explicitly refuses with a toast when the stitch is in use; the gallery
overlay shows it as "is-locked".

### 7.6 Two `<canvas>` elements with similar names

- `#preview-canvas` — pattern preview modal's canvas (preview.js).
- `#st-preview-canvas` — stitch editor's tile preview (stitch-editor.js).
- `#preview` (canvases inside `GridView`) — the chart layers.

If you add a new canvas, namespace its id (`#x-preview-canvas`,
`#x-grid-canvas`).

### 7.7 Print HTML size

The print pipeline is sensitive to inline-style bloat. A 150×150 chart
with `style="width:4mm;height:4mm"` on every `<td>` made the resulting
PDF unreadable. Cell sizing now lives in a dynamic `<style>` element
injected per print run, applied via `<colgroup>` + classed `<col>`s.
**Don't reintroduce per-cell inline styles.** See `injectPrintCellStyle`
in [js/print.js](js/print.js).

### 7.8 IndexedDB schema is shared

Database name `'knitwork'`, store `'user_stitches'`. If you bump
`STITCH_DB_VERSION` (currently 1), implement `onupgradeneeded` correctly
or you'll wipe the user's custom stitches.

### 7.9 `defaultActiveStitches()` is the new-project default

[js/app.js:60](js/app.js) — the 10 built-in ids that show in a fresh
project's palette. Adding a new built-in stitch? Decide whether it should
be in the default palette or hidden (user enables it via gallery).

---

## Quick reference: where do I look for...?

| Task | Files |
|---|---|
| Fix a paint bug | app.js (paint handlers), grid-view.js (rendering) |
| Add a new built-in stitch | stitches.js (`BUILTIN_STITCHES` + drawing fns), defaultActiveStitches in app.js |
| Change instruction text | instructions.js |
| Change print layout | print.js, css/style.css `@media print` block |
| Modal won't open | grep `id="<modal-id>"` in index.html, then look at the bind in DOMContentLoaded |
| Z-index / overlay layering | css/style.css, search for `z-index:` |
| Chart isn't repainting | grid-view.js, look for `rerender()` calls; also check `stitch-registry-updated` event |
| Cable acts weird | cables.js, especially `commitCross`, `clearOverlappedClustersInRow` |
| User stitch import | gallery.js, `mergeUserStitches` / `mergePatternUserStitches` |

When in doubt, grep. The codebase is small enough (~10kloc JS) that a
two-minute Grep across `js/` beats any documentation lookup.
