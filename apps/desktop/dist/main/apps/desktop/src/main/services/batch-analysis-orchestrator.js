"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchAnalysisOrchestrator = void 0;
const node_crypto_1 = require("node:crypto");
function buildProposalTemplateGuidanceSection(template, usageInstruction) {
    if (!template) {
        return '';
    }
    return [
        'Active proposal creation template guidance:',
        usageInstruction,
        `Template name: ${template.name}`,
        `Language: ${template.language}`,
        template.description?.trim() ? `Description: ${template.description.trim()}` : '',
        `Prompt template:\n${template.promptTemplate.trim()}`,
        template.toneRules.trim() ? `Tone rules:\n${template.toneRules.trim()}` : '',
        template.examples?.trim() ? `Examples:\n${template.examples.trim()}` : ''
    ].filter(Boolean).join('\n');
}
class BatchAnalysisOrchestrator {
    workspaceRepository;
    constructor(workspaceRepository) {
        this.workspaceRepository = workspaceRepository;
    }
    async normalizePlanTargets(params) {
        const repairs = [];
        const unresolvedTargetIssues = [];
        const textualTargetReplacements = [];
        const normalizedItems = await Promise.all(params.plan.items.map(async (item) => {
            if (item.action === 'create'
                || (item.targetType !== 'article' && item.targetType !== 'article_family')) {
                return item;
            }
            const trimmedTargetArticleId = item.targetArticleId?.trim();
            const trimmedTargetFamilyId = item.targetFamilyId?.trim();
            const resolvedVariant = await this.tryGetLocaleVariant(params.workspaceId, trimmedTargetArticleId);
            if (item.targetType === 'article_family') {
                if (!trimmedTargetFamilyId) {
                    if (!resolvedVariant) {
                        unresolvedTargetIssues.push(trimmedTargetArticleId
                            ? `Plan item ${item.planItemId} (${item.targetTitle}) references missing locale variant ${trimmedTargetArticleId} and has no targetFamilyId for deterministic repair.`
                            : `Plan item ${item.planItemId} (${item.targetTitle}) is missing targetFamilyId, so the KB target cannot be validated deterministically.`);
                        return item;
                    }
                    if (resolvedVariant.status !== 'live') {
                        unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) points at locale variant ${resolvedVariant.id}, but that variant is ${resolvedVariant.status} instead of live.`);
                        return item;
                    }
                    const resolvedFamilyExternalKey = await this.getFamilyExternalKey(params.workspaceId, resolvedVariant.familyId);
                    if (resolvedFamilyExternalKey?.startsWith('proposal-')) {
                        unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) points at proposal-scoped draft family ${resolvedFamilyExternalKey}, which is generated draft output rather than live KB coverage.`);
                        return item;
                    }
                    repairs.push(`Filled missing target family ID for ${item.targetTitle} with ${resolvedVariant.familyId} from locale variant ${resolvedVariant.id}.`);
                    return {
                        ...item,
                        targetFamilyId: resolvedVariant.familyId
                    };
                }
                const resolvedFamilyExternalKey = await this.getFamilyExternalKey(params.workspaceId, trimmedTargetFamilyId);
                if (resolvedFamilyExternalKey?.startsWith('proposal-')) {
                    unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) points at proposal-scoped draft family ${resolvedFamilyExternalKey}, which is generated draft output rather than live KB coverage.`);
                    return item;
                }
                const liveFamilyVariants = await this.getLiveFamilyVariants(params.workspaceId, trimmedTargetFamilyId);
                if (liveFamilyVariants.length === 0) {
                    unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) points at family ${trimmedTargetFamilyId}, but that family does not resolve to any live locale variants.`);
                    return item;
                }
                if (resolvedVariant && resolvedVariant.familyId !== trimmedTargetFamilyId) {
                    unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) points at locale variant ${resolvedVariant.id}, but that article belongs to family ${resolvedVariant.familyId} instead of ${trimmedTargetFamilyId}.`);
                    return item;
                }
                if (resolvedVariant && resolvedVariant.status !== 'live') {
                    unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) points at locale variant ${resolvedVariant.id}, but that variant is ${resolvedVariant.status} instead of live.`);
                }
                return item;
            }
            const liveFamilyVariants = await this.getLiveFamilyVariants(params.workspaceId, item.targetFamilyId);
            const uniqueLiveFamilyVariant = liveFamilyVariants.length === 1
                ? liveFamilyVariants[0]
                : null;
            if (!item.targetArticleId?.trim()) {
                if (uniqueLiveFamilyVariant) {
                    repairs.push(`Filled missing target article ID for ${item.targetTitle} with ${uniqueLiveFamilyVariant.id} from family ${uniqueLiveFamilyVariant.familyId}.`);
                    return {
                        ...item,
                        targetArticleId: uniqueLiveFamilyVariant.id,
                        targetFamilyId: uniqueLiveFamilyVariant.familyId
                    };
                }
                if (item.targetFamilyId?.trim()) {
                    unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) is missing targetArticleId and family ${item.targetFamilyId} does not resolve to a single live locale variant.`);
                }
                else {
                    unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) is missing targetArticleId and targetFamilyId, so the KB target cannot be validated deterministically.`);
                }
                return item;
            }
            if (resolvedVariant) {
                const resolvedUniqueLiveFamilyVariant = uniqueLiveFamilyVariant
                    ?? await this.getUniqueLiveFamilyVariant(params.workspaceId, resolvedVariant.familyId);
                if (item.targetFamilyId?.trim() && resolvedVariant.familyId !== item.targetFamilyId.trim()) {
                    if (resolvedUniqueLiveFamilyVariant) {
                        repairs.push(`Corrected target article ID for ${item.targetTitle} from ${item.targetArticleId} to ${resolvedUniqueLiveFamilyVariant.id} because the submitted article belonged to the wrong family.`);
                        textualTargetReplacements.push({ from: item.targetArticleId, to: resolvedUniqueLiveFamilyVariant.id });
                        return {
                            ...item,
                            targetArticleId: resolvedUniqueLiveFamilyVariant.id,
                            targetFamilyId: resolvedUniqueLiveFamilyVariant.familyId
                        };
                    }
                    unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) points at article ${item.targetArticleId}, but that article belongs to family ${resolvedVariant.familyId} instead of ${item.targetFamilyId}.`);
                    return item;
                }
                if (resolvedVariant.status !== 'live') {
                    if (resolvedUniqueLiveFamilyVariant && resolvedUniqueLiveFamilyVariant.id !== resolvedVariant.id) {
                        repairs.push(`Corrected non-live target article ID for ${item.targetTitle} from ${item.targetArticleId} to ${resolvedUniqueLiveFamilyVariant.id} because the submitted locale variant is ${resolvedVariant.status}.`);
                        textualTargetReplacements.push({ from: item.targetArticleId, to: resolvedUniqueLiveFamilyVariant.id });
                        return {
                            ...item,
                            targetArticleId: resolvedUniqueLiveFamilyVariant.id,
                            targetFamilyId: resolvedUniqueLiveFamilyVariant.familyId
                        };
                    }
                    unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) points at locale variant ${item.targetArticleId}, but that variant is ${resolvedVariant.status} instead of live.`);
                    return item;
                }
                const resolvedFamilyExternalKey = await this.getFamilyExternalKey(params.workspaceId, resolvedVariant.familyId);
                if (resolvedFamilyExternalKey?.startsWith('proposal-')) {
                    unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) points at proposal-scoped draft family ${resolvedFamilyExternalKey}, which is generated draft output rather than live KB coverage.`);
                    return item;
                }
                if (!item.targetFamilyId?.trim()) {
                    repairs.push(`Filled missing target family ID for ${item.targetTitle} with ${resolvedVariant.familyId} from locale variant ${resolvedVariant.id}.`);
                    return {
                        ...item,
                        targetFamilyId: resolvedVariant.familyId
                    };
                }
                return item;
            }
            if (uniqueLiveFamilyVariant) {
                repairs.push(`Corrected invalid target article ID for ${item.targetTitle} from ${item.targetArticleId} to ${uniqueLiveFamilyVariant.id}.`);
                textualTargetReplacements.push({ from: item.targetArticleId, to: uniqueLiveFamilyVariant.id });
                return {
                    ...item,
                    targetArticleId: uniqueLiveFamilyVariant.id,
                    targetFamilyId: uniqueLiveFamilyVariant.familyId
                };
            }
            if (item.targetFamilyId?.trim()) {
                unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) references missing locale variant ${item.targetArticleId}, and family ${item.targetFamilyId} does not resolve to a single live locale variant.`);
            }
            else {
                unresolvedTargetIssues.push(`Plan item ${item.planItemId} (${item.targetTitle}) references missing locale variant ${item.targetArticleId} and has no targetFamilyId for deterministic repair.`);
            }
            return item;
        }));
        const normalizedPlan = applyTextualTargetReplacementsToPlan({
            plan: {
                ...params.plan,
                items: normalizedItems
            },
            replacements: textualTargetReplacements
        });
        return {
            plan: normalizedPlan,
            repairs: dedupePlanReviewStrings(repairs).slice(0, 20),
            unresolvedTargetIssues: dedupePlanReviewStrings(unresolvedTargetIssues).slice(0, 20)
        };
    }
    normalizePlanBatchReferences(params) {
        const rows = extractUploadedPbiRows(params.uploadedPbis);
        if (rows.length === 0) {
            return {
                plan: params.plan,
                repairs: [],
                unresolvedReferenceIssues: []
            };
        }
        const rowsById = new Map(rows.map((row) => [row.pbiId, row]));
        const repairs = [];
        const unresolvedReferenceIssues = [];
        const normalizePbiId = (value, label) => {
            const trimmed = value.trim();
            if (rowsById.has(trimmed)) {
                return trimmed;
            }
            const repaired = resolveUploadedPbiId(trimmed, rows);
            if (repaired) {
                repairs.push(`Corrected ${label} PBI ID from ${trimmed} to ${repaired}.`);
                return repaired;
            }
            unresolvedReferenceIssues.push(`${label} references unknown PBI ID ${trimmed}.`);
            return trimmed;
        };
        const coverage = params.plan.coverage.map((item, index) => ({
            ...item,
            pbiId: normalizePbiId(item.pbiId, `Coverage row ${index + 1}`)
        }));
        const items = params.plan.items.map((item) => {
            const normalizedPbiIds = item.pbiIds.map((pbiId, index) => normalizePbiId(pbiId, `Plan item ${item.planItemId} pbiIds[${index}]`));
            const canonicalRows = normalizedPbiIds
                .map((pbiId) => rowsById.get(pbiId) ?? null)
                .filter((row) => Boolean(row));
            let fallbackEvidenceIndex = 0;
            const evidence = item.evidence.map((entry) => {
                if (entry.kind !== 'pbi') {
                    return entry;
                }
                const explicitRow = resolveUploadedPbiRowFromEvidenceRef(entry.ref, rowsById, rows);
                const row = explicitRow ?? canonicalRows[fallbackEvidenceIndex] ?? canonicalRows[canonicalRows.length - 1];
                if (!explicitRow) {
                    fallbackEvidenceIndex += 1;
                }
                if (!row) {
                    return entry;
                }
                const canonicalRef = buildCanonicalPbiEvidenceRef(row);
                if (entry.ref !== canonicalRef) {
                    repairs.push(`Canonicalized ${item.planItemId} evidence ref from ${entry.ref} to ${canonicalRef}.`);
                }
                return {
                    ...entry,
                    ref: canonicalRef
                };
            });
            return {
                ...item,
                pbiIds: normalizedPbiIds,
                evidence
            };
        });
        return {
            plan: {
                ...params.plan,
                coverage,
                items
            },
            repairs: dedupePlanReviewStrings(repairs).slice(0, 40),
            unresolvedReferenceIssues: dedupePlanReviewStrings(unresolvedReferenceIssues).slice(0, 20)
        };
    }
    async startIteration(params) {
        const iteration = await this.workspaceRepository.createBatchAnalysisIteration({
            workspaceId: params.workspaceId,
            batchId: params.batchId,
            stage: 'planning',
            role: 'planner',
            status: 'running',
            summary: 'Synthesizing initial batch plan.',
            agentModelId: params.agentModelId,
            startedAtUtc: params.startedAtUtc
        });
        await this.workspaceRepository.recordBatchAnalysisStageEvent({
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId: iteration.workspaceId,
            batchId: iteration.batchId,
            iterationId: iteration.id,
            iteration: iteration.iteration,
            stage: iteration.stage,
            role: iteration.role,
            eventType: 'iteration_started',
            status: iteration.status,
            summary: iteration.summary,
            sessionId: iteration.sessionId,
            agentModelId: iteration.agentModelId,
            approvedPlanId: iteration.approvedPlanId,
            lastReviewVerdict: iteration.lastReviewVerdict,
            outstandingDiscoveredWorkCount: iteration.outstandingDiscoveredWorkCount,
            executionCounts: iteration.executionCounts,
            createdAtUtc: params.startedAtUtc
        });
        return iteration;
    }
    async recordPlan(plan) {
        return this.workspaceRepository.recordBatchAnalysisPlan(plan);
    }
    async recordReview(review) {
        return this.workspaceRepository.recordBatchPlanReview(review);
    }
    async recordAmendment(amendment) {
        return this.workspaceRepository.recordBatchPlanAmendment(amendment);
    }
    async recordFinalReview(review) {
        return this.workspaceRepository.recordBatchFinalReview(review);
    }
    async transitionIteration(params) {
        const iteration = await this.workspaceRepository.updateBatchAnalysisIteration({
            workspaceId: params.workspaceId,
            iterationId: params.iterationId,
            stage: params.stage,
            role: params.role,
            status: 'running',
            summary: params.summary,
            agentModelId: params.agentModelId,
            sessionId: params.sessionId,
            approvedPlanId: params.approvedPlanId,
            lastReviewVerdict: params.lastReviewVerdict
        });
        await this.workspaceRepository.recordBatchAnalysisStageEvent({
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId: iteration.workspaceId,
            batchId: iteration.batchId,
            iterationId: iteration.id,
            iteration: iteration.iteration,
            stage: iteration.stage,
            role: iteration.role,
            eventType: 'stage_transition',
            status: iteration.status,
            summary: iteration.summary,
            sessionId: iteration.sessionId,
            agentModelId: iteration.agentModelId,
            approvedPlanId: iteration.approvedPlanId,
            lastReviewVerdict: iteration.lastReviewVerdict,
            outstandingDiscoveredWorkCount: iteration.outstandingDiscoveredWorkCount,
            executionCounts: iteration.executionCounts,
            createdAtUtc: iteration.updatedAtUtc
        });
        return iteration;
    }
    async finalizeLegacyExecution(params) {
        const { workerReport, executionCounts } = await this.recordWorkerPass({
            iteration: params.iteration,
            workspaceId: params.workspaceId,
            batchId: params.batchId,
            agentModelId: params.agentModelId,
            approvedPlan: params.approvedPlan,
            result: params.result,
            summary: params.summary,
            discoveredWork: params.discoveredWork
        });
        const nextStage = params.result.status === 'ok'
            ? 'approved'
            : params.result.status === 'canceled'
                ? 'canceled'
                : 'failed';
        const nextStatus = params.result.status === 'ok'
            ? 'completed'
            : params.result.status === 'canceled'
                ? 'canceled'
                : 'failed';
        const updatedIteration = await this.workspaceRepository.updateBatchAnalysisIteration({
            workspaceId: params.workspaceId,
            iterationId: params.iteration.id,
            stage: nextStage,
            role: params.result.status === 'ok' ? 'final-reviewer' : 'worker',
            status: nextStatus,
            summary: workerReport.summary,
            agentModelId: params.agentModelId,
            sessionId: params.result.sessionId,
            outstandingDiscoveredWorkCount: workerReport.discoveredWork.length,
            executionCounts,
            endedAtUtc: params.result.endedAtUtc
        });
        return {
            iteration: updatedIteration,
            workerReport
        };
    }
    async recordWorkerPass(params) {
        const proposals = await this.workspaceRepository.listBatchProposalRecords(params.workspaceId, params.batchId, {
            includeStaged: true,
            openOnly: true
        });
        const executedItems = this.buildExecutedItems(params.approvedPlan.items, proposals, params.result);
        await this.workspaceRepository.updateBatchAnalysisPlanItemStatuses({
            workspaceId: params.workspaceId,
            planId: params.approvedPlan.id,
            statuses: executedItems.map((item) => ({
                planItemId: item.planItemId,
                executionStatus: this.mapWorkerItemStatusToPlanStatus(item.status)
            }))
        });
        const executionCounts = this.buildExecutionCountsFromResults(executedItems);
        const discoveredWork = params.discoveredWork ?? [];
        const workerReport = {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId: params.workspaceId,
            batchId: params.batchId,
            iterationId: params.iteration.id,
            iteration: params.iteration.iteration,
            stage: params.result.status === 'ok' ? 'building' : 'reworking',
            role: 'worker',
            summary: params.summary ?? params.result.message ?? `Legacy worker execution finished with status ${params.result.status}.`,
            status: params.discoveredWork && params.discoveredWork.length > 0
                ? 'needs_amendment'
                : params.result.status === 'ok'
                    ? 'completed'
                    : params.result.status === 'canceled'
                        ? 'blocked'
                        : 'failed',
            planId: params.approvedPlan.id,
            executedItems,
            discoveredWork,
            blockerNotes: params.result.status === 'ok' ? [] : [params.result.message ?? `Worker exited with ${params.result.status}.`],
            createdAtUtc: params.result.endedAtUtc,
            agentModelId: params.agentModelId,
            sessionId: params.result.sessionId
        };
        await this.workspaceRepository.recordBatchWorkerExecutionReport(workerReport);
        return { workerReport, executionCounts };
    }
    buildExecutionCounts(actions) {
        const counts = {
            total: actions.length,
            create: 0,
            edit: 0,
            retire: 0,
            noImpact: 0,
            executed: actions.length,
            blocked: 0,
            rejected: 0
        };
        for (const action of actions) {
            if (action === 'create') {
                counts.create += 1;
            }
            else if (action === 'edit') {
                counts.edit += 1;
            }
            else if (action === 'retire') {
                counts.retire += 1;
            }
            else {
                counts.noImpact += 1;
            }
        }
        return counts;
    }
    buildExecutionCountsFromResults(results) {
        const counts = {
            total: results.length,
            create: 0,
            edit: 0,
            retire: 0,
            noImpact: 0,
            executed: 0,
            blocked: 0,
            rejected: 0
        };
        for (const result of results) {
            if (result.action === 'create')
                counts.create += 1;
            else if (result.action === 'edit')
                counts.edit += 1;
            else if (result.action === 'retire')
                counts.retire += 1;
            else
                counts.noImpact += 1;
            if (result.status === 'executed')
                counts.executed += 1;
            if (result.status === 'blocked')
                counts.blocked += 1;
        }
        return counts;
    }
    buildExecutedItems(planItems, proposals, result) {
        const remainingProposals = [...proposals].sort((left, right) => {
            const leftCurrentSession = left.sessionId === result.sessionId ? 1 : 0;
            const rightCurrentSession = right.sessionId === result.sessionId ? 1 : 0;
            if (leftCurrentSession !== rightCurrentSession) {
                return rightCurrentSession - leftCurrentSession;
            }
            if (left.updatedAtUtc !== right.updatedAtUtc) {
                return right.updatedAtUtc.localeCompare(left.updatedAtUtc);
            }
            return right.queueOrder - left.queueOrder;
        });
        return planItems.map((item) => {
            if (item.action === 'no_impact') {
                return {
                    planItemId: item.planItemId,
                    action: item.action,
                    targetTitle: item.targetTitle,
                    status: result.status === 'ok' ? 'executed' : 'skipped',
                    note: 'No-impact item accounted for without proposal execution.'
                };
            }
            if (result.status !== 'ok') {
                return {
                    planItemId: item.planItemId,
                    action: item.action,
                    targetTitle: item.targetTitle,
                    status: 'blocked',
                    note: result.message ?? `Worker ended with status ${result.status}.`
                };
            }
            const normalizedTargetTitle = this.normalizeTitle(item.targetTitle);
            const currentSessionMatches = remainingProposals.filter((proposal) => proposal.sessionId === result.sessionId
                && proposal.action === item.action
                && this.normalizeTitle(proposal.targetTitle ?? '') === normalizedTargetTitle);
            const currentSessionExactMatch = currentSessionMatches.find((proposal) => doesPlacementMeetRequirement(proposal.suggestedPlacement, item.suggestedPlacement));
            if (currentSessionExactMatch) {
                const matchIndex = remainingProposals.findIndex((proposal) => proposal.id === currentSessionExactMatch.id);
                const match = remainingProposals.splice(matchIndex, 1)[0];
                return {
                    planItemId: item.planItemId,
                    action: item.action,
                    targetTitle: item.targetTitle,
                    status: 'executed',
                    proposalId: match.id,
                    artifactIds: [match.id],
                    note: `Matched proposal generated in the current worker session for ${match.targetTitle ?? item.targetTitle}.`
                };
            }
            if (currentSessionMatches.length > 0) {
                return {
                    planItemId: item.planItemId,
                    action: item.action,
                    targetTitle: item.targetTitle,
                    status: 'blocked',
                    artifactIds: currentSessionMatches.map((proposal) => proposal.id),
                    note: `Current worker session generated proposal output for "${item.targetTitle}" but it did not preserve the approved placement (${describePlacementRequirement(item.suggestedPlacement)}).`
                };
            }
            const conflictingCurrentSessionProposals = remainingProposals.filter((proposal) => proposal.sessionId === result.sessionId
                && this.normalizeTitle(proposal.targetTitle ?? '') === normalizedTargetTitle
                && proposal.action !== item.action);
            if (conflictingCurrentSessionProposals.length > 0) {
                return {
                    planItemId: item.planItemId,
                    action: item.action,
                    targetTitle: item.targetTitle,
                    status: 'blocked',
                    artifactIds: conflictingCurrentSessionProposals.map((proposal) => proposal.id),
                    note: `Current worker session produced ${conflictingCurrentSessionProposals.map((proposal) => proposal.action).join(', ')} proposal output for "${item.targetTitle}", which conflicts with the approved ${item.action} action.`
                };
            }
            const fallbackMatches = remainingProposals.filter((proposal) => proposal.action === item.action
                && this.normalizeTitle(proposal.targetTitle ?? '') === normalizedTargetTitle);
            const fallbackExactMatch = fallbackMatches.find((proposal) => doesPlacementMeetRequirement(proposal.suggestedPlacement, item.suggestedPlacement));
            if (fallbackExactMatch) {
                const fallbackMatchIndex = remainingProposals.findIndex((proposal) => proposal.id === fallbackExactMatch.id);
                const match = remainingProposals.splice(fallbackMatchIndex, 1)[0];
                return {
                    planItemId: item.planItemId,
                    action: item.action,
                    targetTitle: item.targetTitle,
                    status: 'executed',
                    proposalId: match.id,
                    artifactIds: [match.id],
                    note: `Matched persisted proposal output for ${match.targetTitle ?? item.targetTitle}.`
                };
            }
            if (fallbackMatches.length > 0) {
                return {
                    planItemId: item.planItemId,
                    action: item.action,
                    targetTitle: item.targetTitle,
                    status: 'blocked',
                    artifactIds: fallbackMatches.map((proposal) => proposal.id),
                    note: `Persisted proposal output for "${item.targetTitle}" exists, but it did not preserve the approved placement (${describePlacementRequirement(item.suggestedPlacement)}).`
                };
            }
            return {
                planItemId: item.planItemId,
                action: item.action,
                targetTitle: item.targetTitle,
                status: 'blocked',
                note: `No proposal matched approved plan item "${item.targetTitle}".`
            };
        });
    }
    mapWorkerItemStatusToPlanStatus(status) {
        if (status === 'executed') {
            return 'executed';
        }
        if (status === 'blocked') {
            return 'blocked';
        }
        return 'pending';
    }
    normalizeTitle(value) {
        return humanizeReadableText(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    }
    buildPlannerPrompt(params) {
        const hasUserDirectives = batchContextHasUserDirectives(params.batchContext);
        return [
            'Return only valid JSON.',
            'Create a complete structured batch analysis plan.',
            'Each candidate PBI must be accounted for in coverage.',
            'Mark a PBI as `covered` whenever the plan fully accounts for it, including when the work is a net-new article create.',
            'Use `gap` only when required KB work is still unresolved after planning and the plan does not yet fully cover that PBI.',
            'Use plan items to represent create, edit, retire, or no_impact outcomes.',
            'Prefer edit work over create work when the deterministic prefetch shows strong existing article matches unless the evidence clearly supports net-new KB coverage.',
            'Prefer create work when a topic cluster has deterministic search coverage but no meaningful existing article match; do not force unrelated edits just to avoid net-new articles.',
            'Do not execute proposals or mutate KB content in this stage.',
            'Use the deterministic planner prefetch as your primary evidence base for planning decisions; in most cases it already contains the evidence you need.',
            'Only issue new KB lookups when you still have a concrete unresolved ambiguity after reviewing the prefetch, or when a cluster is genuinely missing the evidence required to choose create versus edit versus no-impact.',
            'If the prefetch already gives you enough evidence for a cluster, reuse it directly instead of re-proving the same point with more searches.',
            'If a deterministic prefetch query already returned zero meaningful matches, treat that zero-result evidence as final unless you have a materially different query.',
            'If a question can be resolved by revising the plan with the existing evidence, revise the plan and do not emit a user-input question.',
            'Emit `requiresUserInput: true` only when the user must decide scope, intent, sequencing, or another product decision the planner cannot infer safely.',
            'Every create plan item must include `suggestedPlacement` with a stable `categoryId`. Include `categoryName` plus optional `sectionId` and `sectionName` when the article belongs in a section.',
            'For create placement, use existing article evidence first and call `list_categories` or `list_sections` only when you need authoritative Zendesk placement IDs or need to verify a section choice.',
            hasUserDirectives
                ? 'User directives inside the batch context summary are mandatory. Guaranteed edit families must be represented by concrete edit items for each listed live locale variant, guaranteed creates must preserve their requested `targetLocale` and any requested placement, and create-versus-edit ambiguity on a guaranteed create must be surfaced as user input instead of guessed.'
                : '',
            params.resolvedUserAnswers && params.resolvedUserAnswers.length > 0
                ? 'Incorporate every resolved user answer below into the revised plan. Close, remove, or resolve those questions instead of carrying them forward unchanged.'
                : '',
            'JSON shape:',
            '{"summary":string,"coverage":[{"pbiId":string,"outcome":"covered"|"gap"|"no_impact"|"blocked","planItemIds":string[],"notes"?:string}],"items":[{"planItemId":string,"pbiIds":string[],"action":"create"|"edit"|"retire"|"no_impact","targetType":"article"|"article_family"|"article_set"|"new_article"|"unknown","targetArticleId"?:string,"targetFamilyId"?:string,"targetTitle":string,"targetLocale"?:string,"suggestedPlacement"?:{"categoryId"?:string,"categoryName"?:string,"sectionId"?:string,"sectionName"?:string,"notes"?:string},"reason":string,"evidence":[{"kind":"pbi"|"article"|"search"|"review"|"transcript"|"other","ref":string,"summary":string}],"confidence":number,"dependsOn"?:string[],"executionStatus":"pending"}],"questions":[{"id"?:string,"prompt":string,"reason":string,"requiresUserInput":boolean,"linkedPbiIds":string[],"linkedPlanItemIds":string[],"linkedDiscoveryIds":string[]}],"openQuestions"?:string[]}',
            buildProposalTemplateGuidanceSection(params.proposalTemplate, 'Use this active template when reasoning about the expected structure, tone, and placeholder conventions of any proposal HTML the worker will later draft.'),
            'Batch context summary:',
            JSON.stringify(compactBatchContextForPrompt(params.batchContext), null, 2),
            'Uploaded PBI summary:',
            JSON.stringify(compactUploadedPbisForPrompt(params.uploadedPbis), null, 2),
            params.plannerPrefetch ? `Deterministic planner prefetch:\n${JSON.stringify(compactPlannerPrefetchForPrompt(params.plannerPrefetch), null, 2)}` : '',
            params.priorPlan ? `Prior plan summary:\n${JSON.stringify(compactPlanForPrompt(params.priorPlan), null, 2)}` : '',
            params.reviewDelta ? `Reviewer delta summary:\n${JSON.stringify(compactReviewDeltaForPrompt(params.reviewDelta), null, 2)}` : '',
            params.resolvedUserAnswers && params.resolvedUserAnswers.length > 0
                ? `Resolved user answers:\n${JSON.stringify({ resolvedUserAnswers: params.resolvedUserAnswers }, null, 2)}`
                : ''
        ].filter(Boolean).join('\n\n');
    }
    buildPlannerRepairPrompt(params) {
        return [
            'Return only valid JSON.',
            'Your previous planner response was not valid planner JSON and could not be parsed.',
            `Parser error: ${params.parseError}`,
            'Rewrite the planner answer as complete JSON for the same batch context and JSON shape from the prior message.',
            'Original planner instructions and batch context:',
            params.originalPrompt,
            'Do not add narration, markdown fences, or explanation outside the JSON object.',
            'Previous invalid planner output:',
            params.priorOutput
        ].join('\n\n');
    }
    buildPlannerJsonRetryPrompt(params) {
        return [
            'Return only valid JSON.',
            'Your previous planner answer did not arrive as a complete planner JSON object.',
            `Parser error: ${params.parseError}`,
            'Do not do any more KB discovery for this retry.',
            'Restate the same plan as complete planner JSON using the prior batch context, deterministic prefetch, and any partial draft below as the source of truth.',
            'Original planner instructions and batch context:',
            params.originalPrompt,
            'Do not add narration, markdown fences, or explanation outside the JSON object.',
            'Previous partial planner output:',
            params.priorOutput
        ].join('\n\n');
    }
    buildPlanReviewerPrompt(params) {
        const hasUserDirectives = batchContextHasUserDirectives(params.batchContext);
        return [
            'Return only valid JSON.',
            'Review the submitted batch plan for completeness and correctness.',
            'Actively search for missing article work beyond the submitted plan.',
            'Use the deterministic planner prefetch to challenge the submitted plan, especially when existing article matches suggest edits instead of net-new article creates.',
            'Do not approve a create-only or create-heavy plan when strong existing article matches are present unless the plan explicitly accounts for why those existing articles are not edit targets.',
            'Also do not approve an edit-only or edit-heavy plan when deterministic search coverage shows a topic cluster with no meaningful existing article match and the plan never explains why net-new documentation is unnecessary.',
            'Treat `gap` or `blocked` coverage as unresolved scope. Do not approve a plan while any PBI still has unresolved coverage.',
            'A PBI satisfied by a net-new article create should still be marked `covered`, not `gap`.',
            'Planner and deterministic questions are candidate questions, not automatically user-facing questions. You are the gatekeeper for whether any question should actually be surfaced to the user.',
            'You may keep a candidate question pending, resolve it, dismiss it, rewrite it while preserving its `id`, or add a brand-new question even if the planner emitted none.',
            'Omission alone does not dismiss or resolve a candidate question. If you want to clear a candidate question, return it with `status: "resolved"` or `status: "dismissed"`.',
            'If the plan contains unresolved questions that require a user scope or product decision, set verdict to `needs_user_input` and return the final structured questions.',
            'Prefer `needs_user_input` when a short user answer would safely unblock the planner.',
            'Use `needs_revision` when the planner can fix the issue without user help.',
            'Reserve `needs_human_review` for issues that cannot be reduced to concrete user-answerable questions.',
            'If you return `needs_user_input`, include at least one final structured question with `requiresUserInput: true` and `status: "pending"`.',
            'Do not execute proposals or mutate KB content in this stage.',
            'Do not approve create plan items that still omit a stable category placement. Section placement is optional, but when a section is proposed it should be represented with authoritative Zendesk IDs.',
            hasUserDirectives
                ? 'Treat batch-context user directives as hard requirements. Do not approve a plan that drops guaranteed edit locales, guaranteed creates, or requested guaranteed-create placement, and pause for user input instead of guessing when a guaranteed create conflicts with an existing live article.'
                : '',
            'JSON shape:',
            '{"summary":string,"verdict":"approved"|"needs_revision"|"needs_user_input"|"needs_human_review","didAccountForEveryPbi":boolean,"hasMissingCreates":boolean,"hasMissingEdits":boolean,"hasTargetIssues":boolean,"hasOverlapOrConflict":boolean,"foundAdditionalArticleWork":boolean,"underScopedKbImpact":boolean,"delta":{"summary":string,"requestedChanges":string[],"missingPbiIds":string[],"missingCreates":string[],"missingEdits":string[],"additionalArticleWork":string[],"targetCorrections":string[],"overlapConflicts":string[]},"questions":[{"id"?:string,"prompt":string,"reason":string,"requiresUserInput":boolean,"status":"pending"|"answered"|"resolved"|"dismissed","linkedPbiIds":string[],"linkedPlanItemIds":string[],"linkedDiscoveryIds":string[]}]}',
            buildProposalTemplateGuidanceSection(params.proposalTemplate, 'Use this active template as the review baseline for proposal structure, tone, and placeholder conventions whenever you judge whether the plan is likely to produce acceptable proposal HTML.'),
            'Batch context summary:',
            JSON.stringify(compactBatchContextForPrompt(params.batchContext), null, 2),
            'Uploaded PBI summary:',
            JSON.stringify(compactUploadedPbisForPrompt(params.uploadedPbis), null, 2),
            params.plannerPrefetch ? `Deterministic planner prefetch:\n${JSON.stringify(compactPlannerPrefetchForPrompt(params.plannerPrefetch), null, 2)}` : '',
            `Candidate questions for reviewer adjudication:\n${JSON.stringify((params.candidateQuestions ?? []).map((question) => compactPlanQuestionForPrompt(question)), null, 2)}`,
            'Submitted plan summary:',
            JSON.stringify(compactPlanForPrompt(params.plan), null, 2)
        ].join('\n\n');
    }
    buildReviewCandidateQuestions(params) {
        const baseQuestions = mergeStructuredQuestions(params.existingQuestions ?? [], params.plan.questions ?? []);
        const existingPromptKeys = new Set(baseQuestions.map((question) => normalizeQuestionPromptKey(question.prompt)));
        const deterministicQuestions = this.synthesizeDeterministicReviewCandidateQuestions({
            plan: params.plan,
            plannerPrefetch: params.plannerPrefetch,
            discoveredWork: params.discoveredWork
        }).filter((question) => !existingPromptKeys.has(normalizeQuestionPromptKey(question.prompt)));
        const userDirectiveQuestions = this.synthesizeUserDirectiveReviewCandidateQuestions({
            plan: params.plan,
            batchContext: params.batchContext
        }).filter((question) => !existingPromptKeys.has(normalizeQuestionPromptKey(question.prompt)));
        return mergeStructuredQuestions(baseQuestions, [...deterministicQuestions, ...userDirectiveQuestions]);
    }
    synthesizeDeterministicReviewCandidateQuestions(params) {
        if (!params.plannerPrefetch) {
            return [];
        }
        const createdAtUtc = new Date().toISOString();
        const assessments = collectDeterministicClusterCoverageAssessments({
            plan: params.plan,
            plannerPrefetch: params.plannerPrefetch,
            normalizeTitle: (value) => this.normalizeTitle(value)
        });
        return mergeStructuredQuestions(assessments.flatMap((assessment) => {
            const linkedPlanItemIds = assessment.relatedPlanItems.map((item) => item.planItemId);
            const linkedDiscoveryIds = collectLinkedDiscoveryIds({
                discoveredWork: params.discoveredWork ?? [],
                linkedPbiIds: assessment.pbiIds,
                targetTitles: [assessment.displayTitle, ...assessment.strongArticleTitles],
                normalizeTitle: (value) => this.normalizeTitle(value)
            });
            const deterministicQuestions = [];
            if (shouldSynthesizeIncludeOrDeferQuestion(assessment)) {
                deterministicQuestions.push({
                    id: createDeterministicQuestionId('include-or-defer', assessment.clusterId, assessment.displayTitle),
                    prompt: `Should ${assessment.displayTitle} be included in this batch or explicitly deferred?`,
                    reason: assessment.hasStrongArticleSignal
                        ? `Deterministic review found plausible KB impact for ${assessment.displayTitle}, but the plan does not yet make an explicit include-versus-defer scope decision for this batch.`
                        : `Deterministic review found no meaningful existing article match for ${assessment.displayTitle}, so the reviewer should decide whether this clearly real work belongs in this batch or should be explicitly deferred.`,
                    requiresUserInput: true,
                    linkedPbiIds: assessment.pbiIds,
                    linkedPlanItemIds,
                    linkedDiscoveryIds,
                    status: 'pending',
                    createdAtUtc
                });
            }
            if (shouldSynthesizeStandaloneVsFoldQuestion(assessment)) {
                const existingArticleTitle = assessment.strongArticleTitles[0];
                if (existingArticleTitle) {
                    deterministicQuestions.push({
                        id: createDeterministicQuestionId('standalone-vs-fold', assessment.clusterId, `${assessment.displayTitle}:${existingArticleTitle}`),
                        prompt: `Should ${assessment.displayTitle} be a standalone article or folded into ${existingArticleTitle}?`,
                        reason: `Deterministic review found both net-new article coverage and a strong existing article match (${existingArticleTitle}), so editorial intent should decide whether to create a standalone article or expand the existing article.`,
                        requiresUserInput: true,
                        linkedPbiIds: assessment.pbiIds,
                        linkedPlanItemIds,
                        linkedDiscoveryIds,
                        status: 'pending',
                        createdAtUtc
                    });
                }
            }
            return deterministicQuestions;
        }));
    }
    synthesizeUserDirectiveReviewCandidateQuestions(params) {
        const { guaranteedCreateConflicts } = extractBatchUserDirectives(params.batchContext);
        if (guaranteedCreateConflicts.length === 0) {
            return [];
        }
        const createdAtUtc = new Date().toISOString();
        return guaranteedCreateConflicts.map((conflict) => {
            const linkedPlanItemIds = params.plan.items
                .filter((item) => item.action === 'create'
                && this.normalizeTitle(item.targetTitle ?? '') === this.normalizeTitle(conflict.title))
                .map((item) => item.planItemId);
            const strongestMatch = conflict.matches[0];
            return {
                id: createDeterministicQuestionId('guaranteed-create-conflict', conflict.clientId, conflict.title),
                prompt: `You requested guaranteed creation of ${conflict.title} (${conflict.targetLocale}), but ${strongestMatch?.title ?? 'an existing live article'} may already cover that topic. Should we still create a new article or convert this to an edit?`,
                reason: `Guaranteed create target ${conflict.title} (${conflict.targetLocale}) strongly overlaps existing live KB coverage, so the system needs a user decision before approving create-versus-edit scope.`,
                requiresUserInput: true,
                linkedPbiIds: [],
                linkedPlanItemIds,
                linkedDiscoveryIds: [],
                status: 'pending',
                createdAtUtc
            };
        });
    }
    normalizeStructuredQuestions(params) {
        const createdAtUtc = new Date().toISOString();
        const structuredQuestions = Array.isArray(params.rawQuestions)
            ? params.rawQuestions.flatMap((question) => {
                if (!question || typeof question !== 'object') {
                    return [];
                }
                const candidate = question;
                const prompt = typeof candidate.prompt === 'string' ? humanizeReadableText(candidate.prompt) : '';
                if (!prompt) {
                    return [];
                }
                const reason = typeof candidate.reason === 'string'
                    ? humanizeReadableText(candidate.reason)
                    : (params.sourceRole === 'planner'
                        ? 'Planner needs a user decision before the plan can be completed.'
                        : 'Reviewer needs a user decision before the plan can be approved.');
                const answer = typeof candidate.answer === 'string' && candidate.answer.trim()
                    ? humanizeReadableText(candidate.answer)
                    : undefined;
                const status = normalizeQuestionStatus(candidate.status, answer);
                const normalizedQuestion = {
                    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : (0, node_crypto_1.randomUUID)(),
                    questionSetId: typeof candidate.questionSetId === 'string' && candidate.questionSetId.trim()
                        ? candidate.questionSetId.trim()
                        : undefined,
                    prompt,
                    reason,
                    requiresUserInput: candidate.requiresUserInput !== false,
                    linkedPbiIds: Array.isArray(candidate.linkedPbiIds)
                        ? candidate.linkedPbiIds.filter((entry) => typeof entry === 'string')
                        : [],
                    linkedPlanItemIds: Array.isArray(candidate.linkedPlanItemIds)
                        ? candidate.linkedPlanItemIds.filter((entry) => typeof entry === 'string')
                        : [],
                    linkedDiscoveryIds: Array.isArray(candidate.linkedDiscoveryIds)
                        ? candidate.linkedDiscoveryIds.filter((entry) => typeof entry === 'string')
                        : [],
                    answer,
                    status,
                    createdAtUtc: typeof candidate.createdAtUtc === 'string' ? candidate.createdAtUtc : createdAtUtc,
                    answeredAtUtc: typeof candidate.answeredAtUtc === 'string' ? candidate.answeredAtUtc : undefined
                };
                if (params.preserveMergeMeta) {
                    normalizedQuestion.__mergeMeta = {
                        explicitAnswer: hasOwn(candidate, 'answer'),
                        explicitAnsweredAtUtc: hasOwn(candidate, 'answeredAtUtc'),
                        explicitId: hasOwn(candidate, 'id'),
                        explicitPrompt: hasOwn(candidate, 'prompt'),
                        explicitQuestionSetId: hasOwn(candidate, 'questionSetId'),
                        explicitReason: hasOwn(candidate, 'reason'),
                        explicitRequiresUserInput: hasOwn(candidate, 'requiresUserInput'),
                        explicitStatus: hasOwn(candidate, 'status')
                    };
                }
                return [normalizedQuestion];
            })
            : [];
        if (structuredQuestions.length > 0) {
            return mergeStructuredQuestions(structuredQuestions);
        }
        const legacyQuestions = Array.isArray(params.legacyOpenQuestions)
            ? params.legacyOpenQuestions
                .filter((entry) => typeof entry === 'string')
                .map((prompt) => ({
                id: (0, node_crypto_1.randomUUID)(),
                prompt: humanizeReadableText(prompt),
                reason: params.sourceRole === 'planner'
                    ? 'Planner flagged this open question before plan approval.'
                    : 'Reviewer flagged this open question before plan approval.',
                requiresUserInput: true,
                linkedPbiIds: [],
                linkedPlanItemIds: [],
                linkedDiscoveryIds: [],
                status: 'pending',
                createdAtUtc,
                ...(params.preserveMergeMeta
                    ? {
                        __mergeMeta: {
                            explicitPrompt: true,
                            explicitReason: true,
                            explicitRequiresUserInput: true,
                            explicitStatus: true
                        }
                    }
                    : {})
            }))
            : [];
        return mergeStructuredQuestions(legacyQuestions);
    }
    parsePlannerResult(params) {
        const parsed = this.parseJsonObject(params.resultText);
        const items = Array.isArray(parsed.items) ? parsed.items : [];
        const coverage = Array.isArray(parsed.coverage) ? parsed.coverage : [];
        if (items.length === 0) {
            throw new Error('Planner returned no plan items');
        }
        if (coverage.length === 0) {
            throw new Error('Planner returned no coverage records');
        }
        const questions = this.normalizeStructuredQuestions({
            rawQuestions: parsed.questions,
            legacyOpenQuestions: parsed.openQuestions,
            sourceRole: 'planner'
        });
        return {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId: params.workspaceId,
            batchId: params.batchId,
            iterationId: params.iteration.id,
            iteration: params.iteration.iteration,
            stage: params.planVersion > 1 ? 'plan_revision' : 'planning',
            role: 'planner',
            verdict: 'draft',
            planVersion: params.planVersion,
            summary: typeof parsed.summary === 'string' ? humanizeReadableText(parsed.summary) : `Plan version ${params.planVersion}`,
            coverage: coverage.map((item) => normalizePlanCoverage(item)),
            items: items.map((item) => ({
                ...item,
                targetTitle: humanizeReadableText(item.targetTitle),
                targetLocale: typeof item.targetLocale === 'string' && item.targetLocale.trim()
                    ? item.targetLocale.trim().toLowerCase()
                    : undefined,
                suggestedPlacement: normalizeBatchPlanPlacement(item.suggestedPlacement),
                reason: humanizeReadableText(item.reason),
                evidence: Array.isArray(item.evidence)
                    ? item.evidence.map((evidence) => ({
                        ...evidence,
                        summary: humanizeReadableText(evidence.summary)
                    }))
                    : []
            })),
            questions,
            openQuestions: serializeOpenQuestionPrompts(questions, parsed.openQuestions),
            createdAtUtc: new Date().toISOString(),
            supersedesPlanId: params.supersedesPlanId,
            agentModelId: params.agentModelId,
            sessionId: params.sessionId
        };
    }
    parsePlanReviewResult(params) {
        const parsed = this.parseJsonObject(params.resultText);
        const verdict = parsed.verdict === 'approved'
            || parsed.verdict === 'needs_human_review'
            || parsed.verdict === 'needs_user_input'
            ? parsed.verdict
            : 'needs_revision';
        const questions = this.normalizeStructuredQuestions({
            rawQuestions: parsed.questions,
            sourceRole: 'plan-reviewer',
            preserveMergeMeta: true
        });
        return {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId: params.workspaceId,
            batchId: params.batchId,
            iterationId: params.iteration.id,
            iteration: params.iteration.iteration,
            stage: params.stage ?? 'plan_reviewing',
            role: 'plan-reviewer',
            verdict,
            summary: typeof parsed.summary === 'string' ? humanizeReadableText(parsed.summary) : 'Plan review completed.',
            didAccountForEveryPbi: Boolean(parsed.didAccountForEveryPbi),
            hasMissingCreates: Boolean(parsed.hasMissingCreates),
            hasMissingEdits: Boolean(parsed.hasMissingEdits),
            hasTargetIssues: Boolean(parsed.hasTargetIssues),
            hasOverlapOrConflict: Boolean(parsed.hasOverlapOrConflict),
            foundAdditionalArticleWork: Boolean(parsed.foundAdditionalArticleWork),
            underScopedKbImpact: Boolean(parsed.underScopedKbImpact),
            delta: parsed.delta && typeof parsed.delta === 'object'
                ? humanizePlanReviewDelta(parsed.delta)
                : undefined,
            questions,
            createdAtUtc: new Date().toISOString(),
            planId: params.plan.id,
            agentModelId: params.agentModelId,
            sessionId: params.sessionId
        };
    }
    reconcilePlanQuestionState(plan, reviewQuestions) {
        const questions = mergeStructuredQuestions(plan.questions ?? [], reviewQuestions ?? []);
        return {
            ...plan,
            questions,
            openQuestions: serializeOpenQuestionPrompts(questions, plan.openQuestions)
        };
    }
    validatePlanForExecution(params) {
        let finalQuestions = mergeStructuredQuestions(params.candidateQuestions ?? params.plan.questions ?? [], params.review.questions ?? []);
        const directiveValidation = this.validateUserDirectedTargets({
            plan: params.plan,
            finalQuestions,
            batchContext: params.batchContext
        });
        finalQuestions = mergeStructuredQuestions(finalQuestions, directiveValidation.blockingQuestions);
        const blockingUserInputQuestions = collectBlockingUserInputQuestions(finalQuestions);
        const invalidCoverageReasons = this.validateApprovedPlan(params.plan).reasons;
        const conflictingTargets = this.findDeterministicTargetConflicts(params.plan);
        const unresolvedTargetIssues = dedupePlanReviewStrings(params.unresolvedTargetIssues ?? []).slice(0, 20);
        const unresolvedReferenceIssues = dedupePlanReviewStrings(params.unresolvedReferenceIssues ?? []).slice(0, 20);
        const advisoryMissingEditTargets = this.findLikelyMissingEditTargets(params.plan, params.plannerPrefetch);
        const advisoryMissingCreateTargets = this.findLikelyMissingCreateTargets(params.plan, params.plannerPrefetch);
        const hasObjectiveBlockingIssues = invalidCoverageReasons.length > 0
            || directiveValidation.missingGuaranteedEditTargets.length > 0
            || directiveValidation.missingGuaranteedCreateTargets.length > 0
            || conflictingTargets.length > 0
            || unresolvedTargetIssues.length > 0
            || unresolvedReferenceIssues.length > 0;
        return {
            finalQuestions,
            ok: blockingUserInputQuestions.length === 0 && !hasObjectiveBlockingIssues,
            needsUserInput: blockingUserInputQuestions.length > 0,
            blockingUserInputQuestions,
            invalidCoverageReasons: dedupePlanReviewStrings([
                ...invalidCoverageReasons,
                ...directiveValidation.missingGuaranteedEditTargets,
                ...directiveValidation.missingGuaranteedCreateTargets
            ]).slice(0, 20),
            conflictingTargets,
            unresolvedTargetIssues,
            unresolvedReferenceIssues,
            advisoryMissingEditTargets,
            advisoryMissingCreateTargets,
            missingGuaranteedEditTargets: directiveValidation.missingGuaranteedEditTargets,
            missingGuaranteedCreateTargets: directiveValidation.missingGuaranteedCreateTargets
        };
    }
    applyDeterministicPlanReviewGuard(params) {
        const validation = this.validatePlanForExecution(params);
        const missingEditTargets = validation.advisoryMissingEditTargets;
        const missingCreateTargets = validation.advisoryMissingCreateTargets;
        const hadBlockingQuestions = validation.blockingUserInputQuestions.length > 0;
        const malformedNeedsUserInput = params.review.verdict === 'needs_user_input'
            && validation.blockingUserInputQuestions.length === 0;
        if (hadBlockingQuestions) {
            const issueSummaries = [
                `waiting on ${validation.blockingUserInputQuestions.length} reviewer-approved required user answer(s)`
            ];
            const requestedChanges = [
                ...(params.review.delta?.requestedChanges ?? []),
                `Pause for user input and re-plan after answers are provided: ${validation.blockingUserInputQuestions.map((question) => question.prompt).join('; ')}`
            ];
            if (params.review.verdict === 'needs_human_review') {
                issueSummaries.push('reviewer escalation retained after user-answerable questions are resolved');
                requestedChanges.push('Reviewer requested human review, but deterministic validation found concrete user-answerable blocking questions that should be resolved first.');
            }
            return {
                review: {
                    ...params.review,
                    verdict: 'needs_user_input',
                    summary: params.review.verdict === 'needs_user_input'
                        ? params.review.summary
                        : `Deterministic review found concrete user-answerable blocking questions: ${issueSummaries.join('; ')}.`,
                    questions: validation.finalQuestions,
                    delta: mergePlanReviewDelta(params.review.delta, {
                        summary: params.review.verdict === 'needs_human_review'
                            ? 'Reviewer escalated, but deterministic validation found concrete user-answerable questions that should be answered first.'
                            : 'Deterministic validation confirmed the final reviewer-approved blocking questions that require user input.',
                        requestedChanges,
                        targetCorrections: [],
                        overlapConflicts: [],
                        additionalArticleWork: [],
                        missingPbiIds: [],
                        missingCreates: [],
                        missingEdits: []
                    })
                },
                forcedRevision: false,
                blockingUserInputQuestions: validation.blockingUserInputQuestions,
                invalidCoverageReasons: validation.invalidCoverageReasons,
                missingEditTargets,
                missingCreateTargets,
                conflictingTargets: validation.conflictingTargets,
                unresolvedTargetIssues: validation.unresolvedTargetIssues,
                unresolvedReferenceIssues: validation.unresolvedReferenceIssues
            };
        }
        if (validation.ok && !malformedNeedsUserInput) {
            return {
                review: {
                    ...params.review,
                    questions: validation.finalQuestions
                },
                forcedRevision: false,
                blockingUserInputQuestions: validation.blockingUserInputQuestions,
                invalidCoverageReasons: validation.invalidCoverageReasons,
                missingEditTargets,
                missingCreateTargets,
                conflictingTargets: validation.conflictingTargets,
                unresolvedTargetIssues: validation.unresolvedTargetIssues,
                unresolvedReferenceIssues: validation.unresolvedReferenceIssues
            };
        }
        if (params.review.verdict === 'needs_human_review') {
            return {
                review: {
                    ...params.review,
                    questions: validation.finalQuestions
                },
                forcedRevision: false,
                blockingUserInputQuestions: validation.blockingUserInputQuestions,
                invalidCoverageReasons: validation.invalidCoverageReasons,
                missingEditTargets,
                missingCreateTargets,
                conflictingTargets: validation.conflictingTargets,
                unresolvedTargetIssues: validation.unresolvedTargetIssues,
                unresolvedReferenceIssues: validation.unresolvedReferenceIssues
            };
        }
        const existingDelta = params.review.delta ?? {
            summary: '',
            requestedChanges: [],
            missingPbiIds: [],
            missingCreates: [],
            missingEdits: [],
            additionalArticleWork: [],
            targetCorrections: [],
            overlapConflicts: []
        };
        const requestedChanges = [...existingDelta.requestedChanges];
        const additionalArticleWork = [...existingDelta.additionalArticleWork];
        const targetCorrections = [...existingDelta.targetCorrections];
        const overlapConflicts = [...existingDelta.overlapConflicts];
        const issueSummaries = [];
        if (malformedNeedsUserInput) {
            issueSummaries.push('reviewer requested user input without returning any final pending required questions');
            requestedChanges.push('Return at least one final pending required structured question when using needs_user_input, or switch the verdict to needs_revision/needs_human_review.');
        }
        if (validation.invalidCoverageReasons.length > 0) {
            issueSummaries.push(`unresolved PBI coverage remains in ${validation.invalidCoverageReasons.length} place(s)`);
            requestedChanges.push(...validation.invalidCoverageReasons);
            additionalArticleWork.push(...validation.invalidCoverageReasons);
        }
        if (validation.missingGuaranteedEditTargets.length > 0) {
            issueSummaries.push(`guaranteed edit coverage is missing for ${validation.missingGuaranteedEditTargets.length} locale target(s)`);
            requestedChanges.push(...validation.missingGuaranteedEditTargets);
        }
        if (validation.missingGuaranteedCreateTargets.length > 0) {
            issueSummaries.push(`guaranteed create coverage is missing for ${validation.missingGuaranteedCreateTargets.length} target(s)`);
            requestedChanges.push(...validation.missingGuaranteedCreateTargets);
        }
        if (validation.conflictingTargets.length > 0) {
            const titlesSummary = validation.conflictingTargets.join(', ');
            issueSummaries.push(`overlapping target coverage for ${titlesSummary}`);
            requestedChanges.push(`Resolve duplicate or conflicting plan items targeting the same article: ${titlesSummary}`);
            targetCorrections.push(...validation.conflictingTargets);
            overlapConflicts.push(...validation.conflictingTargets.map((title) => `Multiple plan items target ${title}`));
        }
        if (validation.unresolvedTargetIssues.length > 0) {
            issueSummaries.push(`invalid or unresolved KB targets in ${validation.unresolvedTargetIssues.length} plan item(s)`);
            requestedChanges.push(...validation.unresolvedTargetIssues);
            targetCorrections.push(...validation.unresolvedTargetIssues);
        }
        if (validation.unresolvedReferenceIssues.length > 0) {
            issueSummaries.push(`invalid or unresolved batch references in ${validation.unresolvedReferenceIssues.length} plan item(s)`);
            requestedChanges.push(...validation.unresolvedReferenceIssues);
        }
        const summaryText = issueSummaries.join('; ');
        const forcedRevision = params.review.verdict === 'approved'
            && (validation.invalidCoverageReasons.length > 0
                || validation.conflictingTargets.length > 0
                || validation.unresolvedTargetIssues.length > 0
                || validation.unresolvedReferenceIssues.length > 0);
        return {
            review: {
                ...params.review,
                verdict: 'needs_revision',
                summary: (forcedRevision || malformedNeedsUserInput)
                    ? `Deterministic review found ${summaryText}.`
                    : params.review.summary,
                hasMissingCreates: params.review.hasMissingCreates || validation.missingGuaranteedCreateTargets.length > 0,
                hasMissingEdits: params.review.hasMissingEdits || validation.missingGuaranteedEditTargets.length > 0,
                hasTargetIssues: params.review.hasTargetIssues || validation.invalidCoverageReasons.length > 0 || validation.conflictingTargets.length > 0 || validation.unresolvedTargetIssues.length > 0,
                hasOverlapOrConflict: params.review.hasOverlapOrConflict || validation.conflictingTargets.length > 0,
                foundAdditionalArticleWork: params.review.foundAdditionalArticleWork || validation.invalidCoverageReasons.length > 0,
                underScopedKbImpact: params.review.underScopedKbImpact || validation.invalidCoverageReasons.length > 0,
                questions: validation.finalQuestions,
                delta: {
                    summary: existingDelta.summary?.trim()
                        ? existingDelta.summary
                        : `Deterministic review found ${summaryText}.`,
                    requestedChanges: dedupePlanReviewStrings(requestedChanges).slice(0, 20),
                    missingPbiIds: dedupePlanReviewStrings([...existingDelta.missingPbiIds, ...validation.invalidCoverageReasons, ...validation.unresolvedReferenceIssues]).slice(0, 20),
                    missingCreates: dedupePlanReviewStrings([...existingDelta.missingCreates, ...validation.missingGuaranteedCreateTargets]).slice(0, 20),
                    missingEdits: dedupePlanReviewStrings([...existingDelta.missingEdits, ...validation.missingGuaranteedEditTargets]).slice(0, 20),
                    additionalArticleWork: dedupePlanReviewStrings(additionalArticleWork).slice(0, 20),
                    targetCorrections: dedupePlanReviewStrings(targetCorrections).slice(0, 20),
                    overlapConflicts: dedupePlanReviewStrings(overlapConflicts).slice(0, 20)
                }
            },
            forcedRevision,
            blockingUserInputQuestions: validation.blockingUserInputQuestions,
            invalidCoverageReasons: validation.invalidCoverageReasons,
            missingEditTargets,
            missingCreateTargets,
            conflictingTargets: validation.conflictingTargets,
            unresolvedTargetIssues: validation.unresolvedTargetIssues,
            unresolvedReferenceIssues: validation.unresolvedReferenceIssues
        };
    }
    async buildWorkerPrompt(plan, extraInstructionsOrOptions) {
        const extraInstructions = typeof extraInstructionsOrOptions === 'string'
            ? extraInstructionsOrOptions
            : extraInstructionsOrOptions?.extraInstructions;
        const batchContext = typeof extraInstructionsOrOptions === 'string'
            ? undefined
            : extraInstructionsOrOptions?.batchContext;
        const proposalTemplate = typeof extraInstructionsOrOptions === 'string'
            ? undefined
            : extraInstructionsOrOptions?.proposalTemplate;
        const hasUserDirectives = batchContextHasUserDirectives(batchContext);
        const workerPlan = await this.buildWorkerPlanPromptPayload(plan);
        return [
            extraInstructions?.trim() ?? '',
            'Execute only the approved plan items below.',
            'Approved plan targets and execution hints below are authoritative. Do not re-verify them unless a read or write fails or the approved plan still leaves a concrete ambiguity.',
            'Persist proposal records for create/edit/retire work where warranted.',
            'Use `create_proposals` as soon as you have enough content for one or more approved items, and batch proposal writes whenever practical.',
            'For approved edit/retire items, `create_proposals` may persist with `localeVariantId`, `familyId`, or `targetTitle` using the authoritative target already supplied in the plan.',
            'For approved create items, persist with `targetTitle` directly. Do not spend lookup turns trying to discover a localeVariantId for net-new work first.',
            'Preserve any approved `suggestedPlacement` when you call `create_proposals`. If a create item somehow reaches execution without authoritative placement IDs, resolve that placement before persisting the proposal.',
            hasUserDirectives
                ? 'If a create plan item includes `targetLocale`, preserve that locale in the persisted proposal. User directives embedded in the batch context remain mandatory during execution, including any requested guaranteed-create placement.'
                : '',
            'Use direct read actions only when they unblock missing article content, explain a failed write, or resolve a concrete ambiguity not already answered by the approved plan.',
            'Do not silently expand scope.',
            'If you discover new missing work, return it in the final JSON under `discoveredWork` and do not execute that new work yet.',
            'Every `discoveredWork` item must use a unique `discoveryId` within this response.',
            'Return only JSON with this shape:',
            '{"summary":string,"discoveredWork":[{"discoveryId":string,"discoveredAction":"create"|"edit"|"retire","suspectedTarget":string,"reason":string,"evidence":[{"kind":"pbi"|"article"|"search"|"review"|"transcript"|"other","ref":string,"summary":string}],"linkedPbiIds":string[],"confidence":number,"requiresPlanAmendment":boolean}]}',
            buildProposalTemplateGuidanceSection(proposalTemplate, 'When you persist `proposedHtml`, treat this active template as authoritative guidance for structure, tone, examples, and placeholder conventions.'),
            batchContext ? `Batch context summary:\n${JSON.stringify(compactBatchContextForPrompt(batchContext), null, 2)}` : '',
            JSON.stringify(workerPlan, null, 2)
        ].filter(Boolean).join('\n\n');
    }
    parseWorkerResult(resultText, fallbackSummary, sessionId) {
        if (!resultText.trim()) {
            return { summary: fallbackSummary, discoveredWork: [] };
        }
        const parsed = this.parseJsonObject(resultText);
        const issuedDiscoveryIds = new Set();
        const discoveredWork = Array.isArray(parsed.discoveredWork)
            ? parsed.discoveredWork.map((item, index) => {
                const discoveredAction = item.discoveredAction === 'create' || item.discoveredAction === 'retire'
                    ? item.discoveredAction
                    : 'edit';
                return {
                    discoveryId: nextUniqueDiscoveryId(item.discoveryId, index, issuedDiscoveryIds),
                    sourceWorkerRunId: sessionId,
                    discoveredAction,
                    suspectedTarget: typeof item.suspectedTarget === 'string' ? humanizeReadableText(item.suspectedTarget) : 'Unknown target',
                    reason: typeof item.reason === 'string' ? humanizeReadableText(item.reason) : 'Worker discovered related scope.',
                    evidence: Array.isArray(item.evidence)
                        ? item.evidence.map((evidence) => ({
                            ...evidence,
                            summary: humanizeReadableText(evidence.summary)
                        }))
                        : [],
                    linkedPbiIds: Array.isArray(item.linkedPbiIds) ? item.linkedPbiIds.filter((x) => typeof x === 'string') : [],
                    confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
                    requiresPlanAmendment: item.requiresPlanAmendment !== false,
                    status: 'pending_review'
                };
            })
            : [];
        return {
            summary: typeof parsed.summary === 'string' ? humanizeReadableText(parsed.summary) : fallbackSummary,
            discoveredWork
        };
    }
    buildAmendmentPlannerPrompt(params) {
        return this.buildPlannerPrompt({
            batchContext: params.batchContext,
            uploadedPbis: params.uploadedPbis,
            plannerPrefetch: params.plannerPrefetch,
            priorPlan: params.approvedPlan,
            resolvedUserAnswers: params.resolvedUserAnswers,
            proposalTemplate: params.proposalTemplate,
            reviewDelta: {
                summary: 'Worker discovered additional scope requiring amendment review.',
                requestedChanges: params.discoveredWork.map((item) => item.reason),
                missingPbiIds: [],
                missingCreates: params.discoveredWork.filter((item) => item.discoveredAction === 'create').map((item) => item.suspectedTarget),
                missingEdits: params.discoveredWork.filter((item) => item.discoveredAction === 'edit').map((item) => item.suspectedTarget),
                additionalArticleWork: params.discoveredWork.map((item) => item.suspectedTarget),
                targetCorrections: [],
                overlapConflicts: []
            }
        });
    }
    buildFinalReviewerPrompt(params) {
        const hasUserDirectives = batchContextHasUserDirectives(params.batchContext);
        return [
            'Return only valid JSON.',
            'You are the final reviewer for the batch.',
            'Decide whether the resulting outputs fully satisfy the PBIs and approved plan.',
            'If rework is needed, return a structured rework delta and do not approve the batch.',
            'Proposal-scoped locale variants or article families whose external key starts with `proposal-` are generated draft artifacts, not live KB coverage.',
            'Do not use proposal-scoped locale variants to claim the live KB already covers a change.',
            'Use the persisted proposal snapshots below to judge what each proposal actually changes before calling something redundant.',
            hasUserDirectives
                ? 'Batch-context user directives are still mandatory at final review. Do not approve the batch if guaranteed edit/create targets were dropped or if a guaranteed create ambiguity still lacks a user decision.'
                : '',
            'JSON shape:',
            '{"summary":string,"verdict":"approved"|"needs_rework"|"needs_human_review","allPbisMapped":boolean,"planExecutionComplete":boolean,"hasMissingArticleChanges":boolean,"hasUnresolvedDiscoveredWork":boolean,"delta":{"summary":string,"requestedRework":string[],"uncoveredPbiIds":string[],"missingArticleChanges":string[],"duplicateRiskTitles":string[],"unnecessaryChanges":string[],"unresolvedAmbiguities":string[]}}',
            buildProposalTemplateGuidanceSection(params.proposalTemplate, 'Use this active template when judging whether the executed proposals match the expected proposal HTML structure, tone, and placeholder conventions.'),
            'Batch context summary:',
            JSON.stringify(compactBatchContextForPrompt(params.batchContext), null, 2),
            'Uploaded PBI summary:',
            JSON.stringify(compactUploadedPbisForPrompt(params.uploadedPbis), null, 2),
            'Approved plan summary:',
            JSON.stringify(compactPlanForPrompt(params.approvedPlan), null, 2),
            'Worker report summary:',
            JSON.stringify(compactWorkerReportForPrompt(params.workerReport), null, 2),
            'Executed proposal snapshots:',
            JSON.stringify(compactFinalReviewerProposalContextForPrompt(params.proposalContext ?? []), null, 2),
            'Outstanding discovered work summary:',
            JSON.stringify(compactDiscoveredWorkForPrompt(params.discoveredWork), null, 2)
        ].join('\n\n');
    }
    parseFinalReviewResult(params) {
        const parsed = this.parseJsonObject(params.resultText);
        const verdict = parsed.verdict === 'approved' || parsed.verdict === 'needs_human_review' ? parsed.verdict : 'needs_rework';
        return {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId: params.workspaceId,
            batchId: params.batchId,
            iterationId: params.iteration.id,
            iteration: params.iteration.iteration,
            stage: 'final_reviewing',
            role: 'final-reviewer',
            verdict,
            summary: typeof parsed.summary === 'string' ? humanizeReadableText(parsed.summary) : 'Final review completed.',
            allPbisMapped: Boolean(parsed.allPbisMapped),
            planExecutionComplete: Boolean(parsed.planExecutionComplete),
            hasMissingArticleChanges: Boolean(parsed.hasMissingArticleChanges),
            hasUnresolvedDiscoveredWork: Boolean(parsed.hasUnresolvedDiscoveredWork),
            delta: parsed.delta && typeof parsed.delta === 'object'
                ? humanizeFinalReviewDelta(parsed.delta)
                : undefined,
            createdAtUtc: new Date().toISOString(),
            planId: params.planId,
            workerReportId: params.workerReportId,
            agentModelId: params.agentModelId,
            sessionId: params.sessionId
        };
    }
    validateApprovedPlan(plan) {
        const reasons = [];
        const planItemIds = new Set(plan.items.map((item) => item.planItemId));
        if (plan.coverage.length === 0) {
            reasons.push('Approved plan has no PBI coverage records.');
        }
        for (const coverage of plan.coverage) {
            if (!coverage.pbiId?.trim()) {
                reasons.push('Approved plan contains a coverage record without a PBI id.');
            }
            if (coverage.outcome === 'gap') {
                reasons.push(`PBI ${coverage.pbiId} is still marked as a gap.`);
            }
            if (coverage.outcome === 'blocked') {
                reasons.push(`PBI ${coverage.pbiId} is still marked as blocked.`);
            }
            if (coverage.outcome === 'covered' && coverage.planItemIds.length === 0) {
                reasons.push(`PBI ${coverage.pbiId} is marked as covered without any plan items.`);
            }
            for (const planItemId of coverage.planItemIds) {
                if (!planItemIds.has(planItemId)) {
                    reasons.push(`Coverage for PBI ${coverage.pbiId} references missing plan item ${planItemId}.`);
                }
            }
        }
        for (const item of plan.items) {
            if (item.action !== 'create') {
                continue;
            }
            if (!normalizePlacementScopeId(item.suggestedPlacement?.categoryId)) {
                reasons.push(`Create plan item ${item.planItemId} (${item.targetTitle}) is missing suggested category placement with an authoritative categoryId.`);
            }
        }
        return { ok: reasons.length === 0, reasons };
    }
    validateUserDirectedTargets(params) {
        const { analysisConfig, guaranteedCreateConflicts } = extractBatchUserDirectives(params.batchContext);
        if (!analysisConfig) {
            return {
                blockingQuestions: [],
                missingGuaranteedEditTargets: [],
                missingGuaranteedCreateTargets: []
            };
        }
        const blockingQuestions = [];
        const missingGuaranteedEditTargets = [];
        const missingGuaranteedCreateTargets = [];
        for (const family of analysisConfig.guaranteedEditFamilies) {
            for (const variant of family.resolvedLocaleVariants) {
                const hasMatchingEdit = params.plan.items.some((item) => item.action === 'edit'
                    && (item.targetArticleId?.trim() === variant.localeVariantId
                        || (family.resolvedLocaleVariants.length === 1 && item.targetFamilyId?.trim() === family.familyId)));
                if (!hasMatchingEdit) {
                    missingGuaranteedEditTargets.push(`Guaranteed edit target ${family.familyTitle} (${variant.locale}) is missing a concrete edit plan item.`);
                }
            }
        }
        for (const article of analysisConfig.guaranteedCreateArticles) {
            const matchingConflict = guaranteedCreateConflicts.find((conflict) => conflict.clientId === article.clientId);
            if (matchingConflict) {
                const questionId = createDeterministicQuestionId('guaranteed-create-conflict', matchingConflict.clientId, matchingConflict.title);
                const existingQuestion = params.finalQuestions.find((question) => question.id === questionId);
                if (!existingQuestion || existingQuestion.status === 'pending') {
                    blockingQuestions.push(existingQuestion ?? {
                        id: questionId,
                        prompt: `You requested guaranteed creation of ${matchingConflict.title} (${matchingConflict.targetLocale}), but ${matchingConflict.matches[0]?.title ?? 'an existing live article'} may already cover that topic. Should we still create a new article or convert this to an edit?`,
                        reason: `Guaranteed create target ${matchingConflict.title} (${matchingConflict.targetLocale}) strongly overlaps existing live KB coverage, so the system needs a user decision before approving create-versus-edit scope.`,
                        requiresUserInput: true,
                        linkedPbiIds: [],
                        linkedPlanItemIds: params.plan.items
                            .filter((item) => this.normalizeTitle(item.targetTitle ?? '') === this.normalizeTitle(matchingConflict.title))
                            .map((item) => item.planItemId),
                        linkedDiscoveryIds: [],
                        status: 'pending',
                        createdAtUtc: new Date().toISOString()
                    });
                }
                continue;
            }
            const matchingCreate = params.plan.items.find((item) => item.action === 'create'
                && this.normalizeTitle(item.targetTitle ?? '') === this.normalizeTitle(article.title)
                && normalizeLocaleForComparison(item.targetLocale) === normalizeLocaleForComparison(article.targetLocale));
            if (!matchingCreate) {
                missingGuaranteedCreateTargets.push(`Guaranteed create target ${article.title} (${article.targetLocale}) is missing a create plan item with the correct locale.`);
                continue;
            }
            if (!doesPlacementMeetRequirement(matchingCreate.suggestedPlacement, article)) {
                missingGuaranteedCreateTargets.push(`Guaranteed create target ${article.title} (${article.targetLocale}) is missing the requested category or section placement in its create plan item.`);
            }
        }
        return {
            blockingQuestions,
            missingGuaranteedEditTargets: dedupePlanReviewStrings(missingGuaranteedEditTargets).slice(0, 20),
            missingGuaranteedCreateTargets: dedupePlanReviewStrings(missingGuaranteedCreateTargets).slice(0, 20)
        };
    }
    validateWorkerReport(plan, report) {
        const reasons = [];
        const itemResults = new Map(report.executedItems.map((item) => [item.planItemId, item]));
        for (const planItem of plan.items) {
            const result = itemResults.get(planItem.planItemId);
            if (!result) {
                reasons.push(`Approved plan item ${planItem.planItemId} has no worker execution result.`);
                continue;
            }
            if (result.status === 'skipped' && planItem.action !== 'no_impact') {
                reasons.push(`Approved plan item ${planItem.planItemId} was skipped without being no-impact.`);
            }
        }
        if (report.executedItems.length !== plan.items.length) {
            reasons.push(`Worker report execution count ${report.executedItems.length} does not match approved plan item count ${plan.items.length}.`);
        }
        return { ok: reasons.length === 0, reasons };
    }
    validateFinalApproval(params) {
        const reasons = [];
        const planValidation = this.validateApprovedPlan(params.plan);
        const workerValidation = this.validateWorkerReport(params.plan, params.workerReport);
        reasons.push(...planValidation.reasons, ...workerValidation.reasons);
        const directiveValidation = this.validateUserDirectedTargets({
            plan: params.plan,
            finalQuestions: params.plan.questions ?? [],
            batchContext: params.batchContext
        });
        reasons.push(...directiveValidation.missingGuaranteedEditTargets, ...directiveValidation.missingGuaranteedCreateTargets);
        if (directiveValidation.blockingQuestions.length > 0) {
            reasons.push(`Final approval blocked by ${directiveValidation.blockingQuestions.length} unresolved guaranteed-create ambiguity question(s).`);
        }
        if (!params.finalReview.allPbisMapped) {
            reasons.push('Final review cannot approve while PBIs remain unmapped.');
        }
        if (!params.finalReview.planExecutionComplete) {
            reasons.push('Final review cannot approve while plan execution is incomplete.');
        }
        if (params.finalReview.hasUnresolvedDiscoveredWork) {
            reasons.push('Final review cannot approve while unresolved discovered work remains.');
        }
        if (params.finalReview.hasMissingArticleChanges) {
            reasons.push('Final review cannot approve while missing article changes remain.');
        }
        const unresolvedDiscoveries = params.workerReport.discoveredWork.filter((item) => item.requiresPlanAmendment && item.status !== 'approved' && item.status !== 'rejected');
        if (unresolvedDiscoveries.length > 0) {
            reasons.push(`Final approval blocked by ${unresolvedDiscoveries.length} unresolved discovered work item(s).`);
        }
        const nonTerminalItems = params.workerReport.executedItems.filter((item) => item.status !== 'executed' && item.status !== 'blocked' && item.status !== 'skipped');
        if (nonTerminalItems.length > 0) {
            reasons.push('Final approval blocked by non-terminal worker item statuses.');
        }
        return { ok: reasons.length === 0, reasons };
    }
    async completeIteration(params) {
        const iteration = await this.workspaceRepository.updateBatchAnalysisIteration({
            workspaceId: params.workspaceId,
            iterationId: params.iterationId,
            stage: params.stage,
            role: params.role,
            status: params.status,
            summary: params.summary,
            agentModelId: params.agentModelId,
            sessionId: params.sessionId,
            approvedPlanId: params.approvedPlanId,
            lastReviewVerdict: params.lastReviewVerdict,
            outstandingDiscoveredWorkCount: params.outstandingDiscoveredWorkCount,
            executionCounts: params.executionCounts,
            endedAtUtc: params.endedAtUtc
        });
        await this.workspaceRepository.recordBatchAnalysisStageEvent({
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId: iteration.workspaceId,
            batchId: iteration.batchId,
            iterationId: iteration.id,
            iteration: iteration.iteration,
            stage: iteration.stage,
            role: iteration.role,
            eventType: 'iteration_completed',
            status: iteration.status,
            summary: iteration.summary,
            sessionId: iteration.sessionId,
            agentModelId: iteration.agentModelId,
            approvedPlanId: iteration.approvedPlanId,
            lastReviewVerdict: iteration.lastReviewVerdict,
            outstandingDiscoveredWorkCount: iteration.outstandingDiscoveredWorkCount,
            executionCounts: iteration.executionCounts,
            createdAtUtc: iteration.endedAtUtc ?? iteration.updatedAtUtc
        });
        return iteration;
    }
    findLikelyMissingEditTargets(plan, plannerPrefetch) {
        const createItemCount = plan.items.filter((item) => item.action === 'create').length;
        const editItemCount = plan.items.filter((item) => item.action === 'edit').length;
        const noImpactItemCount = plan.items.filter((item) => item.action === 'no_impact').length;
        const decisiveItemCount = plan.items.filter((item) => item.action === 'create' || item.action === 'edit' || item.action === 'retire').length;
        if (createItemCount === 0 && noImpactItemCount === 0 && editItemCount === 0) {
            return [];
        }
        const representedKeys = new Set(plan.items
            .filter((item) => item.action !== 'create')
            .flatMap((item) => Array.from(collectPlanItemTargetSignalKeys(item, (value) => this.normalizeTitle(value)))));
        const candidates = dedupePlanReviewStrings([
            ...collectDeterministicClusterCoverageAssessments({
                plan,
                plannerPrefetch,
                normalizeTitle: (value) => this.normalizeTitle(value)
            })
                .filter((assessment) => assessment.hasStrongArticleSignal && !assessment.hasStrongArticleCoverage)
                .flatMap((assessment) => assessment.strongArticleTitles),
            ...collectStrongArticleTargetSignals(plannerPrefetch?.articleMatches ?? [], (value) => this.normalizeTitle(value))
                .filter((signal) => !representedKeys.has(signal.key))
                .map((signal) => signal.title)
        ]).slice(0, 8);
        if (candidates.length === 0) {
            return [];
        }
        if (decisiveItemCount === 0 || editItemCount === 0) {
            return candidates;
        }
        return candidates.length >= 2 && editItemCount < candidates.length
            ? candidates
            : [];
    }
    findLikelyMissingCreateTargets(plan, plannerPrefetch) {
        if (!plannerPrefetch) {
            return [];
        }
        return dedupePlanReviewStrings(collectDeterministicClusterCoverageAssessments({
            plan,
            plannerPrefetch,
            normalizeTitle: (value) => this.normalizeTitle(value)
        })
            .filter((assessment) => !assessment.hasCreateCoverage)
            .filter((assessment) => assessment.relatedPlanItems.length > 0)
            .filter((assessment) => assessment.relatedPlanItems.some((item) => item.action !== 'create'))
            .filter((assessment) => assessment.hasSearchCoverage)
            .filter((assessment) => !assessment.hasNonZeroSearchHit)
            .filter((assessment) => !assessment.hasSupportedExistingCoverage)
            .map((assessment) => assessment.displayTitle)).slice(0, 8);
    }
    findDeterministicTargetConflicts(plan) {
        const grouped = new Map();
        plan.items
            .filter((item) => item.action !== 'create')
            .forEach((item) => {
            const key = item.targetFamilyId?.trim()
                ? `family:${item.targetFamilyId.trim()}`
                : item.targetTitle?.trim()
                    ? `title:${this.normalizeTitle(item.targetTitle)}`
                    : '';
            if (!key) {
                return;
            }
            const entry = grouped.get(key) ?? { count: 0, titles: new Set() };
            entry.count += 1;
            entry.titles.add(humanizeReadableText(item.targetTitle));
            grouped.set(key, entry);
        });
        return Array.from(grouped.values())
            .filter((entry) => entry.count >= 2)
            .flatMap((entry) => Array.from(entry.titles))
            .slice(0, 8);
    }
    async tryGetLocaleVariant(workspaceId, variantId) {
        if (!variantId?.trim()) {
            return null;
        }
        try {
            return await this.workspaceRepository.getLocaleVariant(workspaceId, variantId.trim());
        }
        catch {
            return null;
        }
    }
    async getLiveFamilyVariants(workspaceId, familyId) {
        if (!familyId?.trim()) {
            return [];
        }
        const variants = await this.workspaceRepository.getLocaleVariantsForFamily(workspaceId, familyId.trim());
        return variants.filter((variant) => variant.status === 'live' && !variant.retiredAtUtc);
    }
    async getUniqueLiveFamilyVariant(workspaceId, familyId) {
        const variants = await this.getLiveFamilyVariants(workspaceId, familyId);
        return variants.length === 1 ? variants[0] : null;
    }
    async getFamilyExternalKey(workspaceId, familyId) {
        if (!familyId?.trim()) {
            return null;
        }
        try {
            const family = await this.workspaceRepository.getArticleFamily(workspaceId, familyId.trim());
            return family.externalKey?.trim().toLowerCase() ?? null;
        }
        catch {
            return null;
        }
    }
    async buildWorkerPlanPromptPayload(plan) {
        const promptVisibleQuestions = filterPromptVisibleQuestions(plan.questions ?? []);
        return {
            planId: plan.id,
            verdict: plan.verdict,
            planVersion: plan.planVersion,
            summary: plan.summary,
            coverage: plan.coverage.map((item) => compactPlanCoverageForPrompt(item)),
            items: await Promise.all(plan.items.map(async (item) => ({
                ...compactPlanItemForPrompt(item),
                executionTarget: await this.buildWorkerExecutionTargetHint(plan.workspaceId, item)
            }))),
            questions: promptVisibleQuestions.map((question) => compactPlanQuestionForPrompt(question)),
            openQuestions: serializeOpenQuestionPrompts(promptVisibleQuestions, plan.openQuestions)
        };
    }
    async buildWorkerExecutionTargetHint(workspaceId, item) {
        const targetTitle = item.targetTitle.trim();
        const trimmedTargetArticleId = item.targetArticleId?.trim();
        const trimmedTargetFamilyId = item.targetFamilyId?.trim();
        if (item.action === 'no_impact') {
            return {
                strategy: 'no_proposal',
                authoritative: true,
                canPersistImmediately: false,
                note: 'No proposal should be created for approved no-impact items.',
                recommendedProposalArgs: null
            };
        }
        if (item.action === 'create') {
            return {
                strategy: 'target_title',
                authoritative: true,
                canPersistImmediately: Boolean(targetTitle),
                targetTitle: targetTitle || null,
                targetLocale: item.targetLocale ?? null,
                suggestedPlacement: item.suggestedPlacement ?? null,
                note: 'Persist this net-new proposal with `targetTitle` directly. Locale variant lookup is unnecessary before `create_proposals`.',
                recommendedProposalArgs: {
                    itemId: item.planItemId,
                    action: item.action,
                    ...(targetTitle ? { targetTitle } : {}),
                    ...(item.targetLocale?.trim() ? { targetLocale: item.targetLocale.trim() } : {}),
                    ...(item.suggestedPlacement ? { suggestedPlacement: item.suggestedPlacement } : {}),
                    relatedPbiIds: item.pbiIds
                }
            };
        }
        if (trimmedTargetArticleId) {
            return {
                strategy: 'locale_variant_id',
                authoritative: true,
                canPersistImmediately: true,
                localeVariantId: trimmedTargetArticleId,
                familyId: trimmedTargetFamilyId || null,
                targetTitle: targetTitle || null,
                note: 'Approved plan already names the live locale variant target. Use it directly in `create_proposals`.',
                recommendedProposalArgs: {
                    itemId: item.planItemId,
                    action: item.action,
                    localeVariantId: trimmedTargetArticleId,
                    ...(targetTitle ? { targetTitle } : {}),
                    ...(item.suggestedPlacement ? { suggestedPlacement: item.suggestedPlacement } : {}),
                    relatedPbiIds: item.pbiIds
                }
            };
        }
        if (trimmedTargetFamilyId) {
            const preferredLocaleVariant = await this.getUniqueLiveFamilyVariant(workspaceId, trimmedTargetFamilyId);
            return {
                strategy: 'family_id',
                authoritative: true,
                canPersistImmediately: true,
                familyId: trimmedTargetFamilyId,
                preferredLocaleVariantId: preferredLocaleVariant?.id ?? null,
                targetTitle: targetTitle || null,
                note: preferredLocaleVariant
                    ? `Persist with \`familyId\` directly. Locale variant ${preferredLocaleVariant.id} is the unique live variant if you need article content before writing.`
                    : 'Persist with `familyId` directly. Locale variant lookup is optional and only needed if you need existing article content before writing.',
                recommendedProposalArgs: {
                    itemId: item.planItemId,
                    action: item.action,
                    familyId: trimmedTargetFamilyId,
                    ...(targetTitle ? { targetTitle } : {}),
                    ...(item.suggestedPlacement ? { suggestedPlacement: item.suggestedPlacement } : {}),
                    relatedPbiIds: item.pbiIds
                }
            };
        }
        if (targetTitle) {
            return {
                strategy: 'target_title',
                authoritative: true,
                canPersistImmediately: true,
                targetTitle,
                note: 'The approved plan preserved only the authoritative title. Use `targetTitle` directly unless a write fails or content drafting truly needs a lookup.',
                recommendedProposalArgs: {
                    itemId: item.planItemId,
                    action: item.action,
                    targetTitle,
                    ...(item.suggestedPlacement ? { suggestedPlacement: item.suggestedPlacement } : {}),
                    relatedPbiIds: item.pbiIds
                }
            };
        }
        return {
            strategy: 'lookup_required',
            authoritative: false,
            canPersistImmediately: false,
            note: 'No usable target id or title was preserved in the approved plan. Only now should you spend a direct read action resolving the target before `create_proposals`.',
            recommendedProposalArgs: {
                itemId: item.planItemId,
                action: item.action,
                relatedPbiIds: item.pbiIds
            }
        };
    }
    parseJsonObject(value) {
        const trimmed = value.trim();
        if (!trimmed) {
            throw new Error('Agent returned empty output');
        }
        const candidates = new Set([trimmed]);
        for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
            const candidate = match[1]?.trim();
            if (candidate) {
                candidates.add(candidate);
            }
        }
        for (const candidate of candidates) {
            try {
                return JSON.parse(candidate);
            }
            catch {
                const extracted = this.extractFirstJsonObject(candidate);
                if (!extracted) {
                    continue;
                }
                try {
                    return JSON.parse(extracted);
                }
                catch {
                    continue;
                }
            }
        }
        throw new Error('Agent did not return valid JSON');
    }
    extractFirstJsonObject(value) {
        let start = -1;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = 0; index < value.length; index += 1) {
            const char = value[index];
            if (inString) {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (char === '\\') {
                    escaped = true;
                    continue;
                }
                if (char === '"') {
                    inString = false;
                }
                continue;
            }
            if (char === '"') {
                inString = true;
                continue;
            }
            if (char === '{') {
                if (depth === 0) {
                    start = index;
                }
                depth += 1;
                continue;
            }
            if (char !== '}' || depth === 0) {
                continue;
            }
            depth -= 1;
            if (depth === 0 && start >= 0) {
                return value.slice(start, index + 1);
            }
        }
        return null;
    }
}
exports.BatchAnalysisOrchestrator = BatchAnalysisOrchestrator;
function compactBatchContextForPrompt(batchContext) {
    if (!batchContext || typeof batchContext !== 'object') {
        return { available: false };
    }
    const record = batchContext;
    const batch = record.batch && typeof record.batch === 'object'
        ? record.batch
        : record;
    const userDirectives = compactBatchUserDirectivesForPrompt(record);
    return {
        batchId: batch.id ?? record.batchId ?? null,
        workspaceId: batch.workspaceId ?? record.workspaceId ?? null,
        name: batch.name ?? record.name ?? null,
        sourceFileName: batch.sourceFileName ?? null,
        sourceFormat: batch.sourceFormat ?? null,
        status: batch.status ?? record.status ?? null,
        sourceRowCount: batch.sourceRowCount ?? null,
        candidateRowCount: batch.candidateRowCount ?? countArray(record.candidateRows),
        scopedRowCount: batch.scopedRowCount ?? null,
        ignoredRowCount: batch.ignoredRowCount ?? countArray(record.ignoredRows),
        malformedRowCount: batch.malformedRowCount ?? countArray(record.malformedRows),
        duplicateRowCount: batch.duplicateRowCount ?? countArray(record.duplicateRows),
        userDirectives
    };
}
function batchContextHasUserDirectives(batchContext) {
    const { analysisConfig, guaranteedCreateConflicts } = extractBatchUserDirectives(batchContext);
    return Boolean(analysisConfig
        && (analysisConfig.guaranteedEditFamilies.length > 0
            || analysisConfig.guaranteedCreateArticles.length > 0
            || Boolean(analysisConfig.analysisGuidancePrompt)
            || guaranteedCreateConflicts.length > 0));
}
function compactBatchUserDirectivesForPrompt(batchContext) {
    const { analysisConfig, guaranteedCreateConflicts } = extractBatchUserDirectives(batchContext);
    if (!analysisConfig) {
        return null;
    }
    const hasDirectives = analysisConfig.guaranteedEditFamilies.length > 0
        || analysisConfig.guaranteedCreateArticles.length > 0
        || Boolean(analysisConfig.analysisGuidancePrompt)
        || guaranteedCreateConflicts.length > 0;
    if (!hasDirectives) {
        return null;
    }
    return {
        guidancePrompt: truncatePromptText(analysisConfig.analysisGuidancePrompt, 320) ?? null,
        guaranteedEditFamilies: analysisConfig.guaranteedEditFamilies.map((family) => ({
            familyId: family.familyId,
            familyTitle: family.familyTitle,
            mode: family.mode,
            requiredLocales: family.resolvedLocaleVariants.map((variant) => ({
                locale: variant.locale,
                localeVariantId: variant.localeVariantId,
                snippet: truncatePromptText(variant.snippet, 140) ?? null
            }))
        })),
        guaranteedCreateArticles: analysisConfig.guaranteedCreateArticles.map((article) => ({
            clientId: article.clientId,
            title: article.title,
            targetLocale: article.targetLocale,
            suggestedPlacement: compactPlacementForPrompt(article)
        })),
        guaranteedCreateConflicts: guaranteedCreateConflicts.map((conflict) => ({
            clientId: conflict.clientId,
            title: conflict.title,
            targetLocale: conflict.targetLocale,
            reason: truncatePromptText(conflict.reason, 180) ?? conflict.reason,
            matches: conflict.matches.map((match) => ({
                title: match.title,
                locale: match.locale,
                localeVariantId: match.localeVariantId,
                score: match.score,
                matchContext: match.matchContext ?? null,
                snippet: truncatePromptText(match.snippet, 120) ?? null
            }))
        })),
        rules: [
            'Guaranteed edit families are mandatory.',
            'Each listed guaranteed edit locale requires its own concrete edit plan item.',
            'Guaranteed creates are mandatory unless the user resolves a create-versus-edit conflict differently.',
            'Guaranteed create items should preserve targetLocale in the approved plan and persisted proposal.',
            'Guaranteed create items should preserve any requested category or section placement.'
        ]
    };
}
function extractBatchUserDirectives(batchContext) {
    if (!batchContext || typeof batchContext !== 'object') {
        return {
            analysisConfig: null,
            guaranteedCreateConflicts: []
        };
    }
    const record = batchContext;
    const analysisConfigCandidate = record.analysisConfig;
    const analysisConfig = analysisConfigCandidate
        && typeof analysisConfigCandidate === 'object'
        && Array.isArray(analysisConfigCandidate.guaranteedEditFamilies)
        && Array.isArray(analysisConfigCandidate.guaranteedCreateArticles)
        ? analysisConfigCandidate
        : null;
    const guaranteedCreateConflicts = Array.isArray(record.guaranteedCreateConflicts)
        ? record.guaranteedCreateConflicts.filter((conflict) => Boolean(conflict && typeof conflict === 'object' && typeof conflict.title === 'string'))
        : [];
    return {
        analysisConfig,
        guaranteedCreateConflicts
    };
}
function extractUploadedPbiRows(uploadedPbis) {
    const rows = Array.isArray(uploadedPbis)
        ? uploadedPbis
        : uploadedPbis && typeof uploadedPbis === 'object' && Array.isArray(uploadedPbis.rows)
            ? uploadedPbis.rows
            : [];
    const extracted = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') {
            continue;
        }
        const record = row;
        const pbiId = typeof record.id === 'string' ? record.id.trim() : '';
        if (!pbiId) {
            continue;
        }
        extracted.push({
            pbiId,
            externalId: typeof record.externalId === 'string' ? record.externalId.trim() : undefined,
            title: typeof record.title === 'string' ? record.title.trim() : undefined
        });
    }
    return extracted;
}
function buildCanonicalPbiEvidenceRef(row) {
    return row.externalId?.trim()
        ? `pbiId:${row.pbiId}|externalId:${row.externalId}`
        : `pbiId:${row.pbiId}`;
}
function parsePbiEvidenceRef(ref) {
    const trimmed = ref.trim();
    if (!trimmed) {
        return null;
    }
    const parsed = {};
    for (const segment of trimmed.split('|')) {
        const token = segment.trim();
        if (!token) {
            continue;
        }
        const pbiMatch = token.match(/^(pbi\s*id|pbiId)\s*:\s*(.+)$/i);
        if (pbiMatch?.[2]) {
            parsed.pbiId = pbiMatch[2].trim();
            continue;
        }
        const externalMatch = token.match(/^(external\s*id|externalId)\s*:\s*(.+)$/i);
        if (externalMatch?.[2]) {
            parsed.externalId = externalMatch[2].trim();
        }
    }
    return parsed.pbiId || parsed.externalId ? parsed : null;
}
function resolveUploadedPbiRowFromEvidenceRef(ref, rowsById, rows) {
    const parsed = parsePbiEvidenceRef(ref);
    const directCandidates = [parsed?.pbiId, parsed?.externalId, ref]
        .filter((value) => typeof value === 'string' && value.trim().length > 0);
    for (const candidate of directCandidates) {
        const repaired = resolveUploadedPbiId(candidate, rows);
        if (repaired) {
            return rowsById.get(repaired) ?? rows.find((row) => row.pbiId === repaired) ?? null;
        }
    }
    return null;
}
function resolveUploadedPbiId(value, rows) {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const exact = rows.find((row) => row.pbiId === trimmed);
    if (exact) {
        return exact.pbiId;
    }
    const exactExternal = rows.find((row) => row.externalId === trimmed);
    if (exactExternal) {
        return exactExternal.pbiId;
    }
    const normalized = trimmed.replace(/[^a-z0-9]+/gi, '').toLowerCase();
    const exactNormalized = rows.find((row) => row.pbiId.replace(/[^a-z0-9]+/gi, '').toLowerCase() === normalized);
    if (exactNormalized) {
        return exactNormalized.pbiId;
    }
    const normalizedExternal = rows.find((row) => {
        const externalId = row.externalId?.replace(/[^a-z0-9]+/gi, '').toLowerCase();
        if (!externalId) {
            return false;
        }
        return externalId === normalized || `pbi${externalId}` === normalized;
    });
    if (normalizedExternal) {
        return normalizedExternal.pbiId;
    }
    const candidates = rows
        .map((row) => ({
        pbiId: row.pbiId,
        distance: Math.min(computeEditDistance(trimmed, row.pbiId), row.externalId ? computeEditDistance(trimmed, row.externalId) : Number.POSITIVE_INFINITY, row.externalId ? computeEditDistance(normalized, `pbi${row.externalId.replace(/[^a-z0-9]+/gi, '').toLowerCase()}`) : Number.POSITIVE_INFINITY)
    }))
        .filter((candidate) => candidate.distance <= 2)
        .sort((left, right) => left.distance - right.distance || left.pbiId.localeCompare(right.pbiId));
    if (candidates.length !== 1) {
        return null;
    }
    return candidates[0]?.pbiId ?? null;
}
function computeEditDistance(left, right) {
    if (left === right) {
        return 0;
    }
    const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
    for (let column = 1; column <= right.length; column += 1) {
        let previous = rows[0];
        rows[0] = column;
        for (let row = 1; row <= left.length; row += 1) {
            const temp = rows[row];
            rows[row] = Math.min(rows[row] + 1, rows[row - 1] + 1, previous + (left[row - 1] === right[column - 1] ? 0 : 1));
            previous = temp;
        }
    }
    return rows[left.length] ?? Math.max(left.length, right.length);
}
function compactUploadedPbisForPrompt(uploadedPbis) {
    const rows = Array.isArray(uploadedPbis)
        ? uploadedPbis
        : uploadedPbis && typeof uploadedPbis === 'object' && Array.isArray(uploadedPbis.rows)
            ? uploadedPbis.rows
            : [];
    return rows.map((row) => compactPbiForPrompt(row)).filter((row) => Object.keys(row).length > 0);
}
function compactPbiForPrompt(row) {
    if (!row || typeof row !== 'object') {
        return {};
    }
    const record = row;
    const titlePath = [record.title1, record.title2, record.title3]
        .filter((value) => typeof value === 'string' && value.trim().length > 0);
    return {
        pbiId: record.id ?? null,
        externalId: record.externalId ?? null,
        sourceRowNumber: record.sourceRowNumber ?? null,
        title: record.title ?? null,
        titlePath,
        description: truncatePromptText(record.descriptionText, 220),
        acceptanceCriteria: truncatePromptText(record.acceptanceCriteriaText, 320),
        parentExternalId: record.parentExternalId ?? null
    };
}
function compactPlanForPrompt(plan) {
    const promptVisibleQuestions = filterPromptVisibleQuestions(plan.questions ?? []);
    return {
        planId: plan.id,
        verdict: plan.verdict,
        planVersion: plan.planVersion,
        summary: plan.summary,
        coverage: plan.coverage.map((item) => compactPlanCoverageForPrompt(item)),
        items: plan.items.map((item) => compactPlanItemForPrompt(item)),
        questions: promptVisibleQuestions.map((question) => compactPlanQuestionForPrompt(question)),
        openQuestions: serializeOpenQuestionPrompts(promptVisibleQuestions, plan.openQuestions)
    };
}
function compactPlanCoverageForPrompt(item) {
    return {
        pbiId: item.pbiId,
        outcome: item.outcome,
        planItemIds: item.planItemIds,
        notes: truncatePromptText(item.notes, 160)
    };
}
function compactPlanItemForPrompt(item) {
    return {
        planItemId: item.planItemId,
        pbiIds: item.pbiIds,
        action: item.action,
        targetType: item.targetType,
        targetArticleId: item.targetArticleId ?? null,
        targetFamilyId: item.targetFamilyId ?? null,
        targetTitle: item.targetTitle,
        targetLocale: item.targetLocale ?? null,
        suggestedPlacement: compactPlacementForPrompt(item.suggestedPlacement),
        reason: truncatePromptText(item.reason, 220),
        evidence: item.evidence.map((evidence) => ({
            kind: evidence.kind,
            ref: evidence.ref,
            summary: truncatePromptText(evidence.summary, 120)
        })),
        confidence: item.confidence,
        dependsOn: item.dependsOn ?? [],
        executionStatus: item.executionStatus
    };
}
function compactPlacementForPrompt(placement) {
    if (!placement) {
        return null;
    }
    const categoryId = normalizePlacementScopeId(placement.categoryId);
    const categoryName = normalizePromptString(placement.categoryName);
    const sectionId = normalizePlacementScopeId(placement.sectionId);
    const sectionName = normalizePromptString(placement.sectionName);
    const notes = normalizePromptString(placement.notes);
    if (!categoryId && !categoryName && !sectionId && !sectionName && !notes) {
        return null;
    }
    return {
        categoryId: categoryId || null,
        categoryName: categoryName ?? null,
        sectionId: sectionId || null,
        sectionName: sectionName ?? null,
        ...(notes ? { notes } : {})
    };
}
function compactPlanQuestionForPrompt(question) {
    return {
        id: question.id,
        prompt: truncatePromptText(question.prompt, 180),
        reason: truncatePromptText(question.reason, 180),
        requiresUserInput: question.requiresUserInput,
        linkedPbiIds: question.linkedPbiIds,
        linkedPlanItemIds: question.linkedPlanItemIds,
        linkedDiscoveryIds: question.linkedDiscoveryIds,
        status: question.status,
        answer: truncatePromptText(question.answer, 220)
    };
}
function compactReviewDeltaForPrompt(delta) {
    return {
        summary: truncatePromptText(delta.summary, 220),
        requestedChanges: delta.requestedChanges.slice(0, 20).map((item) => truncatePromptText(item, 140)),
        missingPbiIds: delta.missingPbiIds,
        missingCreates: delta.missingCreates.slice(0, 20).map((item) => truncatePromptText(item, 140)),
        missingEdits: delta.missingEdits.slice(0, 20).map((item) => truncatePromptText(item, 140)),
        additionalArticleWork: delta.additionalArticleWork.slice(0, 20).map((item) => truncatePromptText(item, 140)),
        targetCorrections: delta.targetCorrections.slice(0, 20).map((item) => truncatePromptText(item, 140)),
        overlapConflicts: delta.overlapConflicts.slice(0, 20).map((item) => truncatePromptText(item, 140))
    };
}
function compactPlannerPrefetchForPrompt(prefetch) {
    if (!prefetch) {
        return { available: false };
    }
    const topicClusters = Array.isArray(prefetch.topicClusters) ? prefetch.topicClusters : [];
    const articleMatches = Array.isArray(prefetch.articleMatches) ? prefetch.articleMatches : [];
    const relationMatches = Array.isArray(prefetch.relationMatches) ? prefetch.relationMatches : [];
    return {
        priorAnalysis: prefetch.priorAnalysis ?? null,
        topicClusters: topicClusters.slice(0, 20).map((cluster) => ({
            clusterId: cluster.clusterId,
            label: cluster.label,
            pbiIds: cluster.pbiIds,
            sampleTitles: cluster.sampleTitles.slice(0, 4),
            queries: cluster.queries.slice(0, 4)
        })),
        articleMatches: articleMatches.slice(0, 40).map((match) => ({
            clusterId: match.clusterId,
            query: match.query,
            total: match.total,
            topResults: match.topResults.slice(0, 3).map((result) => ({
                title: result.title,
                familyId: result.familyId,
                localeVariantId: result.localeVariantId,
                score: result.score,
                matchContext: result.matchContext ?? null,
                snippet: truncatePromptText(result.snippet, 160)
            }))
        })),
        relationMatches: relationMatches.slice(0, 12).map((match) => ({
            title: match.title,
            familyId: match.familyId,
            strengthScore: match.strengthScore,
            relationType: match.relationType,
            evidence: match.evidence.slice(0, 3).map((item) => truncatePromptText(item, 140))
        }))
    };
}
function compactWorkerReportForPrompt(report) {
    return {
        workerReportId: report.id,
        summary: report.summary,
        status: report.status,
        planId: report.planId ?? null,
        executedItems: report.executedItems.map((item) => ({
            planItemId: item.planItemId,
            action: item.action,
            targetTitle: item.targetTitle,
            status: item.status,
            proposalId: item.proposalId ?? null,
            note: truncatePromptText(item.note, 140)
        })),
        blockerNotes: report.blockerNotes.map((item) => truncatePromptText(item, 180)),
        discoveredWork: compactDiscoveredWorkForPrompt(report.discoveredWork)
    };
}
function compactFinalReviewerProposalContextForPrompt(items) {
    return items.map((item) => ({
        proposalId: item.proposalId,
        action: item.action,
        targetTitle: item.targetTitle,
        reviewStatus: item.reviewStatus ?? null,
        familyId: item.familyId ?? null,
        localeVariantId: item.localeVariantId ?? null,
        locale: item.locale ?? null,
        variantStatus: item.variantStatus ?? null,
        familyExternalKey: item.familyExternalKey ?? null,
        targetState: item.targetState,
        targetStateReason: truncatePromptText(item.targetStateReason, 180),
        relatedPbiIds: item.relatedPbiIds.slice(0, 12),
        relatedExternalIds: item.relatedExternalIds.slice(0, 12),
        rationaleSummary: truncatePromptText(item.rationaleSummary, 200),
        aiNotes: truncatePromptText(item.aiNotes, 200),
        changeSummary: item.changeSummary.slice(0, 8).map((entry) => truncatePromptText(entry, 180)),
        proposedContentPreview: truncatePromptText(item.proposedContentPreview, 220)
    }));
}
function compactDiscoveredWorkForPrompt(items) {
    return items.map((item) => ({
        discoveryId: item.discoveryId,
        discoveredAction: item.discoveredAction,
        suspectedTarget: item.suspectedTarget,
        reason: truncatePromptText(item.reason, 180),
        linkedPbiIds: item.linkedPbiIds,
        confidence: item.confidence,
        requiresPlanAmendment: item.requiresPlanAmendment,
        status: item.status,
        evidence: item.evidence.map((evidence) => ({
            kind: evidence.kind,
            ref: evidence.ref,
            summary: truncatePromptText(evidence.summary, 100)
        }))
    }));
}
const HUMANIZE_DICTIONARY = new Set([
    'a', 'about', 'accounted', 'action', 'adjacent', 'after', 'all', 'already', 'an', 'and', 'any', 'appears',
    'article', 'articles', 'assessed', 'at', 'authored', 'back', 'batch', 'behavior', 'broader', 'by', 'candidate',
    'change', 'changes', 'click', 'cluster', 'confirm', 'confirmed', 'content', 'context', 'coverage', 'covered',
    'create', 'created', 'creation', 'criteria', 'cross', 'current', 'currently', 'dedicated', 'delete', 'describe',
    'describes', 'deterministic', 'did', 'direct', 'discovery', 'distinct', 'documented', 'do', 'does', 'duplicate',
    'duplicated', 'duplicating', 'editing', 'edit', 'embedding', 'evidence', 'eventual', 'exact', 'existing',
    'expected',
    'execute', 'execution', 'family', 'feature', 'field', 'fields', 'file', 'final', 'find', 'flow', 'focused',
    'food', 'for', 'found', 'from', 'fully', 'grouped', 'has', 'have', 'if', 'impact', 'in', 'incomplete',
    'indicating', 'indexing', 'inside', 'insert', 'into', 'is', 'it', 'item', 'items', 'justification', 'kb', 'later',
    'legacy', 'likely', 'limit', 'limited', 'link', 'links', 'list', 'lists', 'load', 'lookup', 'main', 'manage',
    'management', 'manual', 'match', 'matched', 'matches', 'menu', 'mention', 'mode', 'name', 'named', 'nearby',
    'new', 'no', 'not', 'of', 'on', 'one', 'only', 'open', 'opens', 'option', 'or', 'outside', 'path', 'pending',
    'pbi', 'permission', 'plan', 'planner', 'portal', 'prefetch', 'prefilled', 'prefill', 'proposal', 'published',
    'queries', 'question', 'questions', 'reason', 'reference', 'related', 'relations', 'relevant', 'rename', 'reopen',
    'report', 'request', 'results', 'review', 'reviewed', 'returned', 'save', 'scope', 'search', 'seeded', 'select',
    'set', 'should', 'show', 'shows', 'side', 'single', 'space', 'sheet', 'stage', 'standalone', 'stay', 'strongest',
    'sufficient', 'summary', 'surfaced', 'table', 'target', 'task', 'text', 'that', 'the', 'their', 'there', 'this',
    'title', 'to', 'treat', 'two', 'ui', 'under', 'unless', 'user', 'using', 'variant', 'variants', 'versus', 'was',
    'were', 'while', 'with', 'work', 'worker', 'workflow', 'workflows', 'workspace'
]);
const HUMANIZE_ACRONYMS = new Map([
    ['api', 'API'],
    ['html', 'HTML'],
    ['id', 'ID'],
    ['json', 'JSON'],
    ['kb', 'KB'],
    ['pbi', 'PBI'],
    ['ui', 'UI']
]);
function humanizeReadableText(value) {
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
        return humanizeReadableSegment(part);
    })
        .join('')
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;!?])/g, '$1')
        .trim();
}
function humanizeReadableSegment(value) {
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
    const withVerbArticlesExpanded = withBoundaries.replace(/\b(Add|Create|Delete|Edit|List|Manage|Open|Remove|Review|Retire|Update|View)(a|an|the)\b/gi, (_, verb, article) => `${verb} ${article.toLowerCase()}`);
    return withVerbArticlesExpanded
        .split(/(\s+|[-/()"':;,.!?]+)/)
        .map((part) => humanizeReadableToken(part, aggressive))
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
function nextUniqueDiscoveryId(value, index, issuedIds) {
    const normalizedBaseId = typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : `discovery-${index + 1}`;
    let candidate = normalizedBaseId;
    let suffix = 2;
    while (issuedIds.has(candidate)) {
        candidate = `${normalizedBaseId}-${suffix}`;
        suffix += 1;
    }
    issuedIds.add(candidate);
    return candidate;
}
function humanizeReadableToken(token, aggressive) {
    if (!token || !/[A-Za-z]/.test(token) || /\s+/.test(token) || /[-/()"':;,.!?]+/.test(token)) {
        return token;
    }
    if (!/^[A-Za-z]+$/.test(token)) {
        return token;
    }
    if (!aggressive || token.length < 12) {
        return token;
    }
    const lower = token.toLowerCase();
    const segmented = segmentCollapsedWord(lower);
    if (!segmented) {
        return token;
    }
    const words = segmented.split(' ').map((word, index) => {
        const acronym = HUMANIZE_ACRONYMS.get(word);
        if (acronym) {
            return acronym;
        }
        if (index === 0 && /^[A-Z]/.test(token)) {
            return word.charAt(0).toUpperCase() + word.slice(1);
        }
        return word;
    });
    return words.join(' ');
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
            const partScore = isKnown
                ? (part.length * part.length) + 8
                : part.length <= 2
                    ? -100
                    : part.length === 3
                        ? -24
                        : -(part.length * 4);
            const nextScore = current.score + partScore;
            const existing = best[end];
            if (!existing || nextScore > existing.score) {
                best[end] = {
                    score: nextScore,
                    words: [...current.words, part]
                };
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
function humanizePlanReviewDelta(delta) {
    return {
        summary: humanizeReadableText(delta.summary),
        requestedChanges: delta.requestedChanges.map((item) => humanizeReadableText(item)),
        missingPbiIds: delta.missingPbiIds,
        missingCreates: delta.missingCreates.map((item) => humanizeReadableText(item)),
        missingEdits: delta.missingEdits.map((item) => humanizeReadableText(item)),
        additionalArticleWork: delta.additionalArticleWork.map((item) => humanizeReadableText(item)),
        targetCorrections: delta.targetCorrections.map((item) => humanizeReadableText(item)),
        overlapConflicts: delta.overlapConflicts.map((item) => humanizeReadableText(item))
    };
}
function mergePlanReviewDelta(existing, incoming) {
    const baseline = existing ?? {
        summary: '',
        requestedChanges: [],
        missingPbiIds: [],
        missingCreates: [],
        missingEdits: [],
        additionalArticleWork: [],
        targetCorrections: [],
        overlapConflicts: []
    };
    return {
        summary: incoming.summary?.trim()
            ? humanizeReadableText(incoming.summary)
            : baseline.summary,
        requestedChanges: dedupePlanReviewStrings([...baseline.requestedChanges, ...incoming.requestedChanges]).slice(0, 20),
        missingPbiIds: dedupePlanReviewStrings([...baseline.missingPbiIds, ...incoming.missingPbiIds]).slice(0, 20),
        missingCreates: dedupePlanReviewStrings([...baseline.missingCreates, ...incoming.missingCreates]).slice(0, 20),
        missingEdits: dedupePlanReviewStrings([...baseline.missingEdits, ...incoming.missingEdits]).slice(0, 20),
        additionalArticleWork: dedupePlanReviewStrings([...baseline.additionalArticleWork, ...incoming.additionalArticleWork]).slice(0, 20),
        targetCorrections: dedupePlanReviewStrings([...baseline.targetCorrections, ...incoming.targetCorrections]).slice(0, 20),
        overlapConflicts: dedupePlanReviewStrings([...baseline.overlapConflicts, ...incoming.overlapConflicts]).slice(0, 20)
    };
}
function dedupePlanReviewStrings(values) {
    return Array.from(new Set(values
        .map((value) => humanizeReadableText(value))
        .map((value) => value.trim())
        .filter(Boolean)));
}
function collectDeterministicClusterCoverageAssessments(params) {
    if (!params.plannerPrefetch) {
        return [];
    }
    const articleMatchesByCluster = new Map();
    for (const match of params.plannerPrefetch.articleMatches ?? []) {
        const existing = articleMatchesByCluster.get(match.clusterId) ?? [];
        existing.push(match);
        articleMatchesByCluster.set(match.clusterId, existing);
    }
    const relationSignalKeys = new Set(collectRelationTargetSignals(params.plannerPrefetch.relationMatches ?? [], params.normalizeTitle)
        .map((signal) => signal.key));
    return (params.plannerPrefetch.topicClusters ?? [])
        .filter((cluster) => Array.isArray(cluster.pbiIds) && cluster.pbiIds.length > 0)
        .map((cluster) => {
        const clusterPbiIds = new Set(cluster.pbiIds.map((pbiId) => pbiId.trim()).filter(Boolean));
        const relatedPlanItems = params.plan.items.filter((item) => item.pbiIds.some((pbiId) => clusterPbiIds.has(pbiId.trim())));
        const strongArticleSignals = collectStrongArticleTargetSignals(articleMatchesByCluster.get(cluster.clusterId) ?? [], params.normalizeTitle);
        const strongArticleSignalKeys = new Set(strongArticleSignals.map((signal) => signal.key));
        const supportedExistingSignalKeys = new Set([
            ...strongArticleSignalKeys,
            ...relationSignalKeys
        ]);
        const clusterMatches = articleMatchesByCluster.get(cluster.clusterId) ?? [];
        const hasSearchCoverage = clusterMatches.length >= Math.min(cluster.queries.length, 2);
        const hasNonZeroSearchHit = clusterMatches.some((match) => (match.total ?? 0) > 0 || (match.topResults?.length ?? 0) > 0);
        return {
            clusterId: cluster.clusterId,
            displayTitle: humanizeReadableText(cluster.label || cluster.sampleTitles[0] || cluster.queries[0] || `Cluster ${cluster.clusterId}`),
            pbiIds: cluster.pbiIds.map((pbiId) => pbiId.trim()).filter(Boolean),
            relatedPlanItems,
            hasCreateCoverage: relatedPlanItems.some((item) => item.action === 'create'),
            hasStrongArticleSignal: strongArticleSignals.length > 0,
            hasStrongArticleCoverage: relatedPlanItems
                .filter((item) => item.action !== 'create')
                .some((item) => planItemMatchesTargetSignals(item, strongArticleSignalKeys, params.normalizeTitle)),
            hasSupportedExistingCoverage: relatedPlanItems
                .filter((item) => item.action !== 'create')
                .some((item) => planItemMatchesTargetSignals(item, supportedExistingSignalKeys, params.normalizeTitle)),
            hasSearchCoverage,
            hasNonZeroSearchHit,
            strongArticleTitles: strongArticleSignals.map((signal) => signal.title)
        };
    });
}
function collectStrongArticleTargetSignals(articleMatches, normalizeTitle) {
    const signals = [];
    const seen = new Set();
    articleMatches.forEach((match) => {
        const candidates = Array.isArray(match.topResults) ? match.topResults.slice(0, 2) : [];
        candidates.forEach((candidate) => {
            if (!isStrongExistingArticleMatch(candidate)) {
                return;
            }
            const signal = createDeterministicTargetSignal(candidate.title, candidate.familyId, normalizeTitle);
            if (!signal || seen.has(signal.key)) {
                return;
            }
            seen.add(signal.key);
            signals.push(signal);
        });
    });
    return signals;
}
function collectRelationTargetSignals(relationMatches, normalizeTitle) {
    const signals = [];
    const seen = new Set();
    relationMatches.forEach((match) => {
        const signal = createDeterministicTargetSignal(match.title, match.familyId, normalizeTitle);
        if (!signal || seen.has(signal.key)) {
            return;
        }
        seen.add(signal.key);
        signals.push(signal);
    });
    return signals;
}
function createDeterministicTargetSignal(title, familyId, normalizeTitle) {
    const normalizedTitle = typeof title === 'string' ? humanizeReadableText(title).trim() : '';
    if (!normalizedTitle) {
        return null;
    }
    return {
        key: familyId?.trim()
            ? `family:${familyId.trim()}`
            : `title:${normalizeTitle(normalizedTitle)}`,
        title: normalizedTitle
    };
}
function collectPlanItemTargetSignalKeys(item, normalizeTitle) {
    const keys = new Set();
    if (item.targetFamilyId?.trim()) {
        keys.add(`family:${item.targetFamilyId.trim()}`);
    }
    if (item.targetTitle?.trim()) {
        keys.add(`title:${normalizeTitle(item.targetTitle)}`);
    }
    return keys;
}
function planItemMatchesTargetSignals(item, signalKeys, normalizeTitle) {
    if (signalKeys.size === 0) {
        return false;
    }
    const planItemSignalKeys = collectPlanItemTargetSignalKeys(item, normalizeTitle);
    return Array.from(planItemSignalKeys).some((key) => signalKeys.has(key));
}
function isStrongExistingArticleMatch(candidate) {
    const score = typeof candidate.score === 'number' ? candidate.score : 0;
    const matchContext = typeof candidate.matchContext === 'string' ? candidate.matchContext : '';
    return matchContext === 'title' || matchContext === 'metadata' || score >= 0.18;
}
function shouldSynthesizeIncludeOrDeferQuestion(assessment) {
    const hasOnlyNonDecisiveCoverage = assessment.relatedPlanItems.length === 0
        || assessment.relatedPlanItems.every((item) => item.action === 'no_impact');
    const hasConcreteCoverageSignal = assessment.hasStrongArticleSignal
        || (assessment.hasSearchCoverage && !assessment.hasNonZeroSearchHit);
    return hasOnlyNonDecisiveCoverage && hasConcreteCoverageSignal;
}
function shouldSynthesizeStandaloneVsFoldQuestion(assessment) {
    return assessment.hasCreateCoverage
        && assessment.relatedPlanItems.length > 0
        && assessment.relatedPlanItems.every((item) => item.action === 'create')
        && assessment.hasStrongArticleSignal
        && !assessment.hasStrongArticleCoverage
        && assessment.strongArticleTitles.length === 1;
}
function createDeterministicQuestionId(kind, clusterId, title) {
    const normalizedTitle = title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return `deterministic-${kind}-${clusterId}-${normalizedTitle || 'question'}`;
}
function normalizeLocaleForComparison(value) {
    return value?.trim().toLowerCase() ?? '';
}
function normalizePlacementScopeId(value) {
    return value?.trim() ?? '';
}
function normalizePromptString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function normalizeBatchPlanPlacement(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const input = value;
    const placement = {
        categoryId: normalizePromptString(input.categoryId),
        categoryName: normalizePromptString(input.categoryName),
        sectionId: normalizePromptString(input.sectionId),
        sectionName: normalizePromptString(input.sectionName),
        articleTitle: normalizePromptString(input.articleTitle),
        parentArticleId: normalizePromptString(input.parentArticleId),
        notes: normalizePromptString(input.notes)
    };
    return Object.values(placement).some(Boolean) ? placement : undefined;
}
function doesPlacementMeetRequirement(actual, required) {
    const requiredCategoryId = normalizePlacementScopeId(required?.categoryId);
    const requiredSectionId = normalizePlacementScopeId(required?.sectionId);
    if (!requiredCategoryId && !requiredSectionId) {
        return true;
    }
    const actualCategoryId = normalizePlacementScopeId(actual?.categoryId);
    const actualSectionId = normalizePlacementScopeId(actual?.sectionId);
    if (requiredCategoryId && actualCategoryId !== requiredCategoryId) {
        return false;
    }
    if (requiredSectionId && actualSectionId !== requiredSectionId) {
        return false;
    }
    return true;
}
function describePlacementRequirement(required) {
    const categoryLabel = normalizePromptString(required?.categoryName) ?? normalizePlacementScopeId(required?.categoryId);
    const sectionLabel = normalizePromptString(required?.sectionName) ?? normalizePlacementScopeId(required?.sectionId);
    const parts = [
        categoryLabel ? `category ${categoryLabel}` : '',
        sectionLabel ? `section ${sectionLabel}` : ''
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : 'the approved placement';
}
function collectLinkedDiscoveryIds(params) {
    if (params.discoveredWork.length === 0) {
        return [];
    }
    const linkedPbiIds = new Set(params.linkedPbiIds.map((pbiId) => pbiId.trim()).filter(Boolean));
    const targetTitleKeys = new Set(params.targetTitles
        .map((title) => title.trim())
        .filter(Boolean)
        .map((title) => params.normalizeTitle(title)));
    return dedupeIdList(params.discoveredWork
        .filter((item) => item.requiresPlanAmendment !== false)
        .filter((item) => item.linkedPbiIds.some((pbiId) => linkedPbiIds.has(pbiId.trim()))
        || targetTitleKeys.has(params.normalizeTitle(item.suspectedTarget)))
        .map((item) => item.discoveryId));
}
function applyTextualTargetReplacementsToPlan(params) {
    const replacements = params.replacements
        .map((entry) => ({
        from: entry.from.trim(),
        to: entry.to.trim()
    }))
        .filter((entry) => entry.from && entry.to && entry.from !== entry.to);
    if (replacements.length === 0) {
        return params.plan;
    }
    const replaceText = (value) => {
        if (!value) {
            return value;
        }
        return replacements.reduce((current, entry) => current.split(entry.from).join(entry.to), value);
    };
    return {
        ...params.plan,
        summary: replaceText(params.plan.summary) ?? params.plan.summary,
        coverage: params.plan.coverage.map((row) => ({
            ...row,
            notes: replaceText(row.notes)
        })),
        items: params.plan.items.map((item) => ({
            ...item,
            reason: replaceText(item.reason) ?? item.reason,
            evidence: item.evidence.map((evidence) => ({
                ...evidence,
                ref: replaceText(evidence.ref) ?? evidence.ref,
                summary: replaceText(evidence.summary) ?? evidence.summary
            }))
        })),
        questions: (params.plan.questions ?? []).map((question) => ({
            ...question,
            prompt: replaceText(question.prompt) ?? question.prompt,
            reason: replaceText(question.reason) ?? question.reason,
            answer: replaceText(question.answer)
        })),
        openQuestions: params.plan.openQuestions.map((question) => replaceText(question) ?? question)
    };
}
function normalizeQuestionStatus(rawStatus, answer) {
    if (rawStatus === 'answered' || rawStatus === 'resolved' || rawStatus === 'dismissed' || rawStatus === 'pending') {
        return rawStatus;
    }
    return answer ? 'answered' : 'pending';
}
function hasOwn(candidate, key) {
    return Object.prototype.hasOwnProperty.call(candidate, key);
}
function serializeOpenQuestionPrompts(questions, legacyOpenQuestions) {
    const structuredQuestionByKey = new Map(questions
        .map((question) => [normalizeQuestionPromptKey(question.prompt), question]));
    const prompts = questions
        .filter((question) => shouldSurfaceQuestionPromptAsOpen(question))
        .map((question) => question.prompt?.trim())
        .filter((prompt) => Boolean(prompt));
    const legacy = Array.isArray(legacyOpenQuestions)
        ? legacyOpenQuestions
            .filter((entry) => typeof entry === 'string')
            .map((entry) => humanizeReadableText(entry))
            .filter((prompt) => {
            const matchingStructuredQuestion = structuredQuestionByKey.get(normalizeQuestionPromptKey(prompt));
            return !matchingStructuredQuestion || shouldSurfaceQuestionPromptAsOpen(matchingStructuredQuestion);
        })
        : [];
    return Array.from(new Set([...prompts, ...legacy]));
}
function filterPromptVisibleQuestions(questions) {
    return questions.filter((question) => shouldIncludeQuestionInPrompt(question));
}
function mergeStructuredQuestions(...questionGroups) {
    const merged = new Map();
    const legacyKeys = new Map();
    for (const question of questionGroups.flat()) {
        const mergeableQuestion = question;
        const questionId = typeof mergeableQuestion.id === 'string' && mergeableQuestion.id.trim()
            ? mergeableQuestion.id.trim()
            : '';
        const legacyKey = questionId ? normalizeQuestionLegacyKey(mergeableQuestion) : normalizeQuestionLegacyKey(mergeableQuestion);
        const key = questionId
            ? `id:${questionId}`
            : legacyKeys.get(legacyKey) ?? `legacy:${legacyKey}`;
        const existing = merged.get(key);
        if (!existing) {
            const normalizedQuestion = normalizeQuestionForMerge(mergeableQuestion);
            merged.set(key, normalizedQuestion);
            legacyKeys.set(normalizeQuestionLegacyKey(normalizedQuestion), key);
            continue;
        }
        const mergedQuestion = mergeTwoStructuredQuestions(existing, mergeableQuestion);
        merged.set(key, mergedQuestion);
        legacyKeys.set(normalizeQuestionLegacyKey(mergedQuestion), key);
    }
    return Array.from(merged.values()).map(stripQuestionMergeMeta);
}
function collectBlockingUserInputQuestions(...questionGroups) {
    return mergeStructuredQuestions(...questionGroups)
        .filter((question) => isPendingRequiredUserInputQuestion(question));
}
function normalizeQuestionForMerge(question) {
    return {
        ...question,
        linkedPbiIds: dedupeIdList(question.linkedPbiIds),
        linkedPlanItemIds: dedupeIdList(question.linkedPlanItemIds),
        linkedDiscoveryIds: dedupeIdList(question.linkedDiscoveryIds)
    };
}
function mergeTwoStructuredQuestions(existing, incoming) {
    const merged = {
        ...existing,
        id: existing.id?.trim() ? existing.id : incoming.id,
        questionSetId: shouldUseIncomingQuestionField(incoming, 'explicitQuestionSetId') && incoming.questionSetId?.trim()
            ? incoming.questionSetId.trim()
            : existing.questionSetId,
        prompt: shouldUseIncomingQuestionField(incoming, 'explicitPrompt') && incoming.prompt?.trim()
            ? incoming.prompt
            : existing.prompt,
        reason: shouldUseIncomingQuestionField(incoming, 'explicitReason') && incoming.reason?.trim()
            ? incoming.reason
            : existing.reason,
        requiresUserInput: shouldUseIncomingQuestionField(incoming, 'explicitRequiresUserInput')
            ? incoming.requiresUserInput
            : existing.requiresUserInput,
        linkedPbiIds: dedupeIdList([...(existing.linkedPbiIds ?? []), ...(incoming.linkedPbiIds ?? [])]),
        linkedPlanItemIds: dedupeIdList([...(existing.linkedPlanItemIds ?? []), ...(incoming.linkedPlanItemIds ?? [])]),
        linkedDiscoveryIds: dedupeIdList([...(existing.linkedDiscoveryIds ?? []), ...(incoming.linkedDiscoveryIds ?? [])]),
        answer: shouldUseIncomingQuestionField(incoming, 'explicitAnswer')
            ? incoming.answer
            : existing.answer,
        answeredAtUtc: shouldUseIncomingQuestionField(incoming, 'explicitAnsweredAtUtc') && incoming.answeredAtUtc
            ? incoming.answeredAtUtc
            : shouldUseIncomingQuestionField(incoming, 'explicitAnswer') && incoming.answer?.trim()
                ? incoming.answeredAtUtc ?? existing.answeredAtUtc
                : existing.answeredAtUtc,
        status: shouldUseIncomingQuestionField(incoming, 'explicitStatus') || shouldUseIncomingQuestionField(incoming, 'explicitAnswer')
            ? incoming.status
            : existing.status,
        createdAtUtc: existing.createdAtUtc ?? incoming.createdAtUtc,
        __mergeMeta: existing.__mergeMeta ?? incoming.__mergeMeta
    };
    return normalizeQuestionForMerge(merged);
}
function shouldUseIncomingQuestionField(question, field) {
    if (!question.__mergeMeta) {
        return true;
    }
    return Boolean(question.__mergeMeta[field]);
}
function stripQuestionMergeMeta(question) {
    const { __mergeMeta: _ignored, ...normalizedQuestion } = question;
    return normalizedQuestion;
}
function normalizeQuestionLegacyKey(question) {
    return `${normalizeQuestionPromptKey(question.prompt)}|${normalizeQuestionPromptKey(question.reason)}`;
}
function normalizeQuestionPromptKey(value) {
    return humanizeReadableText(value).trim().replace(/\s+/g, ' ').toLowerCase();
}
function dedupeIdList(values) {
    return Array.from(new Set((values ?? [])
        .map((value) => value.trim())
        .filter(Boolean)));
}
function isPendingRequiredUserInputQuestion(question) {
    return question.requiresUserInput
        && question.status === 'pending'
        && !question.answer?.trim();
}
function shouldSurfaceQuestionPromptAsOpen(question) {
    return question.status === 'pending'
        && !question.answer?.trim();
}
function shouldIncludeQuestionInPrompt(question) {
    return question.status !== 'dismissed'
        && question.status !== 'resolved';
}
function normalizePlanCoverage(item) {
    const planItemIds = Array.isArray(item.planItemIds)
        ? item.planItemIds.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    const rawOutcome = item.outcome;
    let outcome;
    switch (rawOutcome) {
        case 'covered':
        case 'gap':
        case 'no_impact':
        case 'blocked':
            outcome = rawOutcome;
            break;
        default:
            outcome = planItemIds.length > 0 ? 'covered' : 'gap';
            break;
    }
    if (outcome === 'gap' && planItemIds.length > 0) {
        outcome = 'covered';
    }
    return {
        ...item,
        outcome,
        planItemIds,
        notes: typeof item.notes === 'string' ? humanizeReadableText(item.notes) : item.notes
    };
}
function humanizeFinalReviewDelta(delta) {
    return {
        summary: humanizeReadableText(delta.summary),
        requestedRework: delta.requestedRework.map((item) => humanizeReadableText(item)),
        uncoveredPbiIds: delta.uncoveredPbiIds,
        missingArticleChanges: delta.missingArticleChanges.map((item) => humanizeReadableText(item)),
        duplicateRiskTitles: delta.duplicateRiskTitles.map((item) => humanizeReadableText(item)),
        unnecessaryChanges: delta.unnecessaryChanges.map((item) => humanizeReadableText(item)),
        unresolvedAmbiguities: delta.unresolvedAmbiguities.map((item) => humanizeReadableText(item))
    };
}
function truncatePromptText(value, maxLength) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return undefined;
    }
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 3)}...`;
}
function countArray(value) {
    return Array.isArray(value) ? value.length : 0;
}
