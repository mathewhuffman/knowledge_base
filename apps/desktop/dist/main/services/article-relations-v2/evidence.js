"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCoverageText = normalizeCoverageText;
exports.tokenizeCoverageText = tokenizeCoverageText;
exports.buildCoverageMatchQuery = buildCoverageMatchQuery;
exports.roundCoverageScore = roundCoverageScore;
exports.estimateFtsConfidence = estimateFtsConfidence;
exports.overlapRatio = overlapRatio;
exports.addFamilyEvidence = addFamilyEvidence;
exports.finalizeFamilyAggregate = finalizeFamilyAggregate;
const TOKEN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}][\p{L}\p{N}\p{M}'’._:-]*/gu;
const MAX_EVIDENCE_PER_FAMILY = 10;
function normalizeCoverageText(input) {
    return typeof input === 'string'
        ? input.trim().toLowerCase().replace(/\s+/g, ' ')
        : '';
}
function tokenizeCoverageText(input) {
    const normalized = normalizeCoverageText(input);
    if (!normalized) {
        return [];
    }
    const matches = normalized.match(TOKEN_PATTERN) ?? [];
    return matches.filter((token) => token.length >= 2 || /[^\u0000-\u007f]/.test(token));
}
function buildCoverageMatchQuery(input) {
    const tokens = tokenizeCoverageText(input)
        .map((token) => token.replace(/[^\p{L}\p{N}\p{M}]+/gu, ''))
        .filter((token) => token.length >= 2 || /[^\u0000-\u007f]/.test(token))
        .slice(0, 12);
    if (tokens.length === 0) {
        return undefined;
    }
    return tokens
        .map((token) => `${escapeFtsToken(token)}*`)
        .join(' OR ');
}
function roundCoverageScore(value) {
    return Number(value.toFixed(3));
}
function estimateFtsConfidence(rank) {
    if (typeof rank !== 'number' || !Number.isFinite(rank)) {
        return 0.45;
    }
    return Math.max(0.2, Math.min(1, 1 / (1 + Math.abs(rank))));
}
function overlapRatio(queryText, candidateText) {
    const queryTokens = tokenizeCoverageText(queryText);
    const candidateTokens = new Set(tokenizeCoverageText(candidateText));
    if (queryTokens.length === 0 || candidateTokens.size === 0) {
        return 0;
    }
    let matched = 0;
    for (const token of queryTokens) {
        if (candidateTokens.has(token)) {
            matched += 1;
        }
    }
    return matched / queryTokens.length;
}
function addFamilyEvidence(aggregate, evidence) {
    const existing = aggregate.evidence.find((entry) => entry.evidenceType === evidence.evidenceType
        && entry.sourceRef === evidence.sourceRef
        && entry.snippet === evidence.snippet);
    if (existing) {
        existing.weight = Math.max(existing.weight, evidence.weight);
        if (existing.metadata === undefined && evidence.metadata !== undefined) {
            existing.metadata = evidence.metadata;
        }
        return;
    }
    aggregate.evidence.push({
        ...evidence,
        weight: roundCoverageScore(evidence.weight)
    });
    aggregate.evidence.sort((left, right) => right.weight - left.weight);
    if (aggregate.evidence.length > MAX_EVIDENCE_PER_FAMILY) {
        aggregate.evidence.length = MAX_EVIDENCE_PER_FAMILY;
    }
}
function finalizeFamilyAggregate(aggregate) {
    const distinctTypes = new Set(aggregate.evidence.map((entry) => entry.evidenceType));
    const totalWeight = aggregate.evidence.reduce((sum, entry) => sum + entry.weight, 0);
    const corroborationBonus = Math.min(0.45, Math.max(0, distinctTypes.size - 1) * 0.08);
    const finalScore = roundCoverageScore(totalWeight + corroborationBonus);
    return {
        familyId: aggregate.familyId,
        localeVariantIds: Array.from(aggregate.localeVariantIds).sort(),
        title: aggregate.title,
        externalKey: aggregate.externalKey,
        finalScore,
        relationEligible: determineRelationEligibility(aggregate.evidence, finalScore),
        evidence: aggregate.evidence
            .slice()
            .sort((left, right) => right.weight - left.weight)
            .map(({ signalStrength: _signalStrength, ...entry }) => entry)
    };
}
function determineRelationEligibility(evidence, finalScore) {
    const strongTypes = new Set(evidence
        .filter((entry) => entry.signalStrength === 'strong')
        .map((entry) => entry.evidenceType));
    const mediumTypes = new Set(evidence
        .filter((entry) => entry.signalStrength === 'medium')
        .map((entry) => entry.evidenceType));
    if (strongTypes.has('explicit_link') || strongTypes.has('manual_relation')) {
        return true;
    }
    if (strongTypes.size >= 2) {
        return true;
    }
    if (strongTypes.size >= 1 && mediumTypes.size >= 2) {
        return true;
    }
    if ((strongTypes.has('external_key_exact') || strongTypes.has('alias_exact')) && mediumTypes.size >= 1 && finalScore >= 1.35) {
        return true;
    }
    return false;
}
function escapeFtsToken(token) {
    return token.replace(/"/g, ' ').trim() || '""';
}
