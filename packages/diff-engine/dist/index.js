"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIFF_ENGINE_VERSION = void 0;
exports.diffHtml = diffHtml;
exports.DIFF_ENGINE_VERSION = '0.2.0';
function diffHtml(beforeHtml, afterHtml) {
    const beforeLines = normalizeSourceLines(beforeHtml);
    const afterLines = normalizeSourceLines(afterHtml);
    const lineSequence = diffSequence(beforeLines, afterLines);
    const sourceLines = lineSequence.map((entry) => ({
        kind: entry.kind,
        beforeLineNumber: entry.beforeIndex !== undefined ? entry.beforeIndex + 1 : undefined,
        afterLineNumber: entry.afterIndex !== undefined ? entry.afterIndex + 1 : undefined,
        content: entry.beforeValue ?? entry.afterValue ?? ''
    }));
    const beforeBlocks = htmlToRenderedBlocks(beforeHtml);
    const afterBlocks = htmlToRenderedBlocks(afterHtml);
    const blockSequence = diffSequence(beforeBlocks, afterBlocks);
    const renderedBlocks = blockSequence.map((entry) => ({
        kind: entry.kind,
        beforeText: entry.beforeValue,
        afterText: entry.afterValue
    }));
    const { changeRegions, gutter } = buildRegionsAndGutter(lineSequence);
    return {
        beforeHtml,
        afterHtml,
        sourceLines,
        renderedBlocks,
        changeRegions,
        gutter
    };
}
function normalizeSourceLines(html) {
    const normalized = html.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n').map((line) => line.trimEnd());
    if (lines.length === 1 && lines[0] === '') {
        return [];
    }
    return lines;
}
function htmlToRenderedBlocks(html) {
    const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|tr)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+\n/g, '\n')
        .replace(/\n\s+/g, '\n');
    return stripped
        .split('\n')
        .map((value) => value.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}
function diffSequence(beforeValues, afterValues) {
    const rows = beforeValues.length;
    const cols = afterValues.length;
    const lcs = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0));
    for (let i = rows - 1; i >= 0; i -= 1) {
        for (let j = cols - 1; j >= 0; j -= 1) {
            lcs[i][j] = beforeValues[i] === afterValues[j]
                ? lcs[i + 1][j + 1] + 1
                : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const sequence = [];
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
        if (beforeValues[i] === afterValues[j]) {
            sequence.push({
                kind: 'unchanged',
                beforeIndex: i,
                afterIndex: j,
                beforeValue: beforeValues[i],
                afterValue: afterValues[j]
            });
            i += 1;
            j += 1;
            continue;
        }
        if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            sequence.push({
                kind: 'removed',
                beforeIndex: i,
                beforeValue: beforeValues[i]
            });
            i += 1;
            continue;
        }
        sequence.push({
            kind: 'added',
            afterIndex: j,
            afterValue: afterValues[j]
        });
        j += 1;
    }
    while (i < rows) {
        sequence.push({
            kind: 'removed',
            beforeIndex: i,
            beforeValue: beforeValues[i]
        });
        i += 1;
    }
    while (j < cols) {
        sequence.push({
            kind: 'added',
            afterIndex: j,
            afterValue: afterValues[j]
        });
        j += 1;
    }
    return sequence;
}
function buildRegionsAndGutter(sequence) {
    const changeRegions = [];
    const gutter = [];
    let regionIndex = 0;
    for (let index = 0; index < sequence.length; index += 1) {
        const entry = sequence[index];
        if (entry.kind === 'unchanged') {
            continue;
        }
        const next = sequence[index + 1];
        const regionId = `region-${regionIndex + 1}`;
        if (entry.kind === 'removed' && next?.kind === 'added') {
            regionIndex += 1;
            changeRegions.push({
                id: regionId,
                kind: 'changed',
                label: `Changed region ${regionIndex}`,
                beforeText: entry.beforeValue,
                afterText: next.afterValue,
                beforeLineStart: entry.beforeIndex !== undefined ? entry.beforeIndex + 1 : undefined,
                beforeLineEnd: entry.beforeIndex !== undefined ? entry.beforeIndex + 1 : undefined,
                afterLineStart: next.afterIndex !== undefined ? next.afterIndex + 1 : undefined,
                afterLineEnd: next.afterIndex !== undefined ? next.afterIndex + 1 : undefined
            });
            if (entry.beforeIndex !== undefined) {
                gutter.push({ lineNumber: entry.beforeIndex + 1, kind: 'changed', regionId, side: 'before' });
            }
            if (next.afterIndex !== undefined) {
                gutter.push({ lineNumber: next.afterIndex + 1, kind: 'changed', regionId, side: 'after' });
            }
            index += 1;
            continue;
        }
        regionIndex += 1;
        changeRegions.push({
            id: regionId,
            kind: entry.kind,
            label: `${entry.kind === 'added' ? 'Added' : 'Removed'} region ${regionIndex}`,
            beforeText: entry.beforeValue,
            afterText: entry.afterValue,
            beforeLineStart: entry.beforeIndex !== undefined ? entry.beforeIndex + 1 : undefined,
            beforeLineEnd: entry.beforeIndex !== undefined ? entry.beforeIndex + 1 : undefined,
            afterLineStart: entry.afterIndex !== undefined ? entry.afterIndex + 1 : undefined,
            afterLineEnd: entry.afterIndex !== undefined ? entry.afterIndex + 1 : undefined
        });
        if (entry.beforeIndex !== undefined) {
            gutter.push({
                lineNumber: entry.beforeIndex + 1,
                kind: entry.kind,
                regionId,
                side: 'before'
            });
        }
        if (entry.afterIndex !== undefined) {
            gutter.push({
                lineNumber: entry.afterIndex + 1,
                kind: entry.kind,
                regionId,
                side: 'after'
            });
        }
    }
    return { changeRegions, gutter };
}
