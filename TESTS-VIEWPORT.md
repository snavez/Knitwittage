# Viewport-rendering test plan

A checklist for verifying viewport-based GridView rendering doesn't break
any existing grid functionality. Each item lists what to test and (where
useful) the JS expression to run in the preview console.

The unit tests (`npm test`) cover pure-math helpers; everything below is
DOM/canvas/state behaviour and runs in the browser.

---

## 1. Memory & GPU footprint (the whole point)

- [ ] Canvas dimensions stay viewport-sized regardless of grid size
  ```js
  initGrid(50, 50);
  const c1 = document.querySelector('.grid-base-canvas');
  const sm = { w: c1.width, h: c1.height };
  initGrid(1000, 1000);
  const c2 = document.querySelector('.grid-base-canvas');
  const lg = { w: c2.width, h: c2.height };
  // sm and lg should be approximately equal — both sized to viewport,
  // not to grid.
  ({ sm, lg });
  ```
- [ ] No GPU OOM at 1000×1000 grid
- [ ] Resize 800 → 900 → 1000 in sequence completes without crash
- [ ] Stitch tile icons in the left palette stay rendered after big-grid switch (canvas-context loss check)

## 2. Initial render & basic painting

- [ ] Fresh grid: empty cells render with the surface colour, gridlines visible
- [ ] Painted cells render with their colour
- [ ] Cells off-screen don't waste paint cycles (visible-only repaint)
- [ ] After switching to a grid bigger than viewport, only visible cells paint

## 3. Scrolling

- [ ] Mouse-wheel scroll moves the visible region
- [ ] Trackpad two-finger scroll works
- [ ] Touch-drag scroll works on touch devices
- [ ] Scrolling triggers a repaint that shows new cells correctly
- [ ] Scrollbar size reflects total chart, not viewport
- [ ] Can scroll all the way to the right/bottom edge of the chart
- [ ] Can scroll back to (0, 0) and see row 1 / col 1
- [ ] No flicker on rapid scroll
- [ ] Scroll position survives a re-render that doesn't change dimensions

## 4. Zoom

- [ ] Zoom in (Ctrl+= or wheel+Ctrl): cells get bigger, fewer visible
- [ ] Zoom out: cells get smaller, more visible
- [ ] Zoom anchor: cell under cursor stays under cursor
- [ ] After zoom, scrollbar size updates to reflect new chart pixel size
- [ ] Zooming way out: chart fits in viewport (scrollbar disappears or minimal)
- [ ] Zoom + scroll combined: math stays correct
- [ ] No GPU OOM at any zoom level on 1000×1000 grid

## 5. Resize (rows/cols)

- [ ] Resize via Dimensions panel: chart pixel-size updates, scrollbar updates
- [ ] Insert row above (#17): scrollbar grows by one cell-height, content shifts
- [ ] Delete row: scrollbar shrinks, content shifts
- [ ] Insert col left/right: scrollbar grows by one cell-width
- [ ] Delete col: scrollbar shrinks
- [ ] Scroll position preserved when possible after dimension change

## 6. Cell modifications

- [ ] Paint visible cell: shows the colour immediately
- [ ] Paint off-screen cell (programmatically): scroll there, colour is rendered
- [ ] Erase visible cell: returns to empty
- [ ] Drag-paint across visible cells: stroke paints all cells
- [ ] Drag-paint across the visible/off-screen boundary: works correctly
- [ ] Click on a far-edge cell at scroll position (500,500): hit-tests correctly

## 7. Stitch placement

- [ ] Place K (or any simple stitch) on visible cell
- [ ] Place a cable (drag across multiple cells)
- [ ] Place cable that spans the visible/off-screen boundary
- [ ] Place a multi-cell user stitch
- [ ] Cluster cells render correctly (icon at lead, echoes on flanks)
- [ ] Stitch overlay scrolls in sync with base canvas

## 8. Selection & paste

- [ ] Drag a selection rectangle entirely within visible area
- [ ] Drag a selection that extends off-screen — visible portion shown
- [ ] Selection tint correct on visible cells
- [ ] Copy + paste-ghost: ghost renders on cells, follows cursor
- [ ] Paste ghost extending off-screen: visible portion clipped correctly
- [ ] Multi-paste: each click drops a copy correctly
- [ ] Esc / right-click cancels paste-ghost cleanly

## 9. Sticky row/col rails

- [ ] Row labels stay visible at left/right edges during scroll
- [ ] Col labels stay visible at top/bottom edges during scroll
- [ ] Rail labels scroll vertically (rows) or horizontally (cols) with chart
- [ ] Right-click on a rail label opens the context menu with correct row/col
- [ ] At a deep scroll position, right-clicking row 743 still says "Row 743"
- [ ] Insert/delete via rail still works at scrolled positions

## 10. Knit mode

- [ ] Active row highlight visible when row is on-screen
- [ ] When stepping to a row that's currently off-screen, chart auto-scrolls to bring it in view
- [ ] Active row highlight stays in sync as user manually scrolls

## 11. Coordinate translation (the tricky part)

- [ ] `cellAt(clientX, clientY)` returns correct cell at all scroll positions
- [ ] `cellBoundsWrapper(r, c)` returns correct screen coords at all scroll positions
- [ ] Cell at scroll(500, 500) clicks the cell whose chart-coordinates match
- [ ] Coordinates accurate at every zoom level

## 12. History (undo/redo)

- [ ] Undo/redo restores grid state
- [ ] Repaint reflects undo
- [ ] Scroll position preserved across undo if possible
- [ ] After resize undo, scrollbar reverts to previous chart size

## 13. Mode switching & overlays

- [ ] Cable ghost during drag renders correctly
- [ ] Cable ghost crossing tile/viewport edges renders correctly
- [ ] Switching tools (Paint / Fill / Select / Stitch) clears ghosts as expected
- [ ] Switching to Knit mode and back doesn't leave artefacts

## 14. Print / Preview / Instructions

- [ ] Pattern preview modal renders the full chart (uses its own canvas, unaffected)
- [ ] Print view shows full chart unaffected by viewport rendering
- [ ] Instructions render correctly
- [ ] Knit-mode step-through renders correctly

## 15. Edge cases

- [ ] 1×1 grid: chart smaller than viewport — no scrollbar, canvas fills
- [ ] Grid wider than tall, taller than wide
- [ ] Window resize: canvas dimensions update to new viewport
- [ ] Tab visibility change: no errors when tab regains focus
- [ ] Service worker cache reload: state restored correctly

---

## How to run

In Chrome DevTools or Claude's preview eval, paste each block and check
the result. For the manual checklist items, drive the UI with mouse +
keyboard and watch for the described behaviour.

A green run is: every box ticked, no errors in `preview_console_logs`,
no GPU memory warnings, and the chart paints crisply at every scroll
+ zoom level.
