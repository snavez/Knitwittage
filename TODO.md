# Knitwittage — Todo

A running list of work to come back to. Roughly ordered by ease/impact, but feel free to reshuffle.

---

## Stitches & gallery polish

### 7. Open question: editable built-in icons?

Knit, purl, inc1, dec1, YO are low-risk to allow editing — purely visual. Cable crossings
carry rendering smarts (cluster detection, echoes, drag-placement) that a user-edited
icon would break. Possible compromise: editable for simple stitches, locked for cross-
type. Park until someone actually asks.

### 8. Inc/dec metadata in the stitch editor

Add a small fieldset to the **Add / Edit Stitch** overlay capturing the stitch's effect
on row count: how many stitches it **consumes** from the previous row and **produces**
for the next. Three quick presets — *Same* (1 in / 1 out, the default), *Increase by N*,
*Decrease by N* — plus a "Custom" option that exposes the two numbers directly for
unusual cases (e.g. K3tog → 3 / 1; M1 → 0 / 1; YO → 0 / 1).

Bump the gallery file format to carry the metadata; existing user stitches without it
default to *Same*. This is a prerequisite for #19 (per-row stitch counter + balance
check) — populating the field now means the data is already there when that feature
ships. Useful on its own too: surface inc/dec status in the legend / instructions
("**K2tog** *(decrease 1)*").

---

## Layout & responsiveness

### 9. Mobile layout

The desktop 3-column grid doesn't fit phones — left panel survives but the chart and
right panel get cropped. This needs a real responsive design pass, not a quick CSS tweak:

- Breakpoint where panels collapse into bottom sheets / drawers, or stacked rows.
- Chart becomes the dominant viewport; everything else is on demand.
- Touch-friendly target sizes (44×44 minimum for tap targets).
- Pinch-zoom on the chart.
- Pen/finger input parity with mouse for stitch placement.

Worth sketching wireframes before code.

---

## Instructions tab

### ~~13. Cable code rename~~ ✓

Shipped. Crossings now use standard notation:

- `CnF` / `CnB` for **all-knit** cables (e.g. C4F for a 4-stitch left cable).
- `TwnL` / `TwnR` for **mixed knit/purl twists** (e.g. Tw4L for a 4-stitch
  left twist where knits cross over purls).
- 3-cluster crossings with a purl centre but knit outers (K2/P1/K2) are
  correctly classified as cables — only the outer groups determine the type.
- Gallery tiles show `CF (TwL)` / `CB (TwR)` so the user sees both roles.
- Crossing Definitions in the instructions use matching `(Cable Front)` /
  `(Twist Left)` etc. terminology.

### 14a. End-of-piece marker for full no-stitch rows (long-term)

The short-term bug fix shipped — `getActiveKnittingRows()` skips all-no-stitch
rows from the row count so the instructions don't fabricate K/P stitches for
chart placeholders.

The long-term feature is still open: a full no-stitch row separating two regions
of stitches should mean "cast off here, then cast on again for the next piece"
— so a chart with a 1-row gap between two panels generates two separate sets
of instructions with the appropriate cast-off / cast-on lines between them.
Needs a small UX decision around how the user signals "this is a deliberate
end-of-piece break" vs "I just left a row blank by accident".

Now that #11 (cast-on preamble) has shipped, the cast-on line can be reused at
each piece boundary; the cast-off side just needs a `Cast off N stitches` line
in the same position.

---

## Bigger features

### 16b. Canvas tiling for big grids

`GridView` paints a single `<canvas>` element. Browsers cap one canvas
dimension at ~16 384px (Safari/iOS) and even where the dimension cap is
higher (Chrome desktop = 32 767px), GPU memory becomes the bottleneck —
at 22 000² that's ~1.94GB per canvas, which mid-range Windows GPUs
white-out on. Currently `GRID_CANVAS_LIMIT_PX = 16000`, which means
1000×1000 grids top out at ~0.68× zoom (cells ~15px) instead of the 1.0×
cap that smaller grids reach.

The fix: split the chart across a grid of smaller canvas tiles, each
under the per-canvas limit. The `redrawAll` loop iterates tiles instead
of one canvas; `cellAt(clientX, clientY)` translates through tile rect
math. Trade-off: more bookkeeping, more state in `GridView`, but
1000×1000 reaches 1.0× zoom cleanly and we lose the canvas-size cap as a
fragile point (§7.10).

When this lands, also bump `GRID_CANVAS_LIMIT_PX` (or remove it
entirely) and update §7.10 of ARCHITECTURE.md.

### 17. Row & column insert / delete

Right-click on a row number, column number, or cell to insert or delete a row/column
*without* changing the total grid dimensions — the bounds stay fixed, contents shift.

**Delete row N**
- Clear all stitches in row N.
- Shift every row above (N+1, N+2, …) down by one, carrying no-stitch and background
  fills wherever any stitch was defined in the source row.
- The topmost row becomes empty after the shift.

**Insert row above / below N**
- Shift the affected rows up by one to make space; the row that gets pushed past the
  top edge is lost.
- The newly inserted row is blank.
- "Above" and "below" differ only in whether row N itself moves up or stays put.

**Columns**: mirror the same logic horizontally (delete / insert left / insert right).

**Right-click menu surfaces**
- On a **row number** → Delete row, Insert row above, Insert row below.
- On a **column number** → Delete column, Insert column left, Insert column right.
- On a **cell** (ambiguous which axis the user wants) → all six options.

**Notes**
- Single undo entry per operation.
- If the row/column being pushed off the edge contains defined stitches, warn or
  confirm before committing — silent loss of work would be nasty.

### 19. Per-row stitch counter + inc/dec balance check

Two related capabilities that share the same plumbing.

**Phase 1 — visible row count.** A narrow column between the chart and the right panel
showing the active stitch count per row (cells minus no-stitch). Useful as a sanity
check ("did I pad this row right?") and the obvious place to surface row deltas later.
Hide the column above ~100 rows to keep the workbench uncluttered, with a manual toggle.

**Phase 2 — stitch metadata.** Each stitch type declares how many stitches it consumes
from the previous row and produces for the next. Built-ins are easy to populate:

| Stitch        | consumes | produces | delta |
|---------------|---------:|---------:|------:|
| knit / purl   |        1 |        1 |     0 |
| K2tog / SSK   |        2 |        1 |    −1 |
| K3tog / S2KP  |        3 |        1 |    −2 |
| YO            |        0 |        1 |    +1 |
| M1L / M1R     |        0 |        1 |    +1 |
| left/right cross | n cells | n cells | 0 |
| no-stitch     |        0 |        0 |     0 |

User stitches need a small fieldset in the stitch editor capturing the same info
(default: "1 in, 1 out — same"). Bump the gallery file format to carry it; existing user
stitches without metadata default to "same".

**Phase 3 — balance check.** When row *N* contains any inc or dec stitches, calculate
the *expected* count for row *N+1* (sum of `produces` for row N's cells), then compare
to row *N+1*'s actual stitch count. Flag mismatches visually in the row-count column
(red dot or asterisk next to the row number) and surface a tooltip explaining the
discrepancy. Catches the common shaping mistake where a knitter adds a K2tog but forgets
to remove a cell from the following row.

### 20. Garment outline generator (jumper, beanie, …)

A "start me off" feature that produces blank but correctly-shaped chart panels for a
small set of canonical garments, sized to the user's body and gauge. The user then
fills in stitches/cables/colourwork on top of the generated outline. Two goals:
showcase what the app can do for full garments, and stress-test the workbench on
genuinely large grids.

**Inputs (per garment)**
- Body measurements relevant to the garment (chest, length, sleeve length, upper-arm
  circumference, neck, head circumference, etc.).
- Gauge: stitches per swatch + rows per swatch (shares plumbing with the stitch-count
  calculator, #18).
- Fit / ease preference: e.g. **Hugging** (negative or zero ease), **Standard**,
  **Loose** (extra positive ease). Translates to a per-measurement allowance.

**Outputs**
- One generated chart per panel — for a basic crew-neck jumper that's three charts:
  **Front**, **Back**, **Sleeve** (×2 implied). Each chart is correctly sized in rows
  and columns and pre-populated with no-stitch cells outside the panel outline plus
  plain stockinette inside, with shaping increases/decreases at the right rows for
  underarm taper, sleeve cap, neckline, etc.
- Outline is a starting point — the user can then drop cables, colourwork, texture
  stitches into the body of the panel without having to work out the silhouette.

**Initial templates to ship**
- **Basic crew-neck jumper** — front / back / sleeve. Knit-flat construction is the
  simplest first cut (top-down or bottom-up in the round are alternatives we can add
  later if asked).
- **Beanie** — a small, satisfying example that exercises crown decreases.

Acknowledge upfront in the UI that there are many ways to construct a jumper (flat
vs in-the-round, top-down vs bottom-up, set-in vs raglan vs drop-shoulder); we are
not trying to ship a full pattern library, just a couple of well-chosen starters.

**Notes**
- Need an "ease table" per garment per fit option that the generator reads from —
  keep it data-driven so new garments are just a new entry, not new code.
- Round stitch and row counts to whole numbers; show the rounding error so the user
  can see how far off-target the gauge maths landed.
- Save last-used measurements per garment in IndexedDB so a user revisiting doesn't
  retype everything.
- Good follow-up to #18 (stitch-count calculator) — same gauge inputs, same unit
  handling, same rounding philosophy. Worth designing them as a single coherent
  "sizing" surface rather than two unrelated dialogs.

### 21. Recipient profiles ("People") + body-vs-garment measurement model

Save the people you knit for so measurements aren't re-entered on every project, and
draw a clear line between **body measurements** (what the wearer actually is) and
**garment measurements** (what the finished piece needs to be). Pairs with #20 —
the outline generator's inputs come from a Person + a per-garment style choice.

**People**
- Create / edit / delete recipients with a name and a set of body measurements.
- Persist in IndexedDB. Future patterns can pick a saved person and pre-fill.
- When opening a saved person on a new project: show the stored measurements with
  an obvious "Looks right? Update if anything's changed." nudge — measurements drift
  (kids especially), and stale numbers produce bad garments quietly.
- Optional: "last measured" date per measurement so the user can see how stale the
  data is.

**Body measurements vs garment measurements**
Body measurements describe the wearer. Garment measurements describe the finished
piece. The generator needs both — body + a styling choice → garment.

- *Body, anchored*: chest/bust, neck circumference, shoulder width, upper-arm
  circumference, wrist circumference, shoulder-to-wrist, underarm-to-wrist, nape-to-
  waist, waist-to-hip, head circumference, etc. These are facts about the person.
- *Garment, derived from body + styling choices*: finished chest (= body chest +
  ease), finished sleeve length (depends on whether the wearer wants short / above-
  elbow / standard / over-the-hands / turn-up cuff), finished body length, finished
  neckline depth, etc.

**Sleeve length is the canonical example** — one body measurement (shoulder-to-wrist
or underarm-to-wrist) maps to many possible garment sleeve lengths:

- **Cap** (just covers the shoulder).
- **Short** (above the elbow — knitted tee).
- **Three-quarter** (mid-forearm).
- **Standard** (to the wrist bone).
- **Over-the-hands** (extra length, often with a thumbhole).
- **Turn-up cuff** (standard length plus the depth of the cuff fold, ×2).

Same idea for body length (cropped / standard / tunic), neckline depth (high crew /
standard crew / scoop), etc.

**UX implications**
- The Person dialog captures only *body* numbers — never garment-fit choices.
- The garment generator dialog (#20) captures *styling* choices (sleeve style, body
  length, neckline depth) and combines them with the selected Person + ease setting
  to produce the finished garment measurements before the gauge maths.
- Show the user the *derived* garment measurements before generating, so they can
  sanity-check before a 1000-row chart appears.

**Notes**
- Don't conflate the existing "Pattern is for…" free-text field (if any) with this —
  Person should be a structured record, not a string.
- Privacy: this is just IndexedDB on the user's machine, but treat names + body
  measurements with the same care as any other personal data — don't ship them off-
  device, don't include them in pattern exports unless the user explicitly opts in.
- A pattern saved with a Person attached should reference them by id, not embed a
  copy of the measurements — so if the wearer's chest changes and the user re-runs
  the generator, they get an updated panel.

---

## Notes

- The active todo list inside the chat session mirrors this file roughly. Treat this
  file as the source of truth between sessions.
- "Verify SW rollout from knitwit-v58 → knitwittage" is no longer relevant — we've
  shipped many cache versions past that, and the active code path doesn't reference
  the old name anywhere.
