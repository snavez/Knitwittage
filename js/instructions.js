// === Knitting Instructions Generator ===

const COLOR_NAMES = {
    '#c8392d': 'madder',
    '#c76b2b': 'rust',
    '#d9a441': 'ochre',
    '#7a8a5a': 'sage',
    '#5a8a82': 'verdigris',
    '#4f6e88': 'indigo',
    '#7a5a8a': 'heather',
    '#b85c6e': 'rose',
    '#6b4a2f': 'walnut',
    '#e0d5b0': 'cream',
    '#2a2e3c': 'midnight',
    '#1b1612': 'soot',
};

const NAMED_COLORS = [
    { hex: '#ff0000', name: 'red' },
    { hex: '#ff4500', name: 'orange-red' },
    { hex: '#ff8c00', name: 'dark orange' },
    { hex: '#ffa500', name: 'orange' },
    { hex: '#ffd700', name: 'gold' },
    { hex: '#ffff00', name: 'yellow' },
    { hex: '#adff2f', name: 'yellow-green' },
    { hex: '#00ff00', name: 'lime' },
    { hex: '#008000', name: 'green' },
    { hex: '#008080', name: 'teal' },
    { hex: '#00ffff', name: 'cyan' },
    { hex: '#0000ff', name: 'blue' },
    { hex: '#4b0082', name: 'indigo' },
    { hex: '#800080', name: 'purple' },
    { hex: '#ff00ff', name: 'magenta' },
    { hex: '#ff69b4', name: 'hot pink' },
    { hex: '#ffc0cb', name: 'pink' },
    { hex: '#a52a2a', name: 'brown' },
    { hex: '#d2691e', name: 'chocolate' },
    { hex: '#f5deb3', name: 'wheat' },
    { hex: '#ffffff', name: 'white' },
    { hex: '#c0c0c0', name: 'silver' },
    { hex: '#808080', name: 'grey' },
    { hex: '#000000', name: 'black' },
    { hex: '#800000', name: 'maroon' },
    { hex: '#000080', name: 'navy' },
    { hex: '#556b2f', name: 'dark olive' },
    { hex: '#2f4f4f', name: 'dark slate' },
];

function hexToRGB(hex) {
    const c = hex.replace('#', '');
    return {
        r: parseInt(c.substr(0, 2), 16),
        g: parseInt(c.substr(2, 2), 16),
        b: parseInt(c.substr(4, 2), 16),
    };
}

function hexToColorName(hex) {
    hex = hex.toLowerCase();
    // Check preset colors first
    if (COLOR_NAMES[hex]) return COLOR_NAMES[hex];

    // Find nearest named color by RGB distance
    const target = hexToRGB(hex);
    let bestName = hex;
    let bestDist = Infinity;

    for (const entry of NAMED_COLORS) {
        const c = hexToRGB(entry.hex);
        const dist = (target.r - c.r) ** 2 + (target.g - c.g) ** 2 + (target.b - c.b) ** 2;
        if (dist < bestDist) {
            bestDist = dist;
            bestName = entry.name;
        }
    }
    return bestName;
}

function buildColorLegend(pattern) {
    const colorsUsed = [];
    const rows = pattern.length;
    const cols = pattern[0].length;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (pattern[r][c] && !colorsUsed.includes(pattern[r][c])) {
                colorsUsed.push(pattern[r][c]);
            }
        }
    }

    const labelMap = {};
    const colors = colorsUsed.map((hex, i) => {
        const name = hexToColorName(hex);
        // If only one design color, use the name directly; otherwise use C1, C2...
        const label = colorsUsed.length === 1 ? name : `C${i + 1}`;
        labelMap[hex] = label;
        return { hex, name, label };
    });

    return { colors, labelMap };
}

function runLengthEncode(cells, stitchType, labelMap) {
    if (cells.length === 0) return '';
    const runs = [];
    let current = cells[0];
    let count = 1;

    for (let i = 1; i < cells.length; i++) {
        if (cells[i] === current) {
            count++;
        } else {
            runs.push({ color: current, count });
            current = cells[i];
            count = 1;
        }
    }
    runs.push({ color: current, count });

    return runs.map(run => {
        const label = run.color === null ? 'BG' : (labelMap[run.color] || run.color);
        return `${stitchType}${run.count} in ${label}`;
    }).join(', ');
}

// A row whose every cell is 'no-stitch' represents a chart placeholder that
// doesn't produce any actual knitting — skip it when numbering rows. Rows of
// plain background colour are real stitches (K/P in BG) and must NOT be skipped.
function isRowAllNoStitch(stitchRow) {
    if (!stitchRow || !stitchRow.length) return false;
    return stitchRow.every(s => s === 'no-stitch');
}

// Returns the arrayRow indices (into `pattern`) for each active knitting row,
// in knitting-row order: result[0] = R1 (bottom of chart), result[last] = top.
// Rows that are entirely 'no-stitch' are omitted so R1..Rn are sequential.
function getActiveKnittingRows(pattern, stitchRegion) {
    if (!pattern || !pattern.length) return [];
    const patRows = pattern.length;
    const active = [];
    for (let knittingRow = 1; knittingRow <= patRows; knittingRow++) {
        const arrayRow = patRows - knittingRow;
        const stitchRow = stitchRegion ? stitchRegion[arrayRow] : null;
        if (!isRowAllNoStitch(stitchRow)) active.push(arrayRow);
    }
    return active;
}

function formatInstructionsText(pattern, mode) {
    if (!pattern || pattern.length === 0) return '';

    const patRows = pattern.length;
    const patCols = pattern[0].length;
    const legend = buildColorLegend(pattern);
    const isFlat = mode === 'flat';
    const hasColors = legend.colors.length > 0;

    // Determine the stitchGrid region matching the pattern
    const stitchRegion = getStitchRegion(patRows, patCols);

    let text = 'KNITTING PATTERN INSTRUCTIONS\n';
    text += '==============================\n';
    text += `Size: ${patCols} stitches wide x ${patRows} rows tall\n`;
    text += `Mode: ${isFlat ? 'Flat knitting (back and forth)' : 'In the round'}\n\n`;

    // Colour legend — only if colours are present
    if (hasColors) {
        text += 'Colour Legend:\n';
        text += '  BG = Background (unspecified)\n';
        legend.colors.forEach(c => {
            if (legend.colors.length === 1) {
                text += `  ${c.label}\n`;
            } else {
                text += `  ${c.label} = ${c.name}\n`;
            }
        });
    }

    // Collect all unique crossings used in the pattern
    const crossings = collectUniqueCrossings(stitchRegion);
    if (crossings.length > 0) {
        text += '\nCrossing Definitions:\n';
        crossings.forEach(cx => {
            text += `  ${cx.notation}: ${cx.description}\n`;
        });
    }

    // Lace/decrease abbreviations — list only those actually used. The earlier
    // version dumped K2tog/SSK/P2tog/SSP/S2KP/SP2P whenever any decrease or YO
    // appeared, which surfaced abbreviations the chart never contains.
    const usedSet = new Set();
    if (stitchRegion) {
        for (const row of stitchRegion) {
            if (!row) continue;
            for (const s of row) {
                if (typeof s === 'string') usedSet.add(s);
            }
        }
    }
    const abbrevs = [];
    if (usedSet.has('hole'))    abbrevs.push('  YO = Yarn over (creates decorative hole)');
    if (usedSet.has('k-right')) abbrevs.push('  K2tog = Knit 2 together (right-leaning decrease)');
    if (usedSet.has('k-left'))  abbrevs.push('  SSK = Slip, slip, knit (left-leaning decrease)');
    if (usedSet.has('m1r'))     abbrevs.push('  M1R = Make 1 right (pick up bar back-to-front, knit through front loop)');
    if (usedSet.has('m1l'))     abbrevs.push('  M1L = Make 1 left (pick up bar front-to-back, knit through back loop)');
    if (abbrevs.length > 0) {
        text += '\nLace/Decrease Abbreviations:\n';
        text += abbrevs.join('\n') + '\n';
    }

    // User-defined custom stitches used in this pattern
    if (typeof StitchRegistry !== 'undefined' && stitchRegion) {
        const usedUserIds = new Set();
        for (const row of stitchRegion) {
            if (!row) continue;
            for (const s of row) {
                let id = null;
                if (typeof s === 'string') id = s;
                else if (s && typeof s === 'object' && s.type === 'user-multi') id = s.stitchId;
                if (id) {
                    const def = StitchRegistry.get(id);
                    if (def && def.source === 'user') usedUserIds.add(id);
                }
            }
        }
        if (usedUserIds.size > 0) {
            text += '\nCustom Stitches:\n';
            for (const id of usedUserIds) {
                const def = StitchRegistry.get(id);
                const body = def.detailedInstructions || '(no detailed instructions provided)';
                text += `  ${def.code}: ${body}\n`;
            }
        }
    }

    text += '\n';

    // Instructions
    text += 'Instructions:\n';

    // R1 can be either RS or WS in flat knitting — affects the side of every row
    const r1IsWS = (state.firstRow === 'WS');

    const activeArrayRows = getActiveKnittingRows(pattern, stitchRegion);

    // Cast-on preamble: count the stitches the knitter actually casts on,
    // which is the count of cells in knitting row 1 (= the bottom of the
    // chart = array row patRows-1) that aren't 'no-stitch'. This is a
    // one-shot line — knitters cast on once at the very start and never
    // again across pattern repeats.
    if (activeArrayRows.length > 0) {
        const r1Array = activeArrayRows[0];
        const r1Stitch = stitchRegion ? stitchRegion[r1Array] : null;
        let castOn;
        if (r1Stitch) {
            castOn = 0;
            for (const s of r1Stitch) if (s !== 'no-stitch') castOn++;
        } else {
            castOn = patCols;
        }
        const noun = castOn === 1 ? 'stitch' : 'stitches';
        text += `Cast on ${castOn} ${noun}.\n`;
    }

    for (let i = 0; i < activeArrayRows.length; i++) {
        const knittingRow = i + 1;
        const arrayRow = activeArrayRows[i];

        if (isFlat) {
            const isOdd = (knittingRow % 2 === 1);
            const isRS = r1IsWS ? !isOdd : isOdd;
            const defaultSt = isRS ? 'K' : 'P';
            const side = isRS ? 'RS' : 'WS';

            const rowInstructions = encodeRowWithStitches(
                pattern[arrayRow],
                stitchRegion ? stitchRegion[arrayRow] : null,
                defaultSt,
                legend.labelMap,
                isRS,
                hasColors
            );
            text += `Row ${knittingRow} (${side}): ${rowInstructions}\n`;
        } else {
            const rowInstructions = encodeRowWithStitches(
                pattern[arrayRow],
                stitchRegion ? stitchRegion[arrayRow] : null,
                'K',
                legend.labelMap,
                true,
                hasColors
            );
            text += `Rnd ${knittingRow}: ${rowInstructions}\n`;
        }
    }

    return text;
}

// Get the stitch grid region matching the current pattern region.
// Uses the same bounds as getPatternRegion so every row/col lines up.
function getStitchRegion(patRows, patCols) {
    if (!state.stitchGrid || !state.stitchGrid.length) return null;
    const bounds = (typeof getPatternBounds === 'function') ? getPatternBounds() : null;
    if (!bounds) return null;
    const region = [];
    for (let r = bounds.minR; r <= bounds.maxR; r++) {
        const row = [];
        for (let c = bounds.minC; c <= bounds.maxC; c++) {
            row.push(state.stitchGrid[r] ? state.stitchGrid[r][c] : null);
        }
        region.push(row);
    }
    return region;
}

// Encode a single row including stitch types and cables
function encodeRowWithStitches(colorRow, stitchRow, defaultSt, labelMap, reverseRead, hasColors) {
    const len = colorRow.length;
    if (!stitchRow) {
        // No stitch data — fall back to simple colour encoding
        const cells = reverseRead ? [...colorRow].reverse() : [...colorRow];
        return hasColors ? runLengthEncode(cells, defaultSt, labelMap) : `${defaultSt}${len}`;
    }

    // Build an array of instruction tokens for each cell
    const tokens = [];
    const processed = new Set();

    // Process in chart order (L-to-R in array), then reverse if needed
    for (let c = 0; c < len; c++) {
        const stitch = stitchRow[c];

        if (stitch && typeof stitch === 'object' && !processed.has(stitch.id)) {
            processed.add(stitch.id);
            const color = colorRow[c];

            // Multi-cell user stitches collapse the run into one token.
            if (stitch.type === 'user-multi') {
                const def = (typeof StitchRegistry !== 'undefined') ? StitchRegistry.get(stitch.stitchId) : null;
                const code = (def && def.code) || stitch.stitchId || '?';
                if (hasColors && color !== null) {
                    const colorLabel = color === null ? 'BG' : (labelMap[color] || color);
                    tokens.push({ text: code + ' in ' + colorLabel, span: stitch.width });
                } else {
                    tokens.push({ text: code, span: stitch.width });
                }
                c += stitch.width - 1;
                continue;
            }

            const notation = buildCrossingNotation(stitch);
            if (hasColors && color !== null) {
                const colorLabel = color === null ? 'BG' : (labelMap[color] || color);
                tokens.push({ text: notation + ' in ' + colorLabel, span: stitch.width });
            } else {
                tokens.push({ text: notation, span: stitch.width });
            }
            c += stitch.width - 1;
        } else if (stitch && typeof stitch === 'object') {
            // Already processed cable cell, skip
            continue;
        } else if (stitch === 'k-right') {
            // Right-leaning decrease: K2tog on RS, P2tog on WS
            const isRS = (defaultSt === 'K');
            tokens.push({ text: isRS ? 'K2tog' : 'P2tog', color: colorRow[c], span: 1, isDecrease: true, collapsible: true });
        } else if (stitch === 'k-left') {
            // Left-leaning decrease: SSK on RS, SSP on WS
            const isRS = (defaultSt === 'K');
            tokens.push({ text: isRS ? 'SSK' : 'SSP', color: colorRow[c], span: 1, isDecrease: true, collapsible: true });
        } else if (stitch === 'm1r') {
            tokens.push({ text: 'M1R', color: colorRow[c], span: 1, isIncrease: true, collapsible: true });
        } else if (stitch === 'm1l') {
            tokens.push({ text: 'M1L', color: colorRow[c], span: 1, isIncrease: true, collapsible: true });
        } else if (stitch === 'hole') {
            // Hole = YO
            tokens.push({ text: 'YO', color: colorRow[c], span: 1, isHole: true, collapsible: true });
        } else if (stitch === 'no-stitch') {
            // Skip — this cell doesn't exist in the pattern
            continue;
        } else {
            // User-defined stitch? Emit its code verbatim (not K/P-flipped — the
            // code means the same thing on any row, and the detailed explanation
            // is listed separately at the top of the instructions).
            const def = (typeof StitchRegistry !== 'undefined') ? StitchRegistry.get(stitch) : null;
            if (def && def.source === 'user' && def.code) {
                tokens.push({ text: def.code, color: colorRow[c], span: 1, collapsible: true });
                continue;
            }
            // Simple stitch: knit, purl, or default
            // The chart shows the RS appearance. On WS rows, K↔P are flipped:
            // chart 'knit' = purl on WS, chart 'purl' = knit on WS
            const isPurl = (stitch === 'purl');
            const isWS = (defaultSt === 'P');
            let st;
            if (isPurl) {
                st = isWS ? 'K' : 'P'; // purl on chart: K on WS, P on RS
            } else {
                st = isWS ? 'P' : 'K'; // knit on chart: P on WS, K on RS
            }
            const color = colorRow[c];
            tokens.push({ st: st, color: color, span: 1 });
        }
    }

    // Reverse if reading R-to-L
    if (reverseRead) tokens.reverse();

    // Insert balancing decreases for holes (YOs) that aren't already balanced
    // by explicit k-right/k-left lean stitches.
    const isRS = (defaultSt === 'K');

    // Count explicit decreases vs holes
    let explicitDecCount = tokens.filter(t => t.isDecrease).length;
    let holeCount = tokens.filter(t => t.isHole).length;
    let unbalancedHoles = holeCount - explicitDecCount;

    // If all holes are already balanced by explicit lean stitches, skip auto-decrease
    if (unbalancedHoles <= 0) {
        // All balanced — skip to run-length encoding
    } else {

    const pairedHoles = new Set();

    // Pass 1: Find hole-knit-hole patterns (centred double decrease)
    for (let i = 0; i < tokens.length - 2; i++) {
        if (tokens[i].isHole && !pairedHoles.has(i) &&
            tokens[i+1].st && !tokens[i+1].converted &&
            tokens[i+2].isHole && !pairedHoles.has(i+2)) {
            // Found: YO, [knit], YO → convert middle to S2KP
            const technique = isRS ? 'S2KP' : 'SP2P';
            tokens[i+1] = { text: technique, color: tokens[i+1].color, span: 1, converted: true, collapsible: true };
            pairedHoles.add(i);
            pairedHoles.add(i+2);
            // S2KP is a double decrease (-2), balanced by the 2 YOs (+2) — perfectly balanced
        }
    }

    // Pass 2: Remaining unpaired holes need single decreases
    for (let i = 0; i < tokens.length; i++) {
        if (!tokens[i].isHole || pairedHoles.has(i)) continue;

        // Find the nearest unconverted knit stitch
        let bestIdx = -1;
        for (let d = 1; d < tokens.length; d++) {
            const ri = i + d;
            if (ri < tokens.length && tokens[ri].st === defaultSt && !tokens[ri].converted) {
                bestIdx = ri;
                break;
            }
            const li = i - d;
            if (li >= 0 && tokens[li].st === defaultSt && !tokens[li].converted) {
                bestIdx = li;
                break;
            }
        }
        if (bestIdx >= 0) {
            const isAfterHole = bestIdx > i;
            let technique;
            if (!isRS) {
                technique = 'P2tog';
            } else {
                technique = isAfterHole ? 'K2tog' : 'SSK';
            }
            tokens[bestIdx] = { text: technique, color: tokens[bestIdx].color, span: 1, converted: true, collapsible: true };
        }
    }
    } // end if (unbalancedHoles > 0)

    // Run-length encode adjacent same-shape tokens.
    //   - Built-in K/P (no .text) collapse by st+color → "K4 in red".
    //   - Collapsible single-cell tokens (M1R, K2tog, YO, user-simple, …)
    //     collapse by .text → "K2tog × 3" / "M1R × 2".
    //   - Cluster tokens (cables, multi-cell user stitches) emit as-is.
    const parts = [];
    let i = 0;
    while (i < tokens.length) {
        const tok = tokens[i];
        if (tok.text && !tok.collapsible) {
            parts.push(tok.text);
            i++;
        } else if (tok.text && tok.collapsible) {
            let count = tok.span;
            let j = i + 1;
            while (j < tokens.length && tokens[j].collapsible && tokens[j].text === tok.text && tokens[j].color === tok.color) {
                count += tokens[j].span;
                j++;
            }
            let formatted = count > 1 ? `${tok.text} × ${count}` : tok.text;
            if (hasColors && tok.color !== null && tok.color !== undefined) {
                const colorLabel = labelMap[tok.color] || tok.color;
                formatted += ' in ' + colorLabel;
            }
            parts.push(formatted);
            i = j;
        } else {
            let count = tok.span;
            let j = i + 1;
            while (j < tokens.length && !tokens[j].text &&
                   tokens[j].st === tok.st && tokens[j].color === tok.color) {
                count += tokens[j].span;
                j++;
            }
            if (hasColors) {
                const colorLabel = tok.color === null ? 'BG' : (labelMap[tok.color] || tok.color);
                parts.push(`${tok.st}${count} in ${colorLabel}`);
            } else {
                parts.push(`${tok.st}${count}`);
            }
            i = j;
        }
    }

    return parts.join(', ');
}

// === Crossing Notation & Descriptions ===
function buildCrossingNotation(stitch) {
    const clusters = stitch.clusters || [];
    const dirLabel = stitch.dir === 'left' ? 'LC' : 'RC';

    if (clusters.length === 0 || clusters.length === 1) {
        // Pure cable (all same type)
        const half = Math.floor(stitch.width / 2);
        return `${half}/${stitch.width - half} ${dirLabel}`;
    }

    if (clusters.length === 2) {
        const left = clusters[0];
        const right = clusters[1];
        const leftLabel = left.st === 'knit' ? `K${left.count}` : `P${left.count}`;
        const rightLabel = right.st === 'knit' ? `K${right.count}` : `P${right.count}`;
        return `${leftLabel}/${rightLabel} ${dirLabel}`;
    }

    if (clusters.length === 3) {
        const left = clusters[0];
        const center = clusters[1];
        const right = clusters[2];
        const leftLabel = left.st === 'knit' ? `K${left.count}` : `P${left.count}`;
        const centerLabel = center.st === 'knit' ? `K${center.count}` : `P${center.count}`;
        const rightLabel = right.st === 'knit' ? `K${right.count}` : `P${right.count}`;
        return `${leftLabel}/${centerLabel}/${rightLabel} ${dirLabel}`;
    }

    return `${stitch.width}-st ${dirLabel}`;
}

// Helper for #12: spell out a count + stitch as a human phrase
// ("Knit 2", "Purl 3"). Used to prefix each cable definition with a
// plain-English summary before the technical CN/LN instruction.
function describeStitchPhrase(count, st) {
    const verb = st === 'knit' ? 'Knit' : 'Purl';
    return `${verb} ${count}`;
}

function buildCrossingDescription(stitch) {
    const clusters = stitch.clusters || [];
    const isLeft = stitch.dir === 'left';
    const direction = isLeft ? 'Left cross' : 'Right cross';
    const hold = isLeft ? 'front' : 'back';

    // Left Cross: slip LEFT group to CN, hold at FRONT → right group leans left in front
    // Right Cross: slip RIGHT group to CN, hold at BACK → left group leans right in front

    if (clusters.length === 0 || clusters.length === 1) {
        // Pure cable — both halves knit.
        const half = Math.floor(stitch.width / 2);
        const rem = stitch.width - half;
        const summary = `Knit ${isLeft ? rem : half}, Knit ${isLeft ? half : rem} (${direction})`;
        if (isLeft) {
            return `${summary}: Slip ${half} sts to cable needle and hold at ${hold}. Knit ${rem} from left needle, knit ${half} from cable needle.`;
        } else {
            return `${summary}: Slip ${rem} sts to cable needle and hold at ${hold}. Knit ${half} from left needle, knit ${rem} from cable needle.`;
        }
    }

    if (clusters.length === 2) {
        const left = clusters[0];
        const right = clusters[1];
        if (isLeft) {
            // LC: slip left group to CN front, work right group from LN, then left from CN
            const summary = `${describeStitchPhrase(right.count, right.st)}, ${describeStitchPhrase(left.count, left.st)} (${direction})`;
            const workFirst = right.st === 'knit' ? `Knit ${right.count}` : `Purl ${right.count}`;
            const workCN = left.st === 'knit' ? `knit ${left.count}` : `purl ${left.count}`;
            return `${summary}: Slip ${left.count} sts to cable needle and hold at ${hold}. ${workFirst} from left needle, ${workCN} from cable needle.`;
        } else {
            // RC: slip right group to CN back, work left group from LN, then right from CN
            const summary = `${describeStitchPhrase(left.count, left.st)}, ${describeStitchPhrase(right.count, right.st)} (${direction})`;
            const workFirst = left.st === 'knit' ? `Knit ${left.count}` : `Purl ${left.count}`;
            const workCN = right.st === 'knit' ? `knit ${right.count}` : `purl ${right.count}`;
            return `${summary}: Slip ${right.count} sts to cable needle and hold at ${hold}. ${workFirst} from left needle, ${workCN} from cable needle.`;
        }
    }

    if (clusters.length === 3) {
        const left = clusters[0];
        const center = clusters[1];
        const right = clusters[2];
        const summary = `${describeStitchPhrase(left.count, left.st)}, ${describeStitchPhrase(center.count, center.st)}, ${describeStitchPhrase(right.count, right.st)} (${direction})`;
        const centerWork = center.st === 'knit' ? `knit ${center.count}` : `purl ${center.count}`;
        const leftWork = left.st === 'knit' ? `knit ${left.count}` : `purl ${left.count}`;
        const rightWork = right.st === 'knit' ? `knit ${right.count}` : `purl ${right.count}`;
        if (isLeft) {
            return `${summary}: Slip ${left.count + center.count} sts to cable needle and hold at ${hold}. ${right.st === 'knit' ? 'Knit' : 'Purl'} ${right.count} from left needle, slip last ${center.count} from cable needle back to left needle and ${centerWork}, then ${leftWork} from cable needle.`;
        } else {
            return `${summary}: Slip ${right.count} sts to cable needle and hold at ${hold}. ${left.st === 'knit' ? 'Knit' : 'Purl'} ${left.count} from left needle, ${centerWork} from left needle, then ${rightWork} from cable needle.`;
        }
    }

    return `Work ${stitch.width}-stitch ${isLeft ? 'left' : 'right'} cross.`;
}

function collectUniqueCrossings(stitchRegion) {
    if (!stitchRegion) return [];
    const seen = new Set();
    const crossings = [];

    for (const row of stitchRegion) {
        if (!row) continue;
        for (const s of row) {
            if (!s || typeof s !== 'object' || s.type !== 'cross') continue;
            const notation = buildCrossingNotation(s);
            if (seen.has(notation)) continue;
            seen.add(notation);
            crossings.push({
                notation: notation,
                description: buildCrossingDescription(s),
            });
        }
    }
    return crossings;
}

// === Instructions Modal ===
function openInstructionsModal() {
    // Clear any stale single-cell selections that would interfere
    if (state.selection && typeof clearSelection === 'function') {
        const sel = normalizeSelection();
        if (sel && sel.minR === sel.maxR && sel.minC === sel.maxC) {
            clearSelection();
        }
    }
    const pattern = getPatternRegion();
    if (!pattern) {
        showToast('Add some stitches or paint some cells first!');
        return;
    }

    const textEl = document.getElementById('instructions-text');
    const hintEl = document.getElementById('instructions-edit-hint');

    // If we have saved custom instructions, show those; otherwise generate
    if (state.customInstructions) {
        textEl.textContent = state.customInstructions;
        hintEl.innerHTML = '<span class="instructions-edited">Edited</span> — click text to edit';
    } else {
        const mode = state.knittingMode;
        const text = formatInstructionsText(pattern, mode);
        textEl.textContent = text;
        hintEl.textContent = 'Click text to edit';
    }
    document.getElementById('instructions-modal').classList.add('open');
}

function regenerateInstructions() {
    const pattern = getPatternRegion();
    if (!pattern) return;
    const mode = state.knittingMode;
    const text = formatInstructionsText(pattern, mode);
    document.getElementById('instructions-text').textContent = text;
    state.customInstructions = null; // clear saved edits
    document.getElementById('instructions-edit-hint').textContent = 'Click text to edit';
    showToast('Instructions regenerated');
}

function saveCustomInstructions() {
    const text = document.getElementById('instructions-text').textContent;
    state.customInstructions = text;
    document.getElementById('instructions-edit-hint').innerHTML = '<span class="instructions-edited">Edited</span> — click text to edit';
}

function closeInstructionsModal() {
    document.getElementById('instructions-modal').classList.remove('open');
}

function copyInstructionsToClipboard() {
    const text = document.getElementById('instructions-text').textContent;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard');
    });
}

function downloadInstructionsAsText() {
    const text = document.getElementById('instructions-text').textContent;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'knitting-instructions.txt';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Instructions downloaded');
}

// === Bind events ===
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-instructions').addEventListener('click', openInstructionsModal);
    document.getElementById('instructions-close').addEventListener('click', closeInstructionsModal);
    document.getElementById('instructions-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeInstructionsModal();
    });
    document.getElementById('btn-copy-instructions').addEventListener('click', copyInstructionsToClipboard);
    document.getElementById('btn-download-instructions').addEventListener('click', downloadInstructionsAsText);
    document.getElementById('btn-print-instructions').addEventListener('click', () => {
        preparePrint();
    });
    document.getElementById('btn-regenerate-instructions').addEventListener('click', regenerateInstructions);

    // Auto-save edits when the user modifies the instructions text
    document.getElementById('instructions-text').addEventListener('input', () => {
        saveCustomInstructions();
    });

    // Re-generate instructions when global knitting mode changes
    document.getElementById('knitting-mode').addEventListener('change', () => {
        if (document.getElementById('instructions-modal').classList.contains('open')) {
            state.customInstructions = null; // mode changed, regenerate
            openInstructionsModal();
        }
    });
});
