/* ---------- Stage labels ---------- */
export const STAGE_LABELS = {
    queued: 'Queued',
    planning: 'Planning',
    plan_reviewing: 'Plan Review',
    plan_revision: 'Revision',
    building: 'Building',
    worker_discovery_review: 'Discovery Review',
    final_reviewing: 'Final Review',
    reworking: 'Rework',
    approved: 'Approved',
    needs_human_review: 'Needs Review',
    failed: 'Failed',
    canceled: 'Canceled',
};
const VISIBLE_STAGE_ALIASES = {
    worker_discovery_review: 'building',
};
/** Stages shown in the pipeline stepper (excludes terminal states). */
export const PIPELINE_STAGES = [
    'queued',
    'planning',
    'plan_reviewing',
    'plan_revision',
    'building',
    'final_reviewing',
    'reworking',
];
export const TERMINAL_STAGES = new Set([
    'approved',
    'needs_human_review',
    'failed',
    'canceled',
]);
/* ---------- Role labels ---------- */
export const ROLE_LABELS = {
    planner: 'Planner',
    'plan-reviewer': 'Plan Reviewer',
    worker: 'Worker',
    'final-reviewer': 'Final Reviewer',
};
export function verdictBadgeVariant(verdict) {
    switch (verdict) {
        case 'approved':
            return 'success';
        case 'needs_revision':
        case 'needs_rework':
            return 'warning';
        case 'rejected':
        case 'blocked':
            return 'danger';
        case 'needs_human_review':
            return 'danger';
        case 'draft':
            return 'neutral';
        default:
            return 'neutral';
    }
}
export function actionBadgeVariant(action) {
    switch (action) {
        case 'create':
            return 'success';
        case 'edit':
            return 'primary';
        case 'retire':
            return 'danger';
        case 'no_impact':
            return 'neutral';
        default:
            return 'neutral';
    }
}
export function actionLabel(action) {
    switch (action) {
        case 'create':
            return 'CREATE';
        case 'edit':
            return 'EDIT';
        case 'retire':
            return 'RETIRE';
        case 'no_impact':
            return 'NO IMPACT';
        default:
            return action;
    }
}
export function executionStatusBadgeVariant(status) {
    switch (status) {
        case 'executed':
            return 'success';
        case 'approved':
            return 'primary';
        case 'pending':
            return 'neutral';
        case 'blocked':
            return 'danger';
        case 'rejected':
            return 'warning';
        case 'skipped':
            return 'neutral';
        default:
            return 'neutral';
    }
}
export function discoveryStatusBadgeVariant(status) {
    switch (status) {
        case 'approved':
            return 'success';
        case 'pending_review':
            return 'warning';
        case 'rejected':
            return 'neutral';
        case 'escalated':
            return 'danger';
        default:
            return 'neutral';
    }
}
export function getVisibleStage(stage) {
    if (!stage)
        return stage;
    return VISIBLE_STAGE_ALIASES[stage] ?? stage;
}
export function getVisibleStageLabel(stage) {
    const visibleStage = getVisibleStage(stage);
    return visibleStage ? STAGE_LABELS[visibleStage] : undefined;
}
export function deriveCompletedStages(timeline) {
    const completed = new Set();
    const stagesSeen = new Set();
    for (const entry of timeline) {
        const stage = getVisibleStage(entry.stage);
        if (!stage || stagesSeen.has(stage)) {
            continue;
        }
        stagesSeen.add(stage);
    }
    // A stage is completed if a later stage exists in the timeline
    const stageOrder = [...PIPELINE_STAGES, ...TERMINAL_STAGES];
    let maxIdx = -1;
    for (const stage of stagesSeen) {
        const idx = stageOrder.indexOf(stage);
        if (idx > maxIdx)
            maxIdx = idx;
    }
    for (const stage of stagesSeen) {
        const idx = stageOrder.indexOf(stage);
        if (idx < maxIdx) {
            completed.add(stage);
        }
    }
    return completed;
}
/* ---------- Timestamp formatting ---------- */
export function formatTimestamp(utc) {
    try {
        return new Date(utc).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }
    catch {
        return utc;
    }
}
export function formatDate(utc) {
    try {
        return new Date(utc).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
    catch {
        return utc;
    }
}
/* ---------- Confidence color ---------- */
export function confidenceColor(confidence) {
    if (confidence >= 80)
        return 'var(--color-success)';
    if (confidence >= 50)
        return 'var(--color-warning)';
    return 'var(--color-danger)';
}
const HUMANIZE_DICTIONARY = new Set([
    'a', 'about', 'accounted', 'action', 'adjacent', 'after', 'all', 'already', 'an', 'and', 'any', 'appears',
    'article', 'articles', 'assessed', 'at', 'authored', 'back', 'batch', 'behavior', 'blocked', 'broader', 'by',
    'candidate', 'change', 'changes', 'click', 'cluster', 'complete', 'completed', 'confirm', 'confirmed', 'content',
    'context', 'coverage', 'covered', 'create', 'created', 'creation', 'criteria', 'cross', 'current', 'currently',
    'delta', 'describe', 'describes', 'deterministic', 'did', 'direct', 'discovery', 'distinct', 'documented', 'do',
    'does', 'duplicate', 'duplicated', 'duplicating', 'edit', 'editing', 'embedding', 'evidence', 'eventual', 'exact',
    'execute', 'executed', 'execution', 'existing', 'expected', 'family', 'feature', 'field', 'fields', 'file',
    'final', 'find', 'flow', 'focused', 'food', 'for', 'found', 'from', 'fully', 'has', 'have', 'if', 'impact', 'in',
    'indexing', 'inside', 'into', 'is', 'item', 'items', 'justification', 'kb', 'later', 'legacy', 'likely', 'limit',
    'limited', 'link', 'links', 'list', 'lists', 'load', 'lookup', 'main', 'manage', 'management', 'manual', 'match',
    'matched', 'matches', 'menu', 'mode', 'name', 'named', 'nearby', 'new', 'no', 'not', 'of', 'on', 'one', 'only',
    'open', 'opens', 'option', 'or', 'outside', 'path', 'pending', 'pbi', 'permission', 'plan', 'planner', 'portal',
    'prefetch', 'prefill', 'prefilled', 'proposal', 'published', 'queries', 'question', 'questions', 'reason',
    'reference', 'related', 'relations', 'relevant', 'rename', 'reopen', 'report', 'request', 'results', 'review',
    'reviewed', 'returned', 'save', 'scope', 'search', 'seeded', 'select', 'set', 'should', 'show', 'shows', 'side',
    'sheet', 'single', 'so', 'space', 'standalone', 'stage', 'stay', 'strongest', 'sufficient', 'summary', 'surfaced',
    'table', 'target', 'task', 'text', 'that', 'the', 'their', 'there', 'this', 'title', 'to', 'treat', 'two', 'ui',
    'under', 'unless', 'user', 'using', 'variant', 'variants', 'versus', 'was', 'were', 'while', 'with', 'work',
    'worker', 'workflow', 'workflows', 'workspace'
]);
const HUMANIZE_ACRONYMS = new Map([
    ['api', 'API'],
    ['html', 'HTML'],
    ['id', 'ID'],
    ['json', 'JSON'],
    ['kb', 'KB'],
    ['pbi', 'PBI'],
    ['ui', 'UI'],
]);
export function humanizeAnalysisText(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || /<\/?[a-z][\s\S]*>/i.test(normalized) || normalized.includes('http://') || normalized.includes('https://')) {
        return normalized;
    }
    return normalized
        .split(/(`[^`]*`)/g)
        .map((part) => {
        if (!part || part.startsWith('`')) {
            return part;
        }
        return humanizeAnalysisSegment(part);
    })
        .join('')
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;!?])/g, '$1')
        .trim();
}
function humanizeAnalysisSegment(value) {
    const aggressive = shouldAggressivelyHumanize(value);
    const withAcronymBoundaries = Array.from(HUMANIZE_ACRONYMS.values()).reduce((text, acronym) => text
        .replace(new RegExp(`(${acronym}s)([A-Z][a-z])`, 'g'), '$1 $2')
        .replace(new RegExp(`(${acronym}s)([a-z]{2,})`, 'g'), '$1 $2')
        .replace(new RegExp(`(${acronym})([A-Z][a-z])`, 'g'), '$1 $2')
        .replace(new RegExp(`(${acronym})([a-z]{2,})`, 'g'), '$1 $2'), value);
    const withBoundaries = withAcronymBoundaries
        .replace(/([.?!,:;])([A-Za-z])/g, '$1 $2')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2');
    return withBoundaries
        .split(/(\s+|[-/()"':;,.!?]+)/)
        .map((part) => humanizeAnalysisToken(part, aggressive))
        .join('');
}
function shouldAggressivelyHumanize(value) {
    const collapsedTokens = value.match(/[A-Za-z]{12,}/g) ?? [];
    if (collapsedTokens.length === 0) {
        return false;
    }
    const whitespaceCount = (value.match(/\s/g) ?? []).length;
    return whitespaceCount <= Math.max(2, Math.floor(value.length * 0.12))
        || collapsedTokens.some((token) => token.length >= 16);
}
function humanizeAnalysisToken(token, aggressive) {
    if (!token || !/[A-Za-z]/.test(token) || /\s+/.test(token) || /[-/()"':;,.!?]+/.test(token)) {
        return token;
    }
    if (!/^[A-Za-z]+$/.test(token) || !aggressive || token.length < 12) {
        return token;
    }
    const segmented = segmentCollapsedWord(token.toLowerCase());
    if (!segmented) {
        return token;
    }
    return segmented
        .split(' ')
        .map((word, index) => {
        const acronym = HUMANIZE_ACRONYMS.get(word);
        if (acronym) {
            return acronym;
        }
        if (index === 0 && /^[A-Z]/.test(token)) {
            return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
        }
        return word;
    })
        .join(' ');
}
function segmentCollapsedWord(value) {
    if (value.length < 12 || !/^[a-z]+$/.test(value)) {
        return null;
    }
    const best = Array(value.length + 1).fill(null);
    best[0] = { score: 0, words: [] };
    for (let start = 0; start < value.length; start += 1) {
        const current = best[start];
        if (!current) {
            continue;
        }
        for (let end = start + 1; end <= Math.min(value.length, start + 24); end += 1) {
            const part = value.slice(start, end);
            const isKnown = HUMANIZE_DICTIONARY.has(part);
            const nextScore = current.score + (isKnown
                ? (part.length * part.length) + 8
                : part.length <= 2
                    ? -100
                    : part.length === 3
                        ? -24
                        : -(part.length * 4));
            const existing = best[end];
            if (!existing || nextScore > existing.score) {
                best[end] = { score: nextScore, words: [...current.words, part] };
            }
        }
    }
    const result = best[value.length];
    if (!result || result.words.length < 2) {
        return null;
    }
    const knownChars = result.words.filter((word) => HUMANIZE_DICTIONARY.has(word)).join('').length;
    const unknownWords = result.words.filter((word) => !HUMANIZE_DICTIONARY.has(word));
    if (knownChars < Math.floor(value.length * 0.72)) {
        return null;
    }
    if (unknownWords.some((word) => word.length < 4)) {
        return null;
    }
    if (unknownWords.length > 1) {
        return null;
    }
    return result.words.join(' ');
}
