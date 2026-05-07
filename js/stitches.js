// === Stitch Registry ===
// Central, data-driven definition of every stitch type. Built-ins are hardcoded
// below; user-defined stitches (added via the Add Stitch Type editor — not yet
// built) will be loaded from IndexedDB and merged in at startup.
//
// Each entry owns:
//   - identity      (id, label, sublabel, title)
//   - behaviour     (kind: 'simple' | 'cross' | 'erase')
//   - instructions  (code for the row text, printSymbol for the chart table)
//   - visuals       (drawIcon for the 40x40 palette tile, drawCell for grid overlay)
//   - ordering      (order — lower first, reserved 0–999 for built-ins)
//
// 'cross' entries have no drawCell because cross cells are rendered by
// drawCrossingOverlay in cables.js (cluster-aware). 'erase' has no drawCell
// because it's a tool, never placed on the grid.

const STITCH_COLORS = {
    bg: '#fbf7ec',
    purlBg: '#fbf7ec',
    yarn: '#2a211a',
    yarnDark: '#2a211a',
    yarnFront: '#2a211a',
    yarnBack: '#c9bca0',
    accent: '#2a211a',
    accentSoft: '#2a211a',
    ink: 'rgba(42, 33, 26, 0.4)',
    paperShade: 'rgba(251, 247, 236, 0)',
    purlMark: '#2a211a',
};

// ---------- Palette tile icon drawing (40x40) ----------

function drawKnitTileIcon(ctx, s) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = STITCH_COLORS.yarn;
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.moveTo(s*0.15, s*0.15);
    ctx.lineTo(s*0.5,  s*0.7);
    ctx.lineTo(s*0.85, s*0.15);
    ctx.stroke();
    ctx.strokeStyle = STITCH_COLORS.yarnDark;
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(s*0.35, s*0.88);
    ctx.lineTo(s*0.65, s*0.88);
    ctx.stroke();
}

function drawPurlTileIcon(ctx, s) {
    ctx.strokeStyle = STITCH_COLORS.purlMark;
    ctx.lineWidth = s * 0.14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s*0.2, s*0.5);
    ctx.lineTo(s*0.8, s*0.5);
    ctx.stroke();
}

function drawCrossTileIcon(ctx, s, dir) {
    const lw = s * 0.14;
    ctx.lineCap = 'round';
    const frontFrom = dir === 'left' ? 0.25 : 0.75;
    const frontTo   = dir === 'left' ? 0.75 : 0.25;
    const backFrom  = dir === 'left' ? 0.75 : 0.25;
    const backTo    = dir === 'left' ? 0.25 : 0.75;

    ctx.strokeStyle = STITCH_COLORS.yarnBack;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(s * backFrom, 0);
    ctx.bezierCurveTo(s * backFrom, s*0.6, s * backTo, s*0.4, s * backTo, s);
    ctx.stroke();
    ctx.strokeStyle = STITCH_COLORS.bg;
    ctx.lineWidth = lw + 4;
    ctx.beginPath();
    ctx.moveTo(s * frontFrom, 0);
    ctx.bezierCurveTo(s * frontFrom, s*0.6, s * frontTo, s*0.4, s * frontTo, s);
    ctx.stroke();
    ctx.strokeStyle = STITCH_COLORS.yarnFront;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(s * frontFrom, 0);
    ctx.bezierCurveTo(s * frontFrom, s*0.6, s * frontTo, s*0.4, s * frontTo, s);
    ctx.stroke();
}

function drawM1TileIcon(ctx, s, dir) {
    ctx.lineCap = 'round';
    if (dir === 'right') {
        ctx.strokeStyle = STITCH_COLORS.yarn;
        ctx.lineWidth = s * 0.14;
        ctx.beginPath();
        ctx.moveTo(s*0.15, s*0.7);
        ctx.lineTo(s*0.55, s*0.2);
        ctx.stroke();
        ctx.strokeStyle = STITCH_COLORS.yarnFront;
        ctx.lineWidth = s * 0.1;
        ctx.beginPath();
        ctx.moveTo(s*0.6,  s*0.7);
        ctx.lineTo(s*0.9,  s*0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s*0.75, s*0.57);
        ctx.lineTo(s*0.75, s*0.83);
        ctx.stroke();
    } else {
        ctx.strokeStyle = STITCH_COLORS.yarnFront;
        ctx.lineWidth = s * 0.1;
        ctx.beginPath();
        ctx.moveTo(s*0.1,  s*0.7);
        ctx.lineTo(s*0.4,  s*0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s*0.25, s*0.57);
        ctx.lineTo(s*0.25, s*0.83);
        ctx.stroke();
        ctx.strokeStyle = STITCH_COLORS.yarn;
        ctx.lineWidth = s * 0.14;
        ctx.beginPath();
        ctx.moveTo(s*0.45, s*0.2);
        ctx.lineTo(s*0.85, s*0.7);
        ctx.stroke();
    }
}

function drawKLeanTileIcon(ctx, s, dir) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = STITCH_COLORS.yarn;
    ctx.lineWidth = s * 0.14;
    if (dir === 'right') {
        ctx.beginPath();
        ctx.moveTo(s*0.15, s*0.7);
        ctx.lineTo(s*0.55, s*0.2);
        ctx.stroke();
        ctx.strokeStyle = STITCH_COLORS.yarnFront;
        ctx.lineWidth = s * 0.1;
        ctx.beginPath();
        ctx.moveTo(s*0.6, s*0.75);
        ctx.lineTo(s*0.9, s*0.75);
        ctx.stroke();
    } else {
        ctx.strokeStyle = STITCH_COLORS.yarnFront;
        ctx.lineWidth = s * 0.1;
        ctx.beginPath();
        ctx.moveTo(s*0.1, s*0.75);
        ctx.lineTo(s*0.4, s*0.75);
        ctx.stroke();
        ctx.strokeStyle = STITCH_COLORS.yarn;
        ctx.lineWidth = s * 0.14;
        ctx.beginPath();
        ctx.moveTo(s*0.45, s*0.2);
        ctx.lineTo(s*0.85, s*0.7);
        ctx.stroke();
    }
}

function drawHoleTileIcon(ctx, s) {
    ctx.fillStyle = '#ede3cc';
    ctx.beginPath();
    ctx.arc(s*0.5, s*0.5, s*0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = STITCH_COLORS.yarn;
    ctx.lineWidth = s * 0.1;
    ctx.stroke();
}

function drawNoStitchTileIcon(ctx, s) {
    const pad = s * 0.15;
    ctx.fillStyle = '#c9bca0';
    ctx.fillRect(pad, pad, s - pad * 2, s - pad * 2);
    ctx.strokeStyle = '#5a4c3e';
    ctx.lineWidth = s * 0.08;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s*0.3, s*0.3);
    ctx.lineTo(s*0.7, s*0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s*0.7, s*0.3);
    ctx.lineTo(s*0.3, s*0.7);
    ctx.stroke();
}

// ---------- Grid cell overlay drawing (per-cell, arbitrary size) ----------

function drawKnitCell(ctx, x, y, w, h) {
    const lw = Math.max(1.5, w * 0.14);
    ctx.lineCap = 'round';
    ctx.strokeStyle = STITCH_COLORS.yarn;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x + w*0.15, y + h*0.15);
    ctx.lineTo(x + w*0.5,  y + h*0.7);
    ctx.lineTo(x + w*0.85, y + h*0.15);
    ctx.stroke();
    ctx.strokeStyle = STITCH_COLORS.yarnDark;
    ctx.lineWidth = lw * 0.7;
    ctx.beginPath();
    ctx.moveTo(x + w*0.35, y + h*0.88);
    ctx.lineTo(x + w*0.65, y + h*0.88);
    ctx.stroke();
}

function drawPurlCell(ctx, x, y, w, h) {
    ctx.strokeStyle = STITCH_COLORS.purlMark;
    ctx.lineWidth = Math.max(2, w * 0.13);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + w*0.2, y + h*0.5);
    ctx.lineTo(x + w*0.8, y + h*0.5);
    ctx.stroke();
}

function drawNoStitchCell(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(201, 188, 160, 0.7)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(90, 76, 62, 0.5)';
    ctx.lineWidth = Math.max(1, w * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + w*0.25, y + h*0.25);
    ctx.lineTo(x + w*0.75, y + h*0.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w*0.75, y + h*0.25);
    ctx.lineTo(x + w*0.25, y + h*0.75);
    ctx.stroke();
}

function drawKLeanCell(ctx, x, y, w, h, dir) {
    const lw = Math.max(1.5, w * 0.12);
    ctx.lineCap = 'round';
    if (dir === 'right') {
        ctx.strokeStyle = STITCH_COLORS.yarn;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x + w*0.1, y + h*0.75);
        ctx.lineTo(x + w*0.5, y + h*0.2);
        ctx.stroke();
        ctx.strokeStyle = STITCH_COLORS.accent;
        ctx.lineWidth = Math.max(1, w * 0.08);
        ctx.beginPath();
        ctx.moveTo(x + w*0.58, y + h*0.8);
        ctx.lineTo(x + w*0.88, y + h*0.8);
        ctx.stroke();
    } else {
        ctx.strokeStyle = STITCH_COLORS.accent;
        ctx.lineWidth = Math.max(1, w * 0.08);
        ctx.beginPath();
        ctx.moveTo(x + w*0.12, y + h*0.8);
        ctx.lineTo(x + w*0.42, y + h*0.8);
        ctx.stroke();
        ctx.strokeStyle = STITCH_COLORS.yarn;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x + w*0.5, y + h*0.2);
        ctx.lineTo(x + w*0.9, y + h*0.75);
        ctx.stroke();
    }
}

function drawM1Cell(ctx, x, y, w, h, dir) {
    const lw = Math.max(1.5, w * 0.12);
    ctx.lineCap = 'round';
    if (dir === 'right') {
        ctx.strokeStyle = STITCH_COLORS.yarn;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x + w*0.1, y + h*0.75);
        ctx.lineTo(x + w*0.5, y + h*0.2);
        ctx.stroke();
        ctx.strokeStyle = STITCH_COLORS.accent;
        ctx.lineWidth = Math.max(1, w * 0.08);
        ctx.beginPath();
        ctx.moveTo(x + w*0.58, y + h*0.75);
        ctx.lineTo(x + w*0.88, y + h*0.75);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + w*0.73, y + h*0.62);
        ctx.lineTo(x + w*0.73, y + h*0.88);
        ctx.stroke();
    } else {
        ctx.strokeStyle = STITCH_COLORS.accent;
        ctx.lineWidth = Math.max(1, w * 0.08);
        ctx.beginPath();
        ctx.moveTo(x + w*0.12, y + h*0.75);
        ctx.lineTo(x + w*0.42, y + h*0.75);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + w*0.27, y + h*0.62);
        ctx.lineTo(x + w*0.27, y + h*0.88);
        ctx.stroke();
        ctx.strokeStyle = STITCH_COLORS.yarn;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(x + w*0.5, y + h*0.2);
        ctx.lineTo(x + w*0.9, y + h*0.75);
        ctx.stroke();
    }
}

function drawHoleCell(ctx, x, y, w, h) {
    ctx.fillStyle = '#ede3cc';
    ctx.beginPath();
    ctx.arc(x + w*0.5, y + h*0.5, Math.min(w, h) * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = STITCH_COLORS.accentSoft;
    ctx.lineWidth = Math.max(1.5, w * 0.09);
    ctx.beginPath();
    ctx.arc(x + w*0.5, y + h*0.5, Math.min(w, h) * 0.35, 0, Math.PI * 2);
    ctx.stroke();
}

// ---------- Registry ----------

const BUILTIN_STITCHES = [
    {
        id: 'knit', label: 'K', sublabel: 'knit',
        title: 'Knit stitch (K)',
        kind: 'simple', code: 'K', printSymbol: 'V',
        drawIcon: (ctx, s) => drawKnitTileIcon(ctx, s),
        drawCell: drawKnitCell,
        order: 10,
    },
    {
        id: 'purl', label: 'P', sublabel: 'purl',
        title: 'Purl stitch (P)',
        kind: 'simple', code: 'P', printSymbol: '\u2013',
        drawIcon: (ctx, s) => drawPurlTileIcon(ctx, s),
        drawCell: drawPurlCell,
        order: 20,
    },
    {
        id: 'left-cross', label: 'CF', sublabel: '(TwL)',
        title: 'Cable Front / Twist Left — click and drag across a row of 2–8 cells to apply. All-knit crossings become cables (CnF), mixed knit/purl become twists (TwnL).',
        kind: 'cross', dir: 'left',
        drawIcon: (ctx, s) => drawCrossTileIcon(ctx, s, 'left'),
        drawCell: null, // rendered by drawCrossingOverlay in cables.js
        order: 30,
    },
    {
        id: 'right-cross', label: 'CB', sublabel: '(TwR)',
        title: 'Cable Back / Twist Right — click and drag across a row of 2–8 cells to apply. All-knit crossings become cables (CnB), mixed knit/purl become twists (TwnR).',
        kind: 'cross', dir: 'right',
        drawIcon: (ctx, s) => drawCrossTileIcon(ctx, s, 'right'),
        drawCell: null,
        order: 40,
    },
    {
        id: 'k-right', label: 'K2tog', sublabel: 'dec 1',
        title: 'Knit 2 together — right-leaning decrease',
        kind: 'simple', code: 'K2tog', printSymbol: '/-',
        drawIcon: (ctx, s) => drawKLeanTileIcon(ctx, s, 'right'),
        drawCell: (ctx, x, y, w, h) => drawKLeanCell(ctx, x, y, w, h, 'right'),
        order: 50,
    },
    {
        id: 'k-left', label: 'SSK', sublabel: 'dec 1',
        title: 'Slip slip knit — left-leaning decrease',
        kind: 'simple', code: 'SSK', printSymbol: '-\\',
        drawIcon: (ctx, s) => drawKLeanTileIcon(ctx, s, 'left'),
        drawCell: (ctx, x, y, w, h) => drawKLeanCell(ctx, x, y, w, h, 'left'),
        order: 60,
    },
    {
        id: 'm1r', label: 'M1R', sublabel: 'inc 1',
        title: 'Make 1 Right — invisible right-leaning increase',
        kind: 'simple', code: 'M1R', printSymbol: '/+',
        drawIcon: (ctx, s) => drawM1TileIcon(ctx, s, 'right'),
        drawCell: (ctx, x, y, w, h) => drawM1Cell(ctx, x, y, w, h, 'right'),
        order: 70,
    },
    {
        id: 'm1l', label: 'M1L', sublabel: 'inc 1',
        title: 'Make 1 Left — invisible left-leaning increase',
        kind: 'simple', code: 'M1L', printSymbol: '+\\',
        drawIcon: (ctx, s) => drawM1TileIcon(ctx, s, 'left'),
        drawCell: (ctx, x, y, w, h) => drawM1Cell(ctx, x, y, w, h, 'left'),
        order: 80,
    },
    {
        id: 'hole', label: 'YO', sublabel: 'hole',
        title: 'Yarn over (lace hole)',
        kind: 'simple', code: 'YO', printSymbol: '\u25CB',
        drawIcon: (ctx, s) => drawHoleTileIcon(ctx, s),
        drawCell: drawHoleCell,
        order: 90,
    },
    {
        id: 'no-stitch', label: 'No St', sublabel: null,
        title: "No stitch — click cells to mark them as not knitted (rendered as background). Tick 'All BG' below the tile to fill every empty cell at once.",
        kind: 'simple', code: null, printSymbol: null,
        drawIcon: (ctx, s) => drawNoStitchTileIcon(ctx, s),
        drawCell: drawNoStitchCell,
        order: 100,
        extraTileMarkup: true, // signals the palette renderer to add the "Select Cells" checkbox
    },
    {
        // No sublabel — Erase reads as a tool, not a stitch type. The × icon
        // and the label "Erase" together are clear, and skipping the sublabel
        // gives the tile a visually lighter footprint than the stitch tiles.
        id: 'stitch-erase', label: 'Erase', sublabel: null,
        title: 'Erase stitch type',
        kind: 'erase',
        // Uses a CSS-styled glyph (.stitch-erase-icon) instead of a canvas icon;
        // see buildStitchTile for the markup branch.
        useGlyph: '\u2715',
        drawIcon: null,
        drawCell: null,
        order: 999,
        extraTileClass: 'stitch-tile-erase',
    },
];

// Palette for the Add Stitch Type drawing canvas. Kept intentionally small and
// on-theme: dark ink + three warm greys, matching the existing icon palette so
// user-designed icons look at home next to the built-ins.
const STITCH_DESIGN_COLORS = [
    { hex: '#2a211a', name: 'ink' },
    { hex: '#5a4c3e', name: 'dark grey' },
    { hex: '#8a7a62', name: 'mid grey' },
    { hex: '#c9bca0', name: 'light grey' },
];

// Known knitting codes and their default detailed instructions. Typing a
// matching code in the editor pre-fills the detailed-instructions textarea;
// the user is free to edit or replace the text before saving.
const STITCH_CODE_LIBRARY = {
    'K':     'Knit 1: insert right needle front-to-back through next stitch, wrap yarn, pull through.',
    'P':     'Purl 1: with yarn in front, insert right needle back-to-front through next stitch, wrap yarn, pull through.',
    'K2tog': 'Knit 2 together: insert right needle through 2 stitches at once and knit them together — right-leaning decrease.',
    'SSK':   'Slip, slip, knit: slip 2 stitches knitwise one at a time, insert left needle through both fronts and knit them together — left-leaning decrease.',
    'P2tog': 'Purl 2 together: insert right needle purlwise through 2 stitches and purl them together — right-leaning decrease on the WS.',
    'SSP':   'Slip, slip, purl: slip 2 stitches knitwise one at a time, return to left needle and purl them together through the back — left-leaning decrease on the WS.',
    'M1R':   'Make 1 right: slip left needle under the horizontal bar between the last stitch and the next, from back to front. Knit into the front leg.',
    'M1L':   'Make 1 left: slip left needle under the horizontal bar between the last stitch and the next, from front to back. Knit into the back leg.',
    'YO':    'Yarn over: bring yarn over the right needle from front to back before the next stitch — creates a decorative hole.',
    'S2KP':  'Slip 2 knitwise (as if to K2tog), knit 1, pass the 2 slipped stitches over — centred double decrease, balances 2 YOs.',
    'SP2P':  'Slip 1 purlwise, purl 2 together, pass the slipped stitch over — WS centred double decrease.',
    'KFB':   'Knit into front and back of the same stitch — one-to-two increase.',
    'K1tbl': 'Knit 1 through the back loop — produces a twisted stitch.',
    'P1tbl': 'Purl 1 through the back loop — produces a twisted purl.',
    'SL':    'Slip 1 purlwise, with yarn held at the back on RS (front on WS).',
    'C4B':   'Cable 4 back: slip 2 stitches to a cable needle and hold at the back, K2, then K2 from the cable needle. Produces a right-leaning cable cross.',
    'C4F':   'Cable 4 front: slip 2 stitches to a cable needle and hold at the front, K2, then K2 from the cable needle. Produces a left-leaning cable cross.',
    'C6B':   'Cable 6 back: slip 3 stitches to a cable needle and hold at the back, K3, then K3 from the cable needle.',
    'C6F':   'Cable 6 front: slip 3 stitches to a cable needle and hold at the front, K3, then K3 from the cable needle.',
    'T3B':   'Twist 3 back: slip 1 purl stitch to a cable needle and hold at the back, K2, then P1 from the cable needle.',
    'T3F':   'Twist 3 front: slip 2 knit stitches to a cable needle and hold at the front, P1, then K2 from the cable needle.',
};

// True when a user-drawn shape array contains nothing visible — either no
// shapes, or only erase strokes (which paint in the paper colour and so
// leave no visible mark). Drives the code-as-text fallback below.
function isEffectivelyEmpty(shapes) {
    if (!shapes || !shapes.length) return true;
    return shapes.every(s => s && s.stroke === STITCH_COLORS.bg);
}

// Pick a two-line wrap split for codes that can't fit on a single line.
// Whitespace first ("K2tog tbl" → "K2tog" / "tbl"), then a digit→letter
// boundary ("K2tog" → "K2" / "tog"), then the midpoint as a last resort.
// Never truncates — losing a character changes the meaning (SSK ≠ SSP).
function splitCodeForWrap(code) {
    const ws = code.indexOf(' ');
    if (ws > 0 && ws < code.length - 1) return [code.slice(0, ws), code.slice(ws + 1)];
    const m = /\d[a-zA-Z]/.exec(code);
    if (m && m.index > 0 && m.index + 1 < code.length) {
        return [code.slice(0, m.index + 1), code.slice(m.index + 1)];
    }
    const mid = Math.ceil(code.length / 2);
    return [code.slice(0, mid), code.slice(mid)];
}

// Auto-fit fallback for stitches with no drawn icon: render the code as
// text, sized to fit the cell. Shrinks until the code fits on a single
// line inside ~85% of the cell width; if it can't fit at the minimum
// legible size, wraps to two lines via splitCodeForWrap. Never truncates.
function drawCodeAsText(ctx, code, x, y, w, h) {
    if (!code) return;
    const cellMin = Math.min(w, h);
    const targetW = w * 0.85;
    const minSize = Math.max(7, cellMin * 0.18);
    const maxSize = Math.max(minSize + 1, cellMin * 0.7);
    const family = `"Source Serif 4", Georgia, serif`;

    ctx.save();
    ctx.fillStyle = STITCH_COLORS.yarn;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const widthAt = (size, text) => {
        ctx.font = `600 ${size}px ${family}`;
        return ctx.measureText(text).width;
    };

    // Try a single line — shrink from max until it fits or we hit the floor.
    let size = maxSize;
    while (size > minSize && widthAt(size, code) > targetW) size -= 0.5;
    if (widthAt(size, code) <= targetW) {
        ctx.font = `600 ${size}px ${family}`;
        ctx.fillText(code, x + w / 2, y + h / 2);
        ctx.restore();
        return;
    }

    // Single line still overflows at minSize — wrap to two lines.
    const [a, b] = splitCodeForWrap(code);
    let lineSize = maxSize * 0.65;
    while (lineSize > minSize) {
        if (widthAt(lineSize, a) <= targetW && widthAt(lineSize, b) <= targetW) break;
        lineSize -= 0.5;
    }
    ctx.font = `600 ${lineSize}px ${family}`;
    const cy = y + h / 2;
    const lineOffset = lineSize * 0.55;
    ctx.fillText(a, x + w / 2, cy - lineOffset);
    ctx.fillText(b, x + w / 2, cy + lineOffset);
    ctx.restore();
}

// Render a user-defined stitch by walking its `shapes` array. Coordinates are
// normalised 0..100; the renderer maps them to the target (x,y,w,h) rect and
// preserves aspect ratio (centres the drawing if the target isn't square).
// Stroke width is stored as a percent of the drawing square and scaled here
// to the target size so thin strokes don't vanish on tile-sized canvases.
function drawUserStitchShapes(ctx, shapes, x, y, w, h) {
    if (!shapes || !shapes.length) return;
    const scale = Math.min(w, h) / 100;
    const offX = x + (w - 100 * scale) / 2;
    const offY = y + (h - 100 * scale) / 2;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const shape of shapes) {
        const stroke = shape.stroke || STITCH_COLORS.yarn;
        const lw = Math.max(0.75, (shape.strokeWidth || 6) * scale * 0.5);

        if (shape.type === 'line') {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(offX + shape.x1 * scale, offY + shape.y1 * scale);
            ctx.lineTo(offX + shape.x2 * scale, offY + shape.y2 * scale);
            ctx.stroke();
        } else if (shape.type === 'curve') {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(offX + shape.x1 * scale, offY + shape.y1 * scale);
            ctx.quadraticCurveTo(
                offX + shape.cx * scale, offY + shape.cy * scale,
                offX + shape.x2 * scale, offY + shape.y2 * scale
            );
            ctx.stroke();
        } else if (shape.type === 'rect') {
            if (shape.fill) {
                ctx.fillStyle = shape.fill;
                ctx.fillRect(offX + shape.x * scale, offY + shape.y * scale, shape.w * scale, shape.h * scale);
            }
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lw;
            ctx.strokeRect(offX + shape.x * scale, offY + shape.y * scale, shape.w * scale, shape.h * scale);
        } else if (shape.type === 'ellipse') {
            ctx.beginPath();
            ctx.ellipse(
                offX + shape.cx * scale, offY + shape.cy * scale,
                Math.max(0.1, shape.rx * scale), Math.max(0.1, shape.ry * scale),
                0, 0, Math.PI * 2
            );
            if (shape.fill) {
                ctx.fillStyle = shape.fill;
                ctx.fill();
            }
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lw;
            ctx.stroke();
        } else if (shape.type === 'path' && shape.points && shape.points.length > 1) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(offX + shape.points[0].x * scale, offY + shape.points[0].y * scale);
            for (let i = 1; i < shape.points.length; i++) {
                ctx.lineTo(offX + shape.points[i].x * scale, offY + shape.points[i].y * scale);
            }
            ctx.stroke();
        } else if (shape.type === 'text' && shape.text) {
            // Natural size scales linearly with the cell. A tiny 2px floor
            // keeps the text from vanishing at extreme zoom-out — but no
            // higher: a 6px floor (the previous value) pushed text past the
            // cell boundary at small zoom levels, since the text grew while
            // the cell didn't.
            let fs = Math.max(2, (shape.fontSize || 30) * scale);
            ctx.fillStyle = stroke;
            ctx.font = `${fs}px "Source Serif 4", Georgia, serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';

            const lines = shape.text.split('\n');
            // Auto-shrink so the widest line fits within ~92% of the cell
            // width. The user positioned the text inside their drawing
            // canvas; clamping at render time keeps it inside its chart cell
            // at every zoom level too. Lines/paths/etc. don't need this
            // because they were drawn within the editor canvas bounds — text
            // can extend past those bounds since fillText draws relative to
            // an anchor, not a clipped box.
            const targetW = w * 0.92;
            let widest = 0;
            for (const line of lines) {
                if (!line) continue;
                const lw = ctx.measureText(line).width;
                if (lw > widest) widest = lw;
            }
            if (widest > targetW) {
                fs = fs * (targetW / widest);
                ctx.font = `${fs}px "Source Serif 4", Georgia, serif`;
            }

            // Multi-line text stacks around (shape.x, shape.y) using fs as
            // the line height (matches CSS line-height:1 in the live
            // overlay). textBaseline 'alphabetic' + the (asc - desc)/2 nudge
            // puts each line's optical centre on its slot centre, so a
            // cap-heavy line like "K" doesn't sink below where it sat in
            // the editor (em-box includes descender space that K doesn't use).
            const lineHeight = fs;
            const blockTopY = offY + shape.y * scale - (lines.length * lineHeight) / 2;
            for (let li = 0; li < lines.length; li++) {
                const line = lines[li];
                if (!line) continue;
                const m = ctx.measureText(line);
                const asc = m.actualBoundingBoxAscent || fs * 0.75;
                const desc = m.actualBoundingBoxDescent || fs * 0.25;
                const baselineY = blockTopY + li * lineHeight + lineHeight * 0.5 + (asc - desc) / 2;
                ctx.fillText(line, offX + shape.x * scale, baselineY);
            }
        }
    }
    ctx.restore();
}

// Wrap a stored user-stitch record (plain JSON) into a registry entry with
// the drawIcon/drawCell functions the palette and grid renderer expect.
function hydrateUserStitch(record) {
    const shapes = record.shapes || [];
    const multiCell = !!record.multiCell;
    const code = record.code || record.id;
    // Code-as-text fallback: when the user saved the stitch with no visible
    // shapes (or only erase strokes), render the code as auto-fit text in
    // place of the drawn icon. Same fallback applies to palette tile and
    // chart cell, so an iconless stitch is never invisible.
    const renderAt = (ctx, x, y, w, h) => {
        if (isEffectivelyEmpty(shapes)) {
            drawCodeAsText(ctx, code, x, y, w, h);
        } else {
            drawUserStitchShapes(ctx, shapes, x, y, w, h);
        }
    };
    return {
        id: record.id,
        label: record.label || record.id,
        sublabel: record.sublabel || null,
        title: record.title || record.detailedInstructions || `Custom stitch: ${record.id}`,
        // Multi-cell user stitches are placed via click-and-drag (like the
        // built-in cable crosses) and rendered with one full-opacity icon at
        // the lead cell + faint echoes elsewhere.
        kind: multiCell ? 'user-multi' : 'simple',
        multiCell,
        code,
        printSymbol: code, // printed in the chart table
        printSymbolFontPt: (code && code.length > 1) ? 6 : undefined,
        detailedInstructions: record.detailedInstructions || '',
        shapes,
        source: 'user',
        order: record.order ?? 500,
        drawIcon: (ctx, s) => renderAt(ctx, 0, 0, s, s),
        drawCell: (ctx, x, y, w, h) => renderAt(ctx, x, y, w, h),
        _record: record,
    };
}

const StitchRegistry = {
    _user: [],
    getAll() {
        return [...BUILTIN_STITCHES, ...this._user].sort((a, b) => a.order - b.order);
    },
    get(id) {
        if (!id) return null;
        return BUILTIN_STITCHES.find(s => s.id === id)
            || this._user.find(s => s.id === id)
            || null;
    },
    isKind(id, kind) { return this.get(id)?.kind === kind; },
    isSimple(id)  { return this.isKind(id, 'simple'); },
    isCross(id)   { return this.isKind(id, 'cross'); },
    isErase(id)   { return id === 'stitch-erase'; },
    // User-defined stitch placed via click+drag across multiple cells.
    isUserMulti(id) { return this.isKind(id, 'user-multi'); },
    // Anything that drag-places (cross + user-multi) needs the cable-style
    // mousedown→mouseup path, not the simple paint path.
    isDragPlaced(id) { return this.isCross(id) || this.isUserMulti(id); },
    // Single-cell paintable: simple stitches + the eraser. Multi-cell types
    // are excluded so they don't paint per-cell on click.
    isPaintable(id) { return this.isSimple(id) || this.isErase(id); },
    // Notation code used when generating knitting instructions.
    codeFor(id) { return this.get(id)?.code ?? null; },
    // Replace the in-memory user list; called after IndexedDB load or edit.
    // Accepts raw DB records OR already-hydrated entries.
    setUserStitches(list) {
        this._user = (list || []).map(item =>
            (item && typeof item.drawIcon === 'function') ? item : hydrateUserStitch(item)
        );
    },
    // Add a single user stitch to the in-memory registry (replaces existing id).
    upsertUserStitch(record) {
        const hydrated = hydrateUserStitch(record);
        const idx = this._user.findIndex(s => s.id === hydrated.id);
        if (idx >= 0) this._user[idx] = hydrated;
        else this._user.push(hydrated);
    },
    removeUserStitch(id) {
        this._user = this._user.filter(s => s.id !== id);
    },
    hasId(id) { return !!this.get(id); },
};

// ---------- IndexedDB persistence (plumbing for the upcoming editor) ----------
// Survives app updates and reloads — PWA asset cache is a separate store and
// won't touch IndexedDB. No user-visible effect yet; the list is always empty
// until the editor ships.

const STITCH_DB_NAME = 'knitwork';
const STITCH_DB_VERSION = 1;
const STITCH_STORE = 'user_stitches';

function openStitchDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(STITCH_DB_NAME, STITCH_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STITCH_STORE)) {
                db.createObjectStore(STITCH_STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function loadUserStitchesFromDB() {
    try {
        const db = await openStitchDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STITCH_STORE, 'readonly');
            const store = tx.objectStore(STITCH_STORE);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch (err) {
        console.warn('user stitches unavailable:', err);
        return [];
    }
}

async function saveUserStitchToDB(record) {
    const db = await openStitchDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STITCH_STORE, 'readwrite');
        tx.objectStore(STITCH_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function deleteUserStitchFromDB(id) {
    const db = await openStitchDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STITCH_STORE, 'readwrite');
        tx.objectStore(STITCH_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Load on startup, then dispatch an event so the palette can re-render if
// anything came back. Runs in parallel with DOM load; the palette renders
// built-ins immediately and re-renders when this resolves.
document.addEventListener('DOMContentLoaded', async () => {
    const list = await loadUserStitchesFromDB();
    if (list.length > 0) {
        StitchRegistry.setUserStitches(list);
        document.dispatchEvent(new CustomEvent('stitch-registry-updated'));
    }
});
