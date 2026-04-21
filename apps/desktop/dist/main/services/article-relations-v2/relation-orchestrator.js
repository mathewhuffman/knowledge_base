"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArticleRelationsV2RelationOrchestrator = void 0;
const node_crypto_1 = require("node:crypto");
const shared_types_1 = require("@kb-vault/shared-types");
const types_1 = require("./types");
const COVERAGE_MIN_SCORE = 0.12;
const PERSISTED_RELATION_MIN_SCORE = 1.1;
const COVERAGE_MAX_RESULTS_MULTIPLIER = 3;
const COVERAGE_MAX_RESULTS_FLOOR = 18;
const MAX_EVIDENCE_PER_RELATION = 12;
class ArticleRelationsV2RelationOrchestrator {
    queryService;
    constructor(queryService) {
        this.queryService = queryService;
    }
    refreshRelations(input) {
        const thresholdsUsed = buildRefreshThresholds(input.limitPerArticle);
        const candidatePairKeys = new Set();
        const manualPairKeys = this.loadActiveManualPairKeys(input.workspaceDb, input.workspaceId);
        const suppressionPairKeys = this.loadSuppressionPairKeys(input.workspaceDb, input.workspaceId);
        const persistedCandidates = new Map();
        if (input.indexDb && input.seedFamilyIds.length > 0) {
            for (const seedFamilyId of input.seedFamilyIds) {
                const response = this.queryService.queryCoverage({
                    workspaceDb: input.workspaceDb,
                    indexDb: input.indexDb,
                    request: {
                        workspaceId: input.workspaceId,
                        seedFamilyIds: [seedFamilyId],
                        maxResults: thresholdsUsed.coverageMaxResultsPerFamily,
                        minScore: thresholdsUsed.coverageMinScore,
                        includeEvidence: true
                    }
                });
                for (const result of response.results) {
                    if (!result.familyId || result.familyId === seedFamilyId) {
                        continue;
                    }
                    const pair = normalizeFamilyPair(seedFamilyId, result.familyId);
                    const pairKey = pairToKey(pair.leftFamilyId, pair.rightFamilyId);
                    candidatePairKeys.add(pairKey);
                    if (!result.relationEligible || result.finalScore < thresholdsUsed.persistedRelationMinScore) {
                        continue;
                    }
                    if (manualPairKeys.has(pairKey)) {
                        continue;
                    }
                    const status = suppressionPairKeys.has(pairKey)
                        ? shared_types_1.ArticleRelationStatus.SUPPRESSED
                        : shared_types_1.ArticleRelationStatus.ACTIVE;
                    const existing = persistedCandidates.get(pairKey);
                    const nextEvidence = mergeEvidence(existing?.evidence ?? [], result.evidence);
                    persistedCandidates.set(pairKey, {
                        leftFamilyId: pair.leftFamilyId,
                        rightFamilyId: pair.rightFamilyId,
                        relationType: mergeRelationTypes(existing?.relationType, deriveRelationType(nextEvidence)),
                        strengthScore: Math.max(existing?.strengthScore ?? 0, normalizeStrengthScore(result.finalScore)),
                        status,
                        evidence: nextEvidence
                    });
                }
            }
        }
        const selectedActiveCandidates = selectActiveCandidates(Array.from(persistedCandidates.values()).filter((candidate) => candidate.status === shared_types_1.ArticleRelationStatus.ACTIVE), input.limitPerArticle);
        const selectedKeys = new Set(selectedActiveCandidates.map((candidate) => pairToKey(candidate.leftFamilyId, candidate.rightFamilyId)));
        const suppressedCandidates = Array.from(persistedCandidates.values()).filter((candidate) => candidate.status === shared_types_1.ArticleRelationStatus.SUPPRESSED);
        const finalCandidates = [
            ...selectedActiveCandidates,
            ...suppressedCandidates.filter((candidate) => !selectedKeys.has(pairToKey(candidate.leftFamilyId, candidate.rightFamilyId)))
        ];
        this.replacePersistedInferredRelations(input, finalCandidates);
        return {
            totalArticles: input.seedFamilyIds.length,
            candidatePairs: candidatePairKeys.size,
            inferredRelations: finalCandidates.length,
            manualRelations: this.loadActiveManualRelationCount(input.workspaceDb, input.workspaceId),
            suppressedRelations: this.loadSuppressionCount(input.workspaceDb, input.workspaceId),
            engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
            indexedDocumentCount: input.indexedDocumentCount,
            staleDocumentCount: input.staleDocumentCount,
            degradedMode: input.degradedMode,
            thresholdsUsed
        };
    }
    replacePersistedInferredRelations(input, candidates) {
        const previousInferredIds = input.workspaceDb.all(`SELECT id
         FROM article_relations
        WHERE workspace_id = @workspaceId
          AND origin = @origin`, {
            workspaceId: input.workspaceId,
            origin: shared_types_1.ArticleRelationOrigin.INFERRED
        });
        input.workspaceDb.exec('BEGIN IMMEDIATE');
        try {
            if (previousInferredIds.length > 0) {
                const params = {};
                const placeholders = previousInferredIds.map((row, index) => {
                    const key = `id${index}`;
                    params[key] = row.id;
                    return `@${key}`;
                }).join(', ');
                input.workspaceDb.run(`DELETE FROM article_relation_evidence
            WHERE relation_id IN (${placeholders})`, params);
                input.workspaceDb.run(`DELETE FROM article_relations
            WHERE id IN (${placeholders})`, params);
            }
            const insertRelation = input.workspaceDb.prepare(`INSERT INTO article_relations (
           id, workspace_id, left_family_id, right_family_id, relation_type, direction, strength_score, status, origin, run_id, created_at, updated_at
         ) VALUES (
           @id, @workspaceId, @leftFamilyId, @rightFamilyId, @relationType, @direction, @strengthScore, @status, @origin, @runId, @createdAt, @updatedAt
         )`);
            const insertEvidence = input.workspaceDb.prepare(`INSERT INTO article_relation_evidence (
           id, relation_id, evidence_type, source_ref, snippet, weight, metadata_json
         ) VALUES (
           @id, @relationId, @evidenceType, @sourceRef, @snippet, @weight, @metadataJson
         )`);
            for (const candidate of candidates) {
                const relationId = (0, node_crypto_1.randomUUID)();
                insertRelation.run({
                    id: relationId,
                    workspaceId: input.workspaceId,
                    leftFamilyId: candidate.leftFamilyId,
                    rightFamilyId: candidate.rightFamilyId,
                    relationType: candidate.relationType,
                    direction: shared_types_1.ArticleRelationDirection.BIDIRECTIONAL,
                    strengthScore: candidate.strengthScore,
                    status: candidate.status,
                    origin: shared_types_1.ArticleRelationOrigin.INFERRED,
                    runId: input.runId,
                    createdAt: input.startedAtUtc,
                    updatedAt: input.startedAtUtc
                });
                for (const evidence of candidate.evidence.slice(0, MAX_EVIDENCE_PER_RELATION)) {
                    insertEvidence.run({
                        id: (0, node_crypto_1.randomUUID)(),
                        relationId,
                        evidenceType: evidence.evidenceType,
                        sourceRef: evidence.sourceRef ?? null,
                        snippet: evidence.snippet ?? null,
                        weight: Number(evidence.weight.toFixed(3)),
                        metadataJson: evidence.metadata ? JSON.stringify(evidence.metadata) : null
                    });
                }
            }
            input.workspaceDb.exec('COMMIT');
        }
        catch (error) {
            input.workspaceDb.exec('ROLLBACK');
            throw error;
        }
    }
    loadActiveManualPairKeys(workspaceDb, workspaceId) {
        const rows = workspaceDb.all(`SELECT left_family_id as leftFamilyId,
              right_family_id as rightFamilyId
         FROM article_relations
        WHERE workspace_id = @workspaceId
          AND origin = @origin
          AND status = @status`, {
            workspaceId,
            origin: shared_types_1.ArticleRelationOrigin.MANUAL,
            status: shared_types_1.ArticleRelationStatus.ACTIVE
        });
        return new Set(rows.map((row) => pairToKey(row.leftFamilyId, row.rightFamilyId)));
    }
    loadActiveManualRelationCount(workspaceDb, workspaceId) {
        const row = workspaceDb.get(`SELECT COUNT(*) as total
         FROM article_relations
        WHERE workspace_id = @workspaceId
          AND origin = @origin
          AND status = @status`, {
            workspaceId,
            origin: shared_types_1.ArticleRelationOrigin.MANUAL,
            status: shared_types_1.ArticleRelationStatus.ACTIVE
        });
        return row?.total ?? 0;
    }
    loadSuppressionPairKeys(workspaceDb, workspaceId) {
        const rows = workspaceDb.all(`SELECT left_family_id as leftFamilyId,
              right_family_id as rightFamilyId
         FROM article_relation_overrides
        WHERE workspace_id = @workspaceId
          AND override_type = 'force_remove'`, { workspaceId });
        return new Set(rows.map((row) => pairToKey(row.leftFamilyId, row.rightFamilyId)));
    }
    loadSuppressionCount(workspaceDb, workspaceId) {
        const row = workspaceDb.get(`SELECT COUNT(*) as total
         FROM article_relation_overrides
        WHERE workspace_id = @workspaceId
          AND override_type = 'force_remove'`, { workspaceId });
        return row?.total ?? 0;
    }
}
exports.ArticleRelationsV2RelationOrchestrator = ArticleRelationsV2RelationOrchestrator;
function selectActiveCandidates(candidates, limitPerArticle) {
    const perFamilyCounts = new Map();
    const selected = [];
    const sorted = candidates
        .slice()
        .sort((left, right) => right.strengthScore - left.strengthScore
        || left.leftFamilyId.localeCompare(right.leftFamilyId)
        || left.rightFamilyId.localeCompare(right.rightFamilyId));
    for (const candidate of sorted) {
        const leftCount = perFamilyCounts.get(candidate.leftFamilyId) ?? 0;
        const rightCount = perFamilyCounts.get(candidate.rightFamilyId) ?? 0;
        if (leftCount >= limitPerArticle || rightCount >= limitPerArticle) {
            continue;
        }
        selected.push(candidate);
        perFamilyCounts.set(candidate.leftFamilyId, leftCount + 1);
        perFamilyCounts.set(candidate.rightFamilyId, rightCount + 1);
    }
    return selected;
}
function buildRefreshThresholds(limitPerArticle) {
    return {
        limitPerArticle,
        coverageMinScore: COVERAGE_MIN_SCORE,
        persistedRelationMinScore: PERSISTED_RELATION_MIN_SCORE,
        coverageMaxResultsPerFamily: Math.max(COVERAGE_MAX_RESULTS_FLOOR, limitPerArticle * COVERAGE_MAX_RESULTS_MULTIPLIER)
    };
}
function deriveRelationType(evidence) {
    const evidenceTypes = new Set(evidence.map((entry) => entry.evidenceType));
    if (evidenceTypes.has('explicit_link')
        || (evidenceTypes.has('same_section')
            && (evidenceTypes.has('title_fts')
                || evidenceTypes.has('heading_fts')
                || evidenceTypes.has('body_chunk_fts')
                || evidenceTypes.has('external_key_exact')
                || evidenceTypes.has('alias_exact')))) {
        return shared_types_1.ArticleRelationType.SAME_WORKFLOW;
    }
    return shared_types_1.ArticleRelationType.SEE_ALSO;
}
function mergeRelationTypes(left, right) {
    if (left === shared_types_1.ArticleRelationType.SAME_WORKFLOW || right === shared_types_1.ArticleRelationType.SAME_WORKFLOW) {
        return shared_types_1.ArticleRelationType.SAME_WORKFLOW;
    }
    return left ?? right;
}
function mergeEvidence(left, right) {
    const merged = new Map();
    for (const evidence of [...left, ...right]) {
        const key = `${evidence.evidenceType}::${evidence.sourceRef ?? ''}::${evidence.snippet ?? ''}`;
        const existing = merged.get(key);
        if (!existing || evidence.weight > existing.weight) {
            merged.set(key, {
                ...evidence,
                weight: Number(evidence.weight.toFixed(3))
            });
        }
    }
    return Array.from(merged.values())
        .sort((leftEntry, rightEntry) => rightEntry.weight - leftEntry.weight)
        .slice(0, MAX_EVIDENCE_PER_RELATION);
}
function normalizeStrengthScore(finalScore) {
    return Number(Math.max(0, Math.min(1, finalScore / 2.2)).toFixed(3));
}
function normalizeFamilyPair(sourceFamilyId, targetFamilyId) {
    return sourceFamilyId.localeCompare(targetFamilyId) <= 0
        ? { leftFamilyId: sourceFamilyId, rightFamilyId: targetFamilyId }
        : { leftFamilyId: targetFamilyId, rightFamilyId: sourceFamilyId };
}
function pairToKey(leftFamilyId, rightFamilyId) {
    return `${leftFamilyId}:${rightFamilyId}`;
}
