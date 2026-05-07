// === Print ===
const PRINT_SYMBOLS = ['X', 'O', '/', '\\', '+', '-', '*', '#', '~', '=', '%', '@', '&', '?', '^'];

// A4 portrait usable area is 210 - 2×10mm margins = 190mm wide. The row-header
// column needs ~12mm to fit three-digit row numbers ("100◀"). That leaves
// ~174mm for chart cells; we then trim a couple of mm so the panel never sits
// flush with the page edge — browsers will otherwise push a panel that's
// exactly page-width onto a new page, leaving page 1 blank.
const PRINT_PAGE_DATA_WIDTH_MM = 174;
const PRINT_PAGE_DATA_HEIGHT_MM = 240;
const PRINT_ROW_HEADER_MM = 12;
const PRINT_CELL_MM_MIN = 4;
const PRINT_CELL_MM_MAX = 7;
// Pixel size used when rasterising user-stitch icons to <img> data URLs.
// A4 at 300 DPI gives ~11.8 px/mm, but knit-chart icons are simple shapes —
// 12 px/mm is plenty without bloating the document.
const PRINT_ICON_PX_PER_MM = 12;

// Cache rasterised user-stitch icons across one print run keyed by
// `${id}:${widthCells}` so multi-cell renders aren't redone per cluster.
const _printIconCache = new Map();

function preparePrint() {
    const pattern = getPatternRegion();
    if (!pattern) {
        showToast('Nothing to print — add some stitches or paint cells first!');
        return;
    }

    const patRows = pattern.length;
    const patCols = pattern[0].length;
    const mode = state.knittingMode;
    const isFlat = mode === 'flat';

    const stitchRegion = (typeof getStitchRegion === 'function')
        ? getStitchRegion(patRows, patCols)
        : null;

    // Build color-to-symbol map
    const colorsUsed = [];
    for (let r = 0; r < patRows; r++) {
        for (let c = 0; c < patCols; c++) {
            if (pattern[r][c] && !colorsUsed.includes(pattern[r][c])) {
                colorsUsed.push(pattern[r][c]);
            }
        }
    }
    const hasColors = colorsUsed.length > 0;
    const colorSymbolMap = {};
    colorsUsed.forEach((color, i) => {
        colorSymbolMap[color] = PRINT_SYMBOLS[i % PRINT_SYMBOLS.length];
    });

    // Print info header
    const modeLabel = isFlat ? 'Flat' : 'In the round';
    document.getElementById('print-info').textContent =
        `${patCols} stitches wide × ${patRows} rows tall — ${modeLabel}` +
        (hasColors ? ` — ${colorsUsed.length} colour(s)` : '');

    // Read user prefs
    const useIcons = !!document.getElementById('print-icons-toggle')?.checked;
    _printIconCache.clear();

    // Auto-fit cell size: larger when the chart is narrow (fits in one panel),
    // smaller when wide. Floored at 4mm so the print stays legible — past
    // that, we split horizontally instead of shrinking further.
    const cellMm = Math.max(
        PRINT_CELL_MM_MIN,
        Math.min(PRINT_CELL_MM_MAX, PRINT_PAGE_DATA_WIDTH_MM / patCols)
    );
    const maxColsPerPanel = Math.max(1, Math.floor(PRINT_PAGE_DATA_WIDTH_MM / cellMm));
    const maxRowsPerPanel = Math.max(1, Math.floor(PRINT_PAGE_DATA_HEIGHT_MM / cellMm));

    // Build row + column chunks. Row chunks split rows into page-height-sized
    // bands; col chunks split columns into page-width-sized bands and snap
    // boundaries so that no cluster (cable or user-multi) gets cut in half.
    const rowChunks = makeRowChunks(patRows, maxRowsPerPanel);
    const colChunks = makeColChunks(patCols, maxColsPerPanel, stitchRegion);

    // Inject the dynamic per-cell sizing as a single <style> rule so we don't
    // pay a 30-char inline-style tax on every td. For a 150×150 chart that's
    // ~660KB of style attributes — enough to corrupt some PDF print engines.
    injectPrintCellStyle(cellMm);

    // Render panels
    const wrapper = document.getElementById('print-grid-wrapper');
    wrapper.innerHTML = '';
    const drawnClusters = new Set();
    const r1IsWS = (state.firstRow === 'WS');
    let panelIdx = 0;
    for (const rc of rowChunks) {
        for (const cc of colChunks) {
            const panel = document.createElement('div');
            panel.className = 'print-panel';
            if (panelIdx > 0) panel.classList.add('print-panel-break');

            // Single-panel charts don't need a label; multi-panel ones get
            // "Rows X–Y · Cols A–B" so the knitter can orient.
            if (rowChunks.length > 1 || colChunks.length > 1) {
                const label = document.createElement('div');
                label.className = 'print-panel-label';
                label.textContent = buildPanelLabel(rc, cc, patRows);
                panel.appendChild(label);
            }

            const table = buildPanelTable({
                pattern, stitchRegion, rowChunk: rc, colChunk: cc,
                cellMm, isFlat, r1IsWS, drawnClusters,
                hasColors, colorSymbolMap, useIcons,
            });
            panel.appendChild(table);
            wrapper.appendChild(panel);
            panelIdx++;
        }
    }

    buildPrintLegend({
        stitchRegion, colorsUsed, colorSymbolMap, hasColors, useIcons, cellMm,
    });

    // Text instructions
    const printInstr = document.getElementById('print-instructions');
    if (printInstr && typeof formatInstructionsText === 'function') {
        const text = formatInstructionsText(pattern, mode);
        const pre = document.createElement('pre');
        pre.textContent = text;
        printInstr.innerHTML = '';
        printInstr.appendChild(pre);
    }

    setTimeout(() => window.print(), 100);
}

// ----- Chunking ----------------------------------------------------------

function makeRowChunks(patRows, maxRowsPerPanel) {
    const chunks = [];
    for (let start = 0; start < patRows; start += maxRowsPerPanel) {
        chunks.push({ start, end: Math.min(patRows, start + maxRowsPerPanel) });
    }
    return chunks;
}

// Split columns into bands of at most maxColsPerPanel, but pull the boundary
// LEFT if a cluster (cable / user-multi) would otherwise straddle the cut.
// A cluster split across pages would render half-an-icon on each side, which
// is worse than slightly uneven chunk widths.
function makeColChunks(patCols, maxColsPerPanel, stitchRegion) {
    if (patCols <= maxColsPerPanel) return [{ start: 0, end: patCols }];

    const chunks = [];
    let start = 0;
    while (start < patCols) {
        let end = Math.min(patCols, start + maxColsPerPanel);
        // Walk the boundary left while the cell at `end - 1` belongs to a
        // cluster that extends past `end`.
        if (stitchRegion && end < patCols) {
            outer: for (let attempt = 0; attempt < maxColsPerPanel; attempt++) {
                for (let r = 0; r < stitchRegion.length; r++) {
                    const row = stitchRegion[r];
                    if (!row) continue;
                    const cell = row[end - 1];
                    if (cell && typeof cell === 'object' && typeof cell.pos === 'number' && typeof cell.width === 'number') {
                        // pos = position within cluster (0-indexed). The cluster
                        // ends at column (end-1) - cell.pos + cell.width - 1.
                        const clusterEnd = (end - 1) - cell.pos + cell.width - 1;
                        if (clusterEnd >= end) {
                            end = (end - 1) - cell.pos; // start of cluster
                            if (end <= start) { end = start + maxColsPerPanel; break outer; }
                            continue outer;
                        }
                    }
                }
                break;
            }
        }
        if (end <= start) end = start + 1; // safety against zero-width chunks
        chunks.push({ start, end });
        start = end;
    }
    return chunks;
}

function buildPanelLabel(rc, cc, patRows) {
    // Knitting rows are 1-indexed from the bottom; the chart paints high rows
    // at the top. Translate the chunk's pattern-row range into the knitter's
    // row-number range.
    const knitRowEnd = patRows - rc.start;     // top of this panel
    const knitRowStart = patRows - rc.end + 1; // bottom of this panel
    const rowRange = `Rows ${knitRowEnd}–${knitRowStart}`;
    const colRange = `Cols ${cc.start + 1}–${cc.end}`;
    return `${rowRange} · ${colRange}`;
}

// ----- Per-panel table builder ------------------------------------------

function buildPanelTable(opts) {
    const {
        pattern, stitchRegion, rowChunk, colChunk,
        cellMm, isFlat, r1IsWS, drawnClusters,
        hasColors, colorSymbolMap, useIcons,
    } = opts;
    const patRows = pattern.length;

    const table = document.createElement('table');
    table.className = 'print-grid';
    // Explicit table width + inline `table-layout: fixed` are both required
    // for per-column widths to be honored. The @media-print stylesheet sets
    // table-layout: fixed too, but enforcing it inline keeps long stitch
    // codes from widening their column if a browser falls back to auto.
    const numCols = colChunk.end - colChunk.start;
    table.style.width = (PRINT_ROW_HEADER_MM + numCols * cellMm).toFixed(2) + 'mm';
    table.style.tableLayout = 'fixed';

    // <colgroup> with classed <col> elements: cell widths come from the
    // injected stylesheet rule, no inline styles on each cell.
    const colgroup = document.createElement('colgroup');
    const headerCol = document.createElement('col');
    headerCol.className = 'print-header-col';
    colgroup.appendChild(headerCol);
    for (let c = colChunk.start; c < colChunk.end; c++) {
        const col = document.createElement('col');
        col.className = 'print-cell-col';
        colgroup.appendChild(col);
    }
    table.appendChild(colgroup);

    // Column header row
    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th')); // corner
    for (let c = colChunk.start; c < colChunk.end; c++) {
        const th = document.createElement('th');
        th.textContent = c + 1;
        headRow.appendChild(th);
    }
    table.appendChild(headRow);

    for (let r = rowChunk.start; r < rowChunk.end; r++) {
        const tr = document.createElement('tr');
        const knittingRow = patRows - r;
        const isOdd = (knittingRow % 2 === 1);
        const isRS = isFlat ? (r1IsWS ? !isOdd : isOdd) : true;

        const rowHeader = document.createElement('td');
        rowHeader.className = 'row-header';
        if (isFlat) {
            rowHeader.textContent = knittingRow + (isRS ? '◀' : '▶');
        } else {
            rowHeader.textContent = knittingRow + '◀';
        }
        tr.appendChild(rowHeader);

        for (let c = colChunk.start; c < colChunk.end; c++) {
            const td = document.createElement('td');
            const color = pattern[r][c];
            const stitch = stitchRegion && stitchRegion[r] ? stitchRegion[r][c] : null;

            // Background color
            if (color) {
                td.style.background = color;
                td.style.color = isLightColor(color) ? '#000' : '#fff';
                td.className = 'painted-cell';
            }

            // Stitch / cluster rendering
            if (stitch && typeof stitch === 'object') {
                if (!drawnClusters.has(stitch.id)) {
                    drawnClusters.add(stitch.id);
                    // How many cells of this cluster lie inside the current
                    // chunk? Clip the colSpan so a cluster that straddles the
                    // right edge doesn't paint past the chunk boundary.
                    const clusterStartC = c - (stitch.pos || 0);
                    const visibleStart = Math.max(clusterStartC, colChunk.start);
                    const visibleEnd = Math.min(clusterStartC + stitch.width, colChunk.end);
                    const visibleSpan = Math.max(1, visibleEnd - visibleStart);

                    if (stitch.type === 'user-multi') {
                        const def = (typeof StitchRegistry !== 'undefined') ? StitchRegistry.get(stitch.stitchId) : null;
                        if (useIcons && def && shouldUseIcon(def)) {
                            td.appendChild(renderUserStitchIcon(def, stitch.width, cellMm));
                            td.classList.add('icon-cell');
                        } else {
                            td.textContent = (def && def.code) || stitch.stitchId || '';
                            if (def && def.printSymbolFontPt) td.style.fontSize = def.printSymbolFontPt + 'pt';
                        }
                    } else {
                        td.textContent = (typeof buildCrossingNotation === 'function')
                            ? buildCrossingNotation(stitch)
                            : `C${stitch.width}${stitch.dir === 'left' ? 'F' : 'B'}`;
                    }
                    td.colSpan = visibleSpan;
                    td.className = (td.className + ' cable-cell').trim();
                    c += visibleSpan - 1;
                } else {
                    // Cell is part of an already-drawn cluster — skip.
                    continue;
                }
            } else if (stitch === 'no-stitch') {
                td.className = (td.className + ' no-stitch-cell').trim();
            } else if (stitch) {
                const def = (typeof StitchRegistry !== 'undefined') ? StitchRegistry.get(stitch) : null;
                if (def && useIcons && shouldUseIcon(def)) {
                    td.appendChild(renderUserStitchIcon(def, 1, cellMm));
                    td.classList.add('icon-cell');
                } else if (def && def.printSymbol) {
                    td.textContent = def.printSymbol;
                    const purlClass = (stitch === 'purl') ? ' stitch-purl-cell' : '';
                    td.className = (td.className + ' stitch-cell' + purlClass).trim();
                    if (def.printSymbolFontPt) td.style.fontSize = def.printSymbolFontPt + 'pt';
                } else if (hasColors && color) {
                    td.textContent = colorSymbolMap[color];
                }
            } else if (hasColors && color) {
                td.textContent = colorSymbolMap[color];
            }

            // When a colored cell also carries a stitch, the stitch glyph or
            // icon takes the centre — but on B&W prints the cell's background
            // colour is unreadable, so a small corner marker preserves the
            // colour-symbol mapping. 'no-stitch' is a chart-only marker, not
            // a real cell, so colour markers don't apply there.
            if (hasColors && color && stitch && stitch !== 'no-stitch') {
                const mark = document.createElement('span');
                mark.className = 'print-color-mark';
                mark.textContent = colorSymbolMap[color];
                td.appendChild(mark);
                td.classList.add('has-color-mark');
            }

            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
    return table;
}

// ----- Icon rasterisation -----------------------------------------------

// Render an icon only when the stitch is user-defined AND has actual drawn
// shapes. User stitches with empty/erase-only shapes still render via the
// code-as-text fallback (drawCell handles that), which is fine for the
// in-app grid but defeats the purpose of an "icon" in print — we want a real
// glyph for the print toggle, not a text-rendered code.
function shouldUseIcon(def) {
    if (!def || def.source !== 'user') return false;
    if (typeof def.drawCell !== 'function') return false;
    const shapes = def.shapes;
    if (!shapes || !shapes.length) return false;
    if (typeof isEffectivelyEmpty === 'function' && isEffectivelyEmpty(shapes)) return false;
    return true;
}

function renderUserStitchIcon(def, widthCells, cellMm) {
    const cacheKey = `${def.id}:${widthCells}`;
    let dataUrl = _printIconCache.get(cacheKey);
    if (!dataUrl) {
        const wPx = Math.max(20, Math.round(widthCells * cellMm * PRINT_ICON_PX_PER_MM));
        const hPx = Math.max(20, Math.round(cellMm * PRINT_ICON_PX_PER_MM));
        const canvas = document.createElement('canvas');
        canvas.width = wPx;
        canvas.height = hPx;
        const ctx = canvas.getContext('2d');
        try {
            def.drawCell(ctx, 0, 0, wPx, hPx);
            dataUrl = canvas.toDataURL('image/png');
        } catch (e) {
            dataUrl = '';
        }
        _printIconCache.set(cacheKey, dataUrl);
    }
    const img = document.createElement('img');
    img.className = 'print-stitch-icon';
    img.src = dataUrl;
    img.alt = def.code || def.id;
    return img;
}

// ----- Legend -----------------------------------------------------------

function buildPrintLegend({ stitchRegion, colorsUsed, colorSymbolMap, hasColors, useIcons, cellMm }) {
    const legend = document.getElementById('print-legend');
    legend.innerHTML = '';

    const hasStitches = stitchRegion && stitchRegion.some(row =>
        row && row.some(s => s !== null)
    );
    if (hasStitches) {
        const usedSimpleIds = [];
        const seen = new Set();
        let usesNoStitch = false;
        for (let r = 0; r < stitchRegion.length; r++) {
            const row = stitchRegion[r] || [];
            for (let c = 0; c < row.length; c++) {
                const s = row[c];
                if (!s || typeof s === 'object') continue;
                if (s === 'no-stitch') { usesNoStitch = true; continue; }
                if (!seen.has(s)) { seen.add(s); usedSimpleIds.push(s); }
            }
        }

        const legendEntries = [];
        for (const id of usedSimpleIds) {
            const def = (typeof StitchRegistry !== 'undefined') ? StitchRegistry.get(id) : null;
            if (!def || !def.printSymbol) continue;
            let labelText;
            if (def.code && def.code !== def.printSymbol) {
                labelText = def.code;
            } else if (def.label && def.label !== def.printSymbol) {
                labelText = def.label;
            } else {
                labelText = def.title || def.label || id;
                if (labelText.includes(' — ')) labelText = labelText.split(' — ')[0];
                if (labelText.includes(' (')) labelText = labelText.split(' (')[0];
            }
            const useIconHere = !!(useIcons && shouldUseIcon(def));
            legendEntries.push({
                sym: def.printSymbol, label: labelText, isNoStitch: false,
                def, useIconHere,
            });
        }
        if (usesNoStitch) {
            legendEntries.push({ sym: '', label: 'No stitch', isNoStitch: true });
        }

        if (legendEntries.length > 0) {
            const stitchLegendHtml = document.createElement('div');
            stitchLegendHtml.innerHTML = '<h3>Stitch Symbols</h3>';
            const stitchGrid = document.createElement('div');
            stitchGrid.className = 'print-legend-grid';
            legendEntries.forEach(entry => {
                const item = document.createElement('div');
                item.className = 'print-legend-item';
                const swatch = document.createElement('span');
                swatch.className = entry.isNoStitch ? 'print-legend-swatch no-stitch-cell' : 'print-legend-swatch';
                if (entry.useIconHere) {
                    // Mirror the chart cell: same icon, same width box.
                    swatch.classList.add('icon-cell');
                    swatch.appendChild(renderUserStitchIcon(entry.def, 1, cellMm || 7));
                } else if (!entry.isNoStitch && entry.sym && entry.sym.length > 1) {
                    swatch.style.width = 'auto';
                    swatch.style.padding = '0 2mm';
                    swatch.style.fontSize = '7pt';
                    swatch.textContent = entry.sym;
                } else if (!entry.isNoStitch) {
                    swatch.textContent = entry.sym;
                }
                const labelSpan = document.createElement('span');
                labelSpan.textContent = entry.label;
                item.appendChild(swatch);
                item.appendChild(labelSpan);
                stitchGrid.appendChild(item);
            });
            stitchLegendHtml.appendChild(stitchGrid);
            legend.appendChild(stitchLegendHtml);
        }

        // Crossing definitions
        if (typeof collectUniqueCrossings === 'function') {
            const crossings = collectUniqueCrossings(stitchRegion);
            if (crossings.length > 0) {
                const crossLegend = document.createElement('div');
                crossLegend.innerHTML = '<h3>Crossing Definitions</h3>';
                const crossGrid = document.createElement('div');
                crossGrid.className = 'print-legend-grid';
                crossings.forEach(cx => {
                    const item = document.createElement('div');
                    item.className = 'print-legend-item';
                    item.innerHTML = `<span class="print-legend-swatch" style="width:auto;padding:0 2mm;">${cx.notation}</span><span>${cx.description}</span>`;
                    crossGrid.appendChild(item);
                });
                crossLegend.appendChild(crossGrid);
                legend.appendChild(crossLegend);
            }
        }

        // Multi-cell user-stitch definitions
        const userMultiSeen = new Map();
        for (const row of stitchRegion) {
            if (!row) continue;
            for (const s of row) {
                if (!s || typeof s !== 'object' || s.type !== 'user-multi') continue;
                if (userMultiSeen.has(s.stitchId)) continue;
                const def = (typeof StitchRegistry !== 'undefined') ? StitchRegistry.get(s.stitchId) : null;
                if (!def) continue;
                userMultiSeen.set(s.stitchId, { def, width: s.width });
            }
        }
        if (userMultiSeen.size > 0) {
            const umLegend = document.createElement('div');
            umLegend.innerHTML = '<h3>Multi-cell Stitches</h3>';
            const umGrid = document.createElement('div');
            umGrid.className = 'print-legend-grid';
            for (const { def, width } of userMultiSeen.values()) {
                const item = document.createElement('div');
                item.className = 'print-legend-item';
                const swatch = document.createElement('span');
                swatch.className = 'print-legend-swatch';
                if (useIcons && shouldUseIcon(def)) {
                    swatch.classList.add('icon-cell');
                    swatch.style.width = (width * 6) + 'mm';
                    swatch.style.height = '6mm';
                    swatch.appendChild(renderUserStitchIcon(def, width, cellMm || 7));
                } else {
                    swatch.style.width = 'auto';
                    swatch.style.padding = '0 2mm';
                    swatch.textContent = def.code || def.label || def.id;
                }
                const labelSpan = document.createElement('span');
                labelSpan.textContent = def.detailedInstructions || def.title || def.label || '';
                item.appendChild(swatch);
                item.appendChild(labelSpan);
                umGrid.appendChild(item);
            }
            umLegend.appendChild(umGrid);
            legend.appendChild(umLegend);
        }
    }

    if (hasColors) {
        const colorLegendHtml = document.createElement('div');
        colorLegendHtml.innerHTML = '<h3>Colour Legend</h3>';
        const colorGrid = document.createElement('div');
        colorGrid.className = 'print-legend-grid';
        colorsUsed.forEach((color, i) => {
            const item = document.createElement('div');
            item.className = 'print-legend-item';
            const swatch = document.createElement('span');
            swatch.className = 'print-legend-swatch';
            swatch.style.background = color;
            swatch.style.color = isLightColor(color) ? '#000' : '#fff';
            swatch.textContent = colorSymbolMap[color];
            const label = document.createElement('span');
            const name = (typeof hexToColorName === 'function') ? hexToColorName(color) : color;
            const colLabel = colorsUsed.length === 1 ? name : `C${i + 1} (${name})`;
            label.textContent = `${colorSymbolMap[color]} = ${colLabel}`;
            item.appendChild(swatch);
            item.appendChild(label);
            colorGrid.appendChild(item);
        });
        colorLegendHtml.appendChild(colorGrid);
        legend.appendChild(colorLegendHtml);
    }
}

// Inject a single <style> element with the dynamic cell width/height for
// this print run. Replaces ~30 chars of inline style on every td (a 150×150
// chart was emitting ~660KB of redundant style attributes, which corrupted
// some PDF print engines).
function injectPrintCellStyle(cellMm) {
    const cellMmStr = cellMm.toFixed(2) + 'mm';
    let styleEl = document.getElementById('print-dynamic-styles');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'print-dynamic-styles';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
@media print {
    .print-grid td { height: ${cellMmStr}; }
    .print-grid col.print-cell-col { width: ${cellMmStr}; }
    .print-grid col.print-header-col { width: ${PRINT_ROW_HEADER_MM}mm; }
}
`;
}

function isLightColor(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substr(0, 2), 16);
    const g = parseInt(c.substr(2, 2), 16);
    const b = parseInt(c.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
}
