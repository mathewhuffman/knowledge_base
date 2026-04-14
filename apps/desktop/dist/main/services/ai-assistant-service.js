"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiAssistantService = void 0;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const shared_types_1 = require("@kb-vault/shared-types");
const db_1 = require("@kb-vault/db");
const DEFAULT_DB_FILE = 'kb-vault.sqlite';
const ASSISTANT_BATCH_NAME = 'AI Assistant Proposals';
const ASSISTANT_CHAT_RUNTIME_RETRY_LIMIT = 1;
const ASSISTANT_CHAT_COMPLETION_RETRY_LIMIT = 1;
const ASSISTANT_CHAT_TRANSCRIPT_IDLE_MS = 1_500;
const ASSISTANT_CHAT_TRANSCRIPT_MAX_WAIT_MS = 5_000;
const ASSISTANT_CHAT_RESEARCH_TRANSCRIPT_IDLE_MS = 2_500;
const ASSISTANT_CHAT_RESEARCH_TRANSCRIPT_MAX_WAIT_MS = 60_000;
const ASSISTANT_CHAT_TRANSCRIPT_POLL_MS = 250;
const ASSISTANT_CHAT_COMPLETION_FOLLOWUP_PROMPT = [
    'Complete the same user request using the research already gathered in this session.',
    'Return the final user-facing answer now.',
    'Do not send a progress update.',
    'Use only kb commands if one final targeted lookup is still truly required.'
].join(' ');
class AiAssistantService {
    workspaceRepository;
    agentRuntime;
    resolveWorkspaceKbAccessMode;
    appWorkingStateService;
    emitAssistantEvent;
    constructor(workspaceRepository, agentRuntime, resolveWorkspaceKbAccessMode, appWorkingStateService, emitAssistantEvent) {
        this.workspaceRepository = workspaceRepository;
        this.agentRuntime = agentRuntime;
        this.resolveWorkspaceKbAccessMode = resolveWorkspaceKbAccessMode;
        this.appWorkingStateService = appWorkingStateService;
        this.emitAssistantEvent = emitAssistantEvent;
    }
    async getContext(input) {
        await this.workspaceRepository.getWorkspace(input.workspaceId);
        return input.context;
    }
    async getSession(input) {
        await this.workspaceRepository.getWorkspace(input.workspaceId);
        const db = await this.openAssistantDb(input.workspaceId);
        try {
            const session = input.sessionId
                ? this.findSessionById(db, input.workspaceId, input.sessionId)
                : this.findActiveSession(db, input.workspaceId);
            if (!session) {
                return {
                    workspaceId: input.workspaceId,
                    messages: []
                };
            }
            return {
                workspaceId: input.workspaceId,
                session: this.mapSessionRow(session),
                messages: this.listMessages(db, session.id),
                artifact: session.latestArtifactId ? this.getArtifact(db, input.workspaceId, session.latestArtifactId) : undefined
            };
        }
        finally {
            db.close();
        }
    }
    async listSessions(input) {
        await this.workspaceRepository.getWorkspace(input.workspaceId);
        const db = await this.openAssistantDb(input.workspaceId);
        try {
            const sessions = this.listSessionsForWorkspace(db, input.workspaceId, input.includeArchived ?? false);
            return {
                workspaceId: input.workspaceId,
                activeSessionId: sessions.find((session) => session.lifecycleStatus === 'active')?.id,
                sessions: sessions.map((session) => this.mapSessionRow(session))
            };
        }
        finally {
            db.close();
        }
    }
    async createSession(input) {
        await this.workspaceRepository.getWorkspace(input.workspaceId);
        const db = await this.openAssistantDb(input.workspaceId);
        try {
            const session = this.createFreshSession(db, input.workspaceId, input.title);
            return {
                workspaceId: input.workspaceId,
                session: this.mapSessionRow(session),
                messages: []
            };
        }
        finally {
            db.close();
        }
    }
    async openSession(input) {
        await this.workspaceRepository.getWorkspace(input.workspaceId);
        const db = await this.openAssistantDb(input.workspaceId);
        try {
            const session = this.activateSession(db, input.workspaceId, input.sessionId);
            return {
                workspaceId: input.workspaceId,
                session: this.mapSessionRow(session),
                messages: this.listMessages(db, session.id),
                artifact: session.latestArtifactId ? this.getArtifact(db, input.workspaceId, session.latestArtifactId) : undefined
            };
        }
        finally {
            db.close();
        }
    }
    async deleteSession(input) {
        await this.workspaceRepository.getWorkspace(input.workspaceId);
        const db = await this.openAssistantDb(input.workspaceId);
        try {
            const session = this.requireSessionById(db, input.workspaceId, input.sessionId);
            const deleteParams = {
                workspaceId: input.workspaceId,
                sessionId: input.sessionId
            };
            db.run(`DELETE FROM ai_artifacts WHERE workspace_id = @workspaceId AND session_id = @sessionId`, deleteParams);
            db.run(`DELETE FROM ai_messages WHERE workspace_id = @workspaceId AND session_id = @sessionId`, deleteParams);
            db.run(`DELETE FROM ai_sessions WHERE workspace_id = @workspaceId AND id = @sessionId`, deleteParams);
            const nextActive = this.findActiveSession(db, input.workspaceId);
            if (nextActive) {
                return {
                    workspaceId: input.workspaceId,
                    session: this.mapSessionRow(nextActive),
                    messages: this.listMessages(db, nextActive.id),
                    artifact: nextActive.latestArtifactId ? this.getArtifact(db, input.workspaceId, nextActive.latestArtifactId) : undefined
                };
            }
            const nextClosed = this.listSessionsForWorkspace(db, input.workspaceId, false)[0];
            if (nextClosed) {
                const activated = this.activateSession(db, input.workspaceId, nextClosed.id);
                return {
                    workspaceId: input.workspaceId,
                    session: this.mapSessionRow(activated),
                    messages: this.listMessages(db, activated.id),
                    artifact: activated.latestArtifactId ? this.getArtifact(db, input.workspaceId, activated.latestArtifactId) : undefined
                };
            }
            return {
                workspaceId: input.workspaceId,
                messages: []
            };
        }
        finally {
            db.close();
        }
    }
    async resetSession(input) {
        const db = await this.openAssistantDb(input.workspaceId);
        try {
            const session = this.requireSessionById(db, input.workspaceId, input.sessionId);
            db.run(`DELETE FROM ai_messages WHERE workspace_id = @workspaceId AND session_id = @sessionId`, {
                workspaceId: input.workspaceId,
                sessionId: input.sessionId
            });
            db.run(`DELETE FROM ai_artifacts WHERE workspace_id = @workspaceId AND session_id = @sessionId`, {
                workspaceId: input.workspaceId,
                sessionId: input.sessionId
            });
            db.run(`UPDATE ai_sessions
         SET status = 'idle',
             latest_artifact_id = NULL,
             title = @title,
             last_message_at = NULL,
             updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND id = @sessionId`, {
                ...input,
                title: this.defaultSessionTitle(),
                updatedAt: new Date().toISOString()
            });
            const refreshed = this.requireSessionById(db, input.workspaceId, input.sessionId);
            return {
                workspaceId: input.workspaceId,
                session: this.mapSessionRow(refreshed),
                messages: []
            };
        }
        finally {
            db.close();
        }
    }
    async sendMessage(input) {
        const context = input.context;
        const db = await this.openAssistantDb(input.workspaceId);
        const turnId = (0, node_crypto_1.randomUUID)();
        let activeSessionId = input.sessionId ?? 'pending-session';
        try {
            const session = this.ensureSession(db, context, input.sessionId);
            activeSessionId = session.id;
            const userMessageTimestamp = new Date().toISOString();
            this.insertMessage(db, {
                id: (0, node_crypto_1.randomUUID)(),
                sessionId: session.id,
                workspaceId: input.workspaceId,
                role: 'user',
                messageKind: 'chat',
                content: input.message.trim(),
                metadata: this.buildContextMetadata(context),
                createdAtUtc: userMessageTimestamp
            });
            this.updateSessionStatus(db, session.id, input.workspaceId, 'running', context, userMessageTimestamp, input.message.trim());
            this.publishAssistantEvent({
                workspaceId: input.workspaceId,
                sessionId: session.id,
                turnId,
                kind: 'turn_started',
                atUtc: userMessageTimestamp,
                message: input.message.trim()
            });
            const workspaceKbAccessMode = await this.resolveWorkspaceKbAccessMode(input.workspaceId);
            const kbAccessMode = context.capabilities.canUseUnsavedWorkingState ? 'cli' : workspaceKbAccessMode;
            const localeVariantId = this.resolveRuntimeLocaleVariantId(context);
            let runtimeSessionId = session.runtimeSessionId ?? undefined;
            let runtimePrompt = this.buildAskPrompt(context, input.message, this.listMessages(db, session.id), runtimeSessionId == null);
            let runtimeAttempt = 0;
            let completionAttempt = 0;
            let runtimeResult;
            let transcriptInspection;
            const turnAudit = {
                thoughtText: '',
                toolEvents: []
            };
            while (true) {
                runtimeResult = await this.agentRuntime.runAssistantChat({
                    workspaceId: input.workspaceId,
                    localeVariantId,
                    sessionId: runtimeSessionId,
                    kbAccessMode,
                    sessionMode: 'agent',
                    locale: context.subject?.locale,
                    prompt: runtimePrompt,
                    sessionType: 'assistant_chat'
                }, (stream) => {
                    this.publishAssistantStreamEvent(input.workspaceId, session.id, turnId, stream, turnAudit);
                }, () => false);
                turnAudit.completionState = runtimeResult.completionState;
                turnAudit.isFinal = runtimeResult.isFinal;
                if (runtimeResult.status === 'error'
                    && runtimeAttempt < ASSISTANT_CHAT_RUNTIME_RETRY_LIMIT
                    && isRetriableAssistantRuntimeFailure(runtimeResult.message)) {
                    runtimeAttempt += 1;
                    runtimeSessionId = undefined;
                    runtimePrompt = this.buildAskPrompt(context, input.message, this.listMessages(db, session.id), true);
                    continue;
                }
                await this.waitForTranscriptToQuiesce(runtimeResult.transcriptPath, ASSISTANT_CHAT_TRANSCRIPT_IDLE_MS, ASSISTANT_CHAT_TRANSCRIPT_MAX_WAIT_MS);
                transcriptInspection = await this.inspectTranscriptAssistantTurn(runtimeResult.transcriptPath);
                if (transcriptInspection.sawToolCalls && !transcriptInspection.hasPostToolAnswer) {
                    await this.waitForTranscriptToQuiesce(runtimeResult.transcriptPath, ASSISTANT_CHAT_RESEARCH_TRANSCRIPT_IDLE_MS, ASSISTANT_CHAT_RESEARCH_TRANSCRIPT_MAX_WAIT_MS);
                    transcriptInspection = await this.inspectTranscriptAssistantTurn(runtimeResult.transcriptPath);
                }
                const needsContinuationFromContract = runtimeResult.status !== 'error'
                    && runtimeResult.isFinal === false
                    && completionAttempt < ASSISTANT_CHAT_COMPLETION_RETRY_LIMIT;
                const needsContinuationFromLegacyFallback = runtimeResult.status !== 'error'
                    && runtimeResult.isFinal !== false
                    && transcriptInspection.sawToolCalls
                    && !transcriptInspection.hasPostToolAnswer
                    && completionAttempt < ASSISTANT_CHAT_COMPLETION_RETRY_LIMIT;
                if (needsContinuationFromContract || needsContinuationFromLegacyFallback) {
                    completionAttempt += 1;
                    runtimeSessionId = runtimeResult.sessionId;
                    runtimePrompt = this.buildAssistantContinuationPrompt(context, input.message, this.listMessages(db, session.id));
                    continue;
                }
                break;
            }
            const directWorkingStateMutationApplied = this.didWorkingStateChangeDuringTurn(context);
            const runtimeToolEvents = mapRuntimeToolAudit(runtimeResult.toolCalls);
            if (runtimeToolEvents.length > 0) {
                turnAudit.toolEvents = mergeAssistantToolEvents(turnAudit.toolEvents, runtimeToolEvents);
            }
            const transcriptToolEvents = await this.extractTranscriptToolAudit(runtimeResult.transcriptPath);
            if (transcriptToolEvents.length > 0) {
                turnAudit.toolEvents = mergeAssistantToolEvents(turnAudit.toolEvents, transcriptToolEvents);
            }
            const transcriptFallbackText = transcriptInspection?.preferredText
                ?? await this.extractTranscriptAssistantText(runtimeResult.transcriptPath);
            const parsed = this.parseRuntimeResult(runtimeResult.resultPayload, context, input.message, directWorkingStateMutationApplied, transcriptFallbackText, runtimeResult.status === 'error' ? runtimeResult.message : undefined);
            turnAudit.completionState = parsed.completionState;
            turnAudit.isFinal = parsed.isFinal;
            const artifact = this.insertArtifact(db, {
                sessionId: session.id,
                workspaceId: input.workspaceId,
                entityType: context.subject?.type,
                entityId: context.subject?.id,
                baseVersionToken: context.workingState?.versionToken,
                artifactType: parsed.artifactType,
                summary: parsed.summary,
                payload: this.buildArtifactPayload(parsed, context),
                status: 'pending'
            });
            const uiActions = this.buildUiActions(context, artifact);
            const autoApply = this.shouldAutoApplyArtifact(context, artifact, uiActions);
            const nextStatus = autoApply ? 'applied' : 'pending';
            if (autoApply) {
                await this.applyArtifactSideEffects(context, artifact);
                this.updateArtifactStatus(db, input.workspaceId, artifact.id, nextStatus);
            }
            const assistantMessage = this.insertMessage(db, {
                id: (0, node_crypto_1.randomUUID)(),
                sessionId: session.id,
                workspaceId: input.workspaceId,
                role: 'assistant',
                messageKind: artifact.artifactType === 'informational_response' ? 'chat' : 'artifact',
                content: parsed.response,
                metadata: {
                    ...this.buildAssistantMessageAuditMetadata(turnAudit),
                    artifactId: artifact.id,
                    artifactType: artifact.artifactType,
                    ...this.buildContextMetadata(context)
                },
                createdAtUtc: new Date().toISOString()
            });
            this.updateSessionAfterTurn(db, input.workspaceId, session.id, runtimeResult.sessionId, autoApply ? 'idle' : 'has_pending_artifact', artifact.id, context, assistantMessage.createdAtUtc, parsed.title);
            this.publishAssistantEvent({
                workspaceId: input.workspaceId,
                sessionId: session.id,
                turnId,
                kind: 'turn_finished',
                atUtc: assistantMessage.createdAtUtc,
                messageId: assistantMessage.id,
                artifactId: artifact.id
            });
            const refreshedSession = this.requireSessionById(db, input.workspaceId, session.id);
            const refreshedArtifact = this.getArtifact(db, input.workspaceId, artifact.id);
            return {
                workspaceId: input.workspaceId,
                session: this.mapSessionRow(refreshedSession),
                messages: this.listMessages(db, session.id),
                context,
                artifact: refreshedArtifact,
                uiActions
            };
        }
        catch (error) {
            if (activeSessionId !== 'pending-session') {
                this.updateSessionStatus(db, activeSessionId, input.workspaceId, 'error', context, new Date().toISOString());
            }
            this.publishAssistantEvent({
                workspaceId: input.workspaceId,
                sessionId: activeSessionId,
                turnId,
                kind: 'turn_error',
                atUtc: new Date().toISOString(),
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
        finally {
            db.close();
        }
    }
    async applyArtifact(input) {
        const db = await this.openAssistantDb(input.workspaceId);
        try {
            const session = this.requireSessionById(db, input.workspaceId, input.sessionId);
            const artifact = this.requireArtifact(db, input.workspaceId, input.artifactId);
            let createdProposalId;
            let uiActions = this.buildUiActionsFromArtifact(artifact);
            if (artifact.artifactType === 'proposal_candidate') {
                createdProposalId = await this.promoteProposalCandidate(input.workspaceId, artifact);
                uiActions = [{ type: 'show_proposal_created', proposalId: createdProposalId }];
            }
            else {
                await this.applyArtifactSideEffects(undefined, artifact);
            }
            this.updateArtifactStatus(db, input.workspaceId, artifact.id, 'applied');
            this.insertMessage(db, {
                id: (0, node_crypto_1.randomUUID)(),
                sessionId: session.id,
                workspaceId: input.workspaceId,
                role: 'assistant',
                messageKind: 'decision',
                content: createdProposalId ? 'Created a proposal draft from the assistant candidate.' : 'Applied the latest assistant artifact.',
                metadata: { artifactId: artifact.id },
                createdAtUtc: new Date().toISOString()
            });
            this.updateSessionAfterTurn(db, input.workspaceId, session.id, session.runtimeSessionId ?? undefined, 'idle', artifact.id);
            return {
                workspaceId: input.workspaceId,
                session: this.mapSessionRow(this.requireSessionById(db, input.workspaceId, session.id)),
                messages: this.listMessages(db, session.id),
                artifact: this.getArtifact(db, input.workspaceId, artifact.id),
                uiActions,
                createdProposalId
            };
        }
        finally {
            db.close();
        }
    }
    async rejectArtifact(input) {
        const db = await this.openAssistantDb(input.workspaceId);
        try {
            const session = this.requireSessionById(db, input.workspaceId, input.sessionId);
            const artifact = this.requireArtifact(db, input.workspaceId, input.artifactId);
            this.updateArtifactStatus(db, input.workspaceId, artifact.id, 'rejected');
            this.insertMessage(db, {
                id: (0, node_crypto_1.randomUUID)(),
                sessionId: session.id,
                workspaceId: input.workspaceId,
                role: 'assistant',
                messageKind: 'decision',
                content: 'Discarded the latest assistant artifact.',
                metadata: { artifactId: artifact.id },
                createdAtUtc: new Date().toISOString()
            });
            this.updateSessionAfterTurn(db, input.workspaceId, session.id, session.runtimeSessionId ?? undefined, 'idle', artifact.id);
            return {
                workspaceId: input.workspaceId,
                session: this.mapSessionRow(this.requireSessionById(db, input.workspaceId, session.id)),
                messages: this.listMessages(db, session.id),
                artifact: this.getArtifact(db, input.workspaceId, artifact.id),
                uiActions: [{ type: 'none' }]
            };
        }
        finally {
            db.close();
        }
    }
    async promoteProposalCandidate(workspaceId, artifact) {
        const payload = (artifact.payload ?? {});
        const batchId = await this.ensureAssistantBatch(workspaceId);
        const action = this.normalizeProposalAction(payload.action);
        const subjectMeta = payload.metadata ?? {};
        const proposal = await this.workspaceRepository.createAgentProposal({
            workspaceId,
            batchId,
            action,
            familyId: extractString(subjectMeta.familyId),
            localeVariantId: extractString(subjectMeta.localeVariantId),
            sourceRevisionId: extractString(subjectMeta.sourceRevisionId),
            targetTitle: payload.targetTitle,
            targetLocale: payload.targetLocale,
            confidenceScore: payload.confidenceScore,
            rationale: payload.rationale,
            rationaleSummary: payload.rationaleSummary,
            aiNotes: payload.aiNotes,
            sourceHtml: payload.sourceHtml,
            proposedHtml: payload.proposedHtml,
            metadata: subjectMeta
        });
        return proposal.id;
    }
    async applyArtifactSideEffects(context, artifact) {
        if (artifact.artifactType !== 'proposal_patch') {
            return;
        }
        const proposalContext = context && context.subject?.type === 'proposal' ? context : undefined;
        const payload = artifact.payload;
        const targetProposalIds = proposalContext
            ? await this.resolveProposalPatchTargets(proposalContext, payload)
            : [artifact.entityId].filter(Boolean);
        if (targetProposalIds.length === 0) {
            return;
        }
        if ((payload.scope === 'article' || payload.scope === 'batch') && payload.html && !(payload.lineEdits?.length)) {
            throw new Error('Multi-proposal proposal patches must use targeted line edits instead of full HTML replacement.');
        }
        for (const proposalId of targetProposalIds) {
            const detail = await this.workspaceRepository.getProposalReviewDetail(artifact.workspaceId, proposalId);
            const nextHtml = applyProposalPatchToHtml(detail.diff.afterHtml ?? '', payload);
            const persistedPatch = {
                ...payload,
                html: nextHtml
            };
            await this.workspaceRepository.updateProposalReviewWorkingCopy(artifact.workspaceId, proposalId, persistedPatch);
            if (proposalContext?.subject?.id === proposalId) {
                try {
                    this.appWorkingStateService.patchForm({
                        workspaceId: proposalContext.workspaceId,
                        route: shared_types_1.AppRoute.PROPOSAL_REVIEW,
                        entityType: 'proposal',
                        entityId: proposalId,
                        versionToken: proposalContext.workingState?.versionToken,
                        patch: buildProposalWorkingStatePatch(persistedPatch)
                    });
                }
                catch {
                    // If the route working state is no longer registered, the durable proposal update still succeeded.
                }
            }
        }
    }
    async ensureAssistantBatch(workspaceId) {
        const db = await this.openAssistantDb(workspaceId);
        try {
            const existing = db.get(`SELECT id
         FROM pbi_batches
         WHERE workspace_id = @workspaceId AND name = @name
         ORDER BY imported_at DESC
         LIMIT 1`, { workspaceId, name: ASSISTANT_BATCH_NAME });
            if (existing?.id) {
                return existing.id;
            }
        }
        finally {
            db.close();
        }
        const created = await this.workspaceRepository.createPBIBatch(workspaceId, ASSISTANT_BATCH_NAME, 'ai-assistant', 'assistant/generated', shared_types_1.PBIImportFormat.CSV, 0, {
            candidateRowCount: 0,
            malformedRowCount: 0,
            duplicateRowCount: 0,
            ignoredRowCount: 0,
            scopedRowCount: 0
        }, shared_types_1.PBIBatchScopeMode.ALL);
        return created.id;
    }
    publishAssistantEvent(event) {
        this.emitAssistantEvent?.(event);
    }
    publishAssistantStreamEvent(workspaceId, sessionId, turnId, stream, audit) {
        const atUtc = stream.atUtc || new Date().toISOString();
        const normalized = normalizeAssistantStreamPayload(workspaceId, sessionId, turnId, atUtc, stream);
        if (audit) {
            applyAssistantAuditEvents(audit, normalized);
        }
        for (const event of normalized) {
            this.publishAssistantEvent(event);
        }
    }
    buildAssistantMessageAuditMetadata(audit) {
        const thoughtText = audit.thoughtText.trim();
        const toolEvents = audit.toolEvents.filter((event) => (!isFilteredAssistantToolName(event.toolName)
            && Boolean(event.toolName || event.resourceLabel || event.toolStatus)));
        if (!thoughtText && toolEvents.length === 0 && !audit.completionState && audit.isFinal === undefined) {
            return undefined;
        }
        return {
            ...(thoughtText ? { thoughtText } : {}),
            ...(toolEvents.length > 0 ? { toolEvents } : {}),
            ...(audit.completionState ? { completionState: audit.completionState } : {}),
            ...(audit.isFinal !== undefined ? { isFinal: audit.isFinal } : {})
        };
    }
    buildAskPrompt(context, message, messages, includeTranscript) {
        const allowedArtifacts = this.allowedArtifactTypes(context);
        const transcript = includeTranscript
            ? messages
                .slice(-8)
                .map((item) => `${item.role.toUpperCase()} (${item.messageKind}): ${summarizePromptText(item.content, 700)}`)
                .join('\n')
            : '';
        const workingStateSummary = summarizePromptData(context.workingState);
        const backingDataSummary = summarizePromptData(context.backingData);
        return [
            'You are the KB Vault global AI assistant.',
            'For every assistant-chat reply, return JSON. The `response` field is the only user-visible text.',
            'Write in clear, natural English. Do not imitate malformed wording from prior assistant turns or raw source content.',
            'When you do return JSON, use this schema:',
            '{',
            '  "command": "none | create_proposal | patch_proposal | patch_draft | patch_template",',
            '  "artifactType": "informational_response | proposal_candidate | proposal_patch | draft_patch | template_patch | clarification_request",',
            '  "completionState": "completed | researching | needs_user_input | blocked | errored",',
            '  "isFinal": true,',
            '  "response": "assistant-visible message",',
            '  "summary": "optional short summary for non-chat artifacts only",',
            '  "rationale": "optional rationale",',
            '  "title": "optional short chat/session title or artifact title",',
            '  "confidenceScore": "optional number from 0 to 1 for proposal candidates",',
            '  "html": "full replacement HTML for proposal_patch or draft_patch when returning the whole document",',
            '  "formPatch": { "name"?: "...", "language"?: "...", "templateType"?: "...", "promptTemplate"?: "...", "toneRules"?: "...", "description"?: "...", "examples"?: "...", "active"?: true },',
            '  "payload": { "targetTitle"?: "...", "targetLocale"?: "...", "sourceHtml"?: "...", "proposedHtml"?: "...", "confidenceScore"?: 0.0, "scope"?: "current|article|batch", "targetArticleKey"?: "...", "lineEdits"?: [{ "type": "replace_lines|insert_after|delete_lines", "startLine"?: 1, "endLine"?: 1, "line"?: 1, "lines"?: ["..."], "expectedText"?: "..." }], "metadata"?: {} }',
            '}',
            `Route: ${context.route}`,
            `Route label: ${context.routeLabel}`,
            context.subject ? `Subject: ${JSON.stringify(context.subject)}` : 'Subject: none',
            `Capabilities: ${JSON.stringify(context.capabilities)}`,
            `Allowed artifact types: ${allowedArtifacts.join(', ')}`,
            context.workingState ? `Working state: ${JSON.stringify(workingStateSummary)}` : 'Working state: none',
            `Backing data: ${JSON.stringify(backingDataSummary)}`,
            includeTranscript ? 'Recent messages are included below because this runtime session is new or was recovered.' : '',
            transcript ? `Recent messages:\n${transcript}` : '',
            `User message: ${message.trim()}`,
            'Rules:',
            '- Use working state as the source of truth when it exists.',
            '- Do not silently publish, finalize, or persist user content.',
            '- Your primary job is to answer the user\'s actual request.',
            '- Every reply must include `completionState` and `isFinal` in the JSON envelope.',
            '- For a finished answer, set `completionState="completed"` and `isFinal=true`.',
            '- If you are still researching or the turn must continue automatically, set `completionState="researching"` and `isFinal=false`.',
            '- If you need a user answer before continuing, set `completionState="needs_user_input"` and `isFinal=true`.',
            '- If you are blocked or hit a hard failure, set `completionState="blocked"` or `completionState="errored"` and `isFinal=true`.',
            '- Do not send a progress update with `isFinal=true`.',
            '- Any mutating result must include an explicit command and valid JSON. Without a valid command, the result will be treated as informational_response.',
            '- If the answer is already clear from the provided context, answer immediately without using tools.',
            '- If workspace knowledge is needed, use the minimum KB lookup path required to answer accurately.',
            '- For app-feature, workflow, or terminology questions, default to this sequence: `kb search-kb --workspace-id <workspace-id> --query "<topic>" --json`, `kb get-article --workspace-id <workspace-id> --locale-variant-id <locale-variant-id> --json` for the best 1-3 matches, then answer the user clearly.',
            '- If the user explicitly asks you to research, ponder, look up, or investigate something, do that work and then return the final findings in the same turn. Do not stop on a progress update.',
            '- Keep progress, working notes, and intermediate reasoning out of the user-visible reply. If the runtime supports separate thought updates, use those instead of status messages.',
            '- When research or data lookup is needed, use only the direct KB tools or kb commands needed for the answer. Never use terminal commands like grep, Read File, codebase search, or filesystem exploration.',
            '- If direct KB tools are available, prefer those. If the runtime only exposes Shell or Terminal, it may be used only for exact `kb` CLI commands.',
            '- Prefer `search-kb` first and `get-article` second for ordinary user questions about the app.',
            '- Use `kb get-article-family` only when one clearly relevant article needs family or locale context.',
            '- Use `kb batch-context`, `kb find-related-articles`, proposal commands, and form-editing commands only when the route or user request clearly requires them.',
            '- Use `kb help --json` only if a needed KB command is genuinely unclear. Do not spend the turn exploring command syntax when the answer can be produced from `search-kb` plus `get-article`.',
            '- Do not use tools just to decide what to do next.',
            '- For informational_response, put only the user-facing reply in `response`. Do not include chain-of-thought, policy commentary, analysis, or extra JSON-shaped explanation outside the response field.',
            '- On the first meaningful reply in a new chat, include a short human-readable title in "title" based on the user request.',
            '- For informational_response, omit summary unless it is genuinely needed for internal bookkeeping.',
            '- For draft edits, return the full replacement HTML in "html".',
            '- For proposal review edits, the preferred path is to directly mutate the current proposal working state with `kb app get-form-schema` and `kb app patch-form --route proposal_review --entity-type proposal --entity-id <current proposal id>` using the registered version token.',
            '- In Proposal Review, do not create or edit a separate proposal record. Edit the currently open proposal directly.',
            '- Never call `kb proposal create`, `kb proposal edit`, or `kb proposal retire` when the current route is Proposal Review.',
            '- If you use `kb app patch-form` successfully in Proposal Review, respond with informational_response summarizing the applied change.',
            '- If you are returning a JSON proposal patch instead of using app commands, prefer targeted "payload.lineEdits" when the change is narrow. Use "html" only when the whole proposal needs rewriting.',
            '- In Proposal Review JSON patches, use payload.scope="current" for the selected proposal, payload.scope="article" for the article currently being reviewed, and payload.scope="batch" only when the user clearly asks to update every proposal in the open review batch.',
            '- For live form edits such as Templates & Prompts, use the kb CLI commands as the source of truth: call `kb app get-form-schema` first when needed, then call `kb app patch-form`.',
            '- After a successful `kb app patch-form`, respond with informational_response that accurately summarizes the applied change.',
            '- If the kb command does not succeed, do not claim the field changed. Describe the failure or offer a suggestion instead.',
            '- Do not use command=patch_template for live form edits. The app now updates those forms from successful kb commands, not from parsed assistant JSON.',
            '- Only use proposal_candidate on article view when the user clearly asks to change, rewrite, update, or create a proposal for the article.',
            '- Use command=create_proposal only when you are explicitly creating a proposal candidate.',
            '- Every proposal_candidate must include confidenceScore as a number between 0 and 1 based on the strength of the evidence.',
            '- Use command=patch_proposal only when you are explicitly returning a proposal patch.',
            '- Use command=patch_draft only when you are explicitly returning a draft patch.',
            '- For normal questions like "what page am I on", "can you see my inputs", explanations, summaries, navigation help, or workflow advice, use command=none and artifactType=informational_response.'
        ].filter(Boolean).join('\n\n');
    }
    buildAssistantContinuationPrompt(context, message, messages) {
        return [
            this.buildAskPrompt(context, message, messages, true),
            'Continuation instructions:',
            ASSISTANT_CHAT_COMPLETION_FOLLOWUP_PROMPT
        ].join('\n\n');
    }
    parseRuntimeResult(resultPayload, context, userMessage, directWorkingStateMutationApplied = false, transcriptFallbackText, runtimeFailureMessage) {
        const parsed = selectPreferredAssistantEnvelope(resultPayload, transcriptFallbackText) ?? extractJsonObject(resultPayload);
        const allowed = new Set(this.allowedArtifactTypes(context));
        const requestedArtifactType = parsed?.artifactType && allowed.has(parsed.artifactType)
            ? parsed.artifactType
            : 'informational_response';
        const primaryResponse = extractString(parsed?.response)
            ?? extractString(parsed?.summary)
            ?? selectPreferredAssistantReply(resultPayload, transcriptFallbackText);
        const rawResponse = primaryResponse ?? runtimeFailureMessage;
        const response = unwrapAssistantDisplayText(rawResponse) ?? 'I ran into a runtime error before the assistant produced a reply.';
        const summary = extractString(parsed?.summary) ?? response;
        const html = extractString(parsed?.html) ?? undefined;
        const formPatch = parsed?.formPatch && typeof parsed.formPatch === 'object' ? parsed.formPatch : undefined;
        const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : undefined;
        const command = extractString(parsed?.command) ?? 'none';
        const completionState = normalizeAssistantCompletionState(parsed?.completionState) ?? 'unknown';
        const isFinal = typeof parsed?.isFinal === 'boolean' ? parsed.isFinal : undefined;
        const confidenceScore = normalizeAssistantConfidenceScore(parsed?.confidenceScore ?? payload?.confidenceScore);
        let artifactType = this.resolveFinalArtifactType({
            command,
            requestedArtifactType,
            context,
            html,
            formPatch,
            payload
        });
        const normalizedPayload = this.normalizeRuntimePayload(payload, context, userMessage);
        const isChangeRequest = looksLikeArticleChangeRequest(userMessage);
        if (artifactType === 'informational_response'
            && isChangeRequest
            && (context.capabilities.canPatchProposal || context.capabilities.canPatchDraft)
            && !directWorkingStateMutationApplied
            && looksLikeSuccessfulMutationClaim(response)) {
            artifactType = 'clarification_request';
        }
        return {
            command,
            artifactType,
            completionState,
            isFinal,
            response: artifactType === 'clarification_request'
                ? 'I did not apply that edit yet. Please try again, and I will return an explicit patch instead of a chat-only response.'
                : response,
            summary: artifactType === 'clarification_request'
                ? 'Assistant could not confirm a real content mutation.'
                : summary,
            rationale: extractString(parsed?.rationale) ?? undefined,
            title: extractString(parsed?.title) ?? undefined,
            confidenceScore,
            html,
            formPatch,
            payload: normalizedPayload
        };
    }
    buildArtifactPayload(parsed, context) {
        if (parsed.artifactType === 'draft_patch') {
            return { html: parsed.html ?? '' };
        }
        if (parsed.artifactType === 'proposal_patch') {
            return {
                scope: normalizeProposalPatchScope(parsed.payload?.scope),
                targetArticleKey: extractString(parsed.payload?.targetArticleKey),
                title: parsed.title,
                rationale: parsed.rationale,
                rationaleSummary: parsed.summary,
                aiNotes: parsed.payload?.aiNotes ? extractString(parsed.payload.aiNotes) : undefined,
                html: parsed.html,
                lineEdits: normalizeProposalLineEdits(parsed.payload?.lineEdits)
            };
        }
        if (parsed.artifactType === 'template_patch') {
            return parsed.formPatch ?? {};
        }
        if (parsed.artifactType === 'proposal_candidate') {
            const backing = (context.backingData && typeof context.backingData === 'object') ? context.backingData : {};
            return {
                action: this.resolveProposalCandidateAction(context),
                targetTitle: parsed.title ?? context.subject?.title,
                targetLocale: context.subject?.locale,
                confidenceScore: parsed.confidenceScore,
                rationale: parsed.rationale ?? parsed.summary,
                rationaleSummary: parsed.summary,
                aiNotes: parsed.response,
                sourceHtml: extractHtmlFromContext(context),
                proposedHtml: parsed.payload?.proposedHtml ? extractString(parsed.payload.proposedHtml) : parsed.html,
                metadata: {
                    ...parsed.payload,
                    familyId: extractString(backing.familyId),
                    localeVariantId: extractString(backing.localeVariantId ?? context.subject?.id),
                    sourceRevisionId: extractString(backing.sourceRevisionId)
                }
            };
        }
        return {
            response: parsed.response
        };
    }
    buildUiActions(context, artifact) {
        const stale = artifact.baseVersionToken && context.workingState?.versionToken && artifact.baseVersionToken !== context.workingState.versionToken;
        if (stale) {
            return [{ type: 'show_stale_warning', baseVersionToken: artifact.baseVersionToken }];
        }
        return this.buildUiActionsFromArtifact(artifact);
    }
    buildUiActionsFromArtifact(artifact) {
        if (artifact.artifactType === 'draft_patch') {
            const payload = artifact.payload;
            return [{ type: 'replace_working_html', target: 'draft', html: payload.html }];
        }
        if (artifact.artifactType === 'proposal_patch') {
            return [{ type: 'none' }];
        }
        if (artifact.artifactType === 'template_patch') {
            return [{ type: 'replace_template_form', payload: artifact.payload }];
        }
        return [{ type: 'none' }];
    }
    shouldAutoApplyArtifact(context, artifact, uiActions) {
        if (uiActions.some((action) => action.type === 'show_stale_warning')) {
            return false;
        }
        return (artifact.artifactType === 'draft_patch'
            || artifact.artifactType === 'proposal_patch'
            || artifact.artifactType === 'template_patch'
            || (artifact.artifactType === 'informational_response' && context.capabilities.canChat));
    }
    allowedArtifactTypes(context) {
        const allowed = ['informational_response', 'clarification_request'];
        if (context.capabilities.canCreateProposal)
            allowed.push('proposal_candidate');
        if (context.capabilities.canPatchProposal)
            allowed.push('proposal_patch');
        if (context.capabilities.canPatchDraft)
            allowed.push('draft_patch');
        if (context.capabilities.canPatchTemplate)
            allowed.push('template_patch');
        return allowed;
    }
    resolveRuntimeLocaleVariantId(context) {
        const backing = context.backingData && typeof context.backingData === 'object' ? context.backingData : {};
        const backingProposal = backing.proposal && typeof backing.proposal === 'object' ? backing.proposal : undefined;
        return extractString(backing.localeVariantId)
            ?? extractString(backingProposal?.localeVariantId)
            ?? extractString(backing.templatePackId)
            ?? context.subject?.id
            ?? context.workspaceId;
    }
    resolveProposalCandidateAction(context) {
        if (context.subject?.type === 'article') {
            return 'edit';
        }
        return 'create';
    }
    resolveFinalArtifactType(input) {
        const { command, requestedArtifactType, context, html, formPatch, payload } = input;
        const proposalLineEdits = normalizeProposalLineEdits(payload?.lineEdits);
        if (command === 'create_proposal') {
            if (requestedArtifactType === 'proposal_candidate'
                && context.capabilities.canCreateProposal
                && (extractString(payload?.proposedHtml) || html)) {
                return 'proposal_candidate';
            }
            return 'informational_response';
        }
        if (command === 'patch_proposal') {
            if (requestedArtifactType === 'proposal_patch'
                && context.capabilities.canPatchProposal
                && (html || proposalLineEdits.length > 0)) {
                return 'proposal_patch';
            }
            return 'informational_response';
        }
        if (command === 'patch_draft') {
            if (requestedArtifactType === 'draft_patch' && context.capabilities.canPatchDraft && html) {
                return 'draft_patch';
            }
            return 'informational_response';
        }
        if (command === 'patch_template') {
            if (requestedArtifactType === 'template_patch' && context.capabilities.canPatchTemplate && formPatch && Object.keys(formPatch).length > 0) {
                return 'template_patch';
            }
            return 'informational_response';
        }
        return requestedArtifactType === 'clarification_request' ? 'clarification_request' : 'informational_response';
    }
    normalizeProposalAction(value) {
        switch (value) {
            case 'create': return shared_types_1.ProposalAction.CREATE;
            case 'retire': return shared_types_1.ProposalAction.RETIRE;
            case 'no_impact': return shared_types_1.ProposalAction.NO_IMPACT;
            default: return shared_types_1.ProposalAction.EDIT;
        }
    }
    async openAssistantDb(workspaceId) {
        const workspace = await this.workspaceRepository.getWorkspace(workspaceId);
        const dbPath = node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE);
        (0, db_1.applyWorkspaceMigrations)(dbPath);
        const db = (0, db_1.openWorkspaceDatabase)(dbPath);
        this.migrateLegacyArticleSessions(db, workspaceId);
        return db;
    }
    async waitForTranscriptToQuiesce(transcriptPath, idleMs, maxWaitMs) {
        if (!transcriptPath) {
            return;
        }
        const startedAt = Date.now();
        let lastSignature = '';
        let stableSince = Date.now();
        while (Date.now() - startedAt < maxWaitMs) {
            let nextSignature = 'missing';
            try {
                const stat = await node_fs_1.promises.stat(transcriptPath);
                nextSignature = `${stat.size}:${stat.mtimeMs}`;
            }
            catch {
                nextSignature = 'missing';
            }
            if (nextSignature !== lastSignature) {
                lastSignature = nextSignature;
                stableSince = Date.now();
            }
            else if (Date.now() - stableSince >= idleMs) {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, ASSISTANT_CHAT_TRANSCRIPT_POLL_MS));
        }
    }
    async inspectTranscriptAssistantTurn(transcriptPath) {
        if (!transcriptPath) {
            return {
                preferredText: undefined,
                sawToolCalls: false,
                hasPostToolAnswer: false
            };
        }
        try {
            const text = await node_fs_1.promises.readFile(transcriptPath, 'utf8');
            const entries = parseAssistantTranscriptEntries(text);
            let epoch = 0;
            let sawToolCalls = false;
            const chunkPartsByEpoch = new Map();
            const candidatesByEpoch = new Map();
            const ensureChunkParts = (epochKey) => {
                const existing = chunkPartsByEpoch.get(epochKey);
                if (existing) {
                    return existing;
                }
                const created = [];
                chunkPartsByEpoch.set(epochKey, created);
                return created;
            };
            const ensureCandidates = (epochKey) => {
                const existing = candidatesByEpoch.get(epochKey);
                if (existing) {
                    return existing;
                }
                const created = [];
                candidatesByEpoch.set(epochKey, created);
                return created;
            };
            for (const entry of entries) {
                if (entry.type === 'tool') {
                    sawToolCalls = true;
                    epoch += 1;
                    continue;
                }
                if (entry.type === 'chunk') {
                    appendAssistantTranscriptChunk(ensureChunkParts(epoch), entry.text);
                    continue;
                }
                if (entry.type === 'response') {
                    ensureCandidates(epoch).push(entry.text);
                }
            }
            const resolveEpochText = (epochKey) => {
                const chunkParts = chunkPartsByEpoch.get(epochKey) ?? [];
                const candidates = [];
                const chunkCandidate = collapseAssistantTranscriptText(chunkParts.join(''));
                if (chunkCandidate) {
                    candidates.push(chunkCandidate);
                }
                candidates.push(...(candidatesByEpoch.get(epochKey) ?? []));
                return candidates
                    .map((candidate) => candidate.trim())
                    .find(Boolean);
            };
            const finalEpochText = resolveEpochText(epoch);
            const hasMeaningfulFinalEpochText = Boolean(finalEpochText && !looksLikeAssistantProgressMessage(finalEpochText));
            let preferredText = finalEpochText;
            if (!preferredText) {
                for (let index = epoch - 1; index >= 0; index -= 1) {
                    const fallback = resolveEpochText(index);
                    if (fallback) {
                        preferredText = fallback;
                        break;
                    }
                }
            }
            else if (looksLikeAssistantProgressMessage(preferredText)) {
                for (let index = epoch - 1; index >= 0; index -= 1) {
                    const fallback = resolveEpochText(index);
                    if (fallback && !looksLikeAssistantProgressMessage(fallback)) {
                        preferredText = fallback;
                        break;
                    }
                }
            }
            return {
                preferredText,
                sawToolCalls,
                hasPostToolAnswer: sawToolCalls ? hasMeaningfulFinalEpochText : Boolean(preferredText && !looksLikeAssistantProgressMessage(preferredText))
            };
        }
        catch {
            return {
                preferredText: undefined,
                sawToolCalls: false,
                hasPostToolAnswer: false
            };
        }
    }
    async extractTranscriptAssistantText(transcriptPath) {
        if (!transcriptPath) {
            return undefined;
        }
        try {
            const text = await node_fs_1.promises.readFile(transcriptPath, 'utf8');
            const chunkParts = [];
            const candidates = [];
            for (const entry of parseAssistantTranscriptEntries(text)) {
                if (entry.type === 'response') {
                    candidates.push(entry.text);
                    continue;
                }
                if (entry.type === 'chunk') {
                    appendAssistantTranscriptChunk(chunkParts, entry.text);
                }
            }
            const chunkCandidate = collapseAssistantTranscriptText(chunkParts.join(''));
            if (chunkCandidate) {
                candidates.unshift(chunkCandidate);
            }
            return candidates
                .find((candidate) => candidate.length > 0);
        }
        catch {
            return undefined;
        }
    }
    async extractTranscriptToolAudit(transcriptPath) {
        if (!transcriptPath) {
            return [];
        }
        try {
            const text = await node_fs_1.promises.readFile(transcriptPath, 'utf8');
            return parseAssistantTranscriptToolAudit(text);
        }
        catch {
            return [];
        }
    }
    ensureSession(db, context, sessionId) {
        if (sessionId) {
            return this.activateSession(db, context.workspaceId, sessionId, context);
        }
        const active = this.findActiveSession(db, context.workspaceId);
        if (active) {
            return this.activateSession(db, context.workspaceId, active.id, context);
        }
        return this.createFreshSession(db, context.workspaceId, undefined, context);
    }
    normalizeRuntimePayload(payload, context, userMessage) {
        if (!payload) {
            if (context.route !== shared_types_1.AppRoute.PROPOSAL_REVIEW) {
                return payload;
            }
            return {
                scope: inferProposalPatchScope(userMessage)
            };
        }
        if (context.route !== shared_types_1.AppRoute.PROPOSAL_REVIEW) {
            return payload;
        }
        return {
            ...payload,
            scope: normalizeProposalPatchScope(payload.scope) ?? inferProposalPatchScope(userMessage)
        };
    }
    async resolveProposalPatchTargets(context, payload) {
        if (context.subject?.type !== 'proposal') {
            return context.subject?.id ? [context.subject.id] : [];
        }
        const backing = (context.backingData && typeof context.backingData === 'object')
            ? context.backingData
            : {};
        const batchId = extractString(backing.batchId);
        const currentProposalId = context.subject.id;
        const currentArticleKey = extractString(payload.targetArticleKey) ?? extractString(backing.articleKey);
        const scope = payload.scope ?? 'current';
        if (!batchId || scope === 'current') {
            return [currentProposalId];
        }
        const queue = await this.workspaceRepository.listProposalReviewQueue(context.workspaceId, batchId);
        if (scope === 'batch') {
            return queue.queue.map((item) => item.proposalId);
        }
        if (!currentArticleKey) {
            return [currentProposalId];
        }
        return queue.queue
            .filter((item) => item.articleKey === currentArticleKey)
            .map((item) => item.proposalId);
    }
    didWorkingStateChangeDuringTurn(context) {
        const subject = context.subject;
        const workingState = context.workingState;
        if (!subject?.id || !workingState?.versionToken) {
            return false;
        }
        if ((context.route !== shared_types_1.AppRoute.PROPOSAL_REVIEW || subject.type !== 'proposal')
            && (context.route !== shared_types_1.AppRoute.TEMPLATES_AND_PROMPTS || subject.type !== 'template_pack')) {
            return false;
        }
        try {
            const schema = this.appWorkingStateService.getFormSchema({
                workspaceId: context.workspaceId,
                route: context.route,
                entityType: subject.type,
                entityId: subject.id
            });
            return Boolean(schema.versionToken && schema.versionToken !== workingState.versionToken);
        }
        catch {
            return false;
        }
    }
    findSessionById(db, workspaceId, sessionId) {
        return db.get(`SELECT id,
              workspace_id as workspaceId,
              scope_type as scopeType,
              title,
              route,
              entity_type as entityType,
              entity_id as entityId,
              entity_title as entityTitle,
              lifecycle_status as lifecycleStatus,
              status,
              runtime_session_id as runtimeSessionId,
              latest_artifact_id as latestArtifactId,
              last_message_at as lastMessageAtUtc,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc,
              closed_at as closedAtUtc,
              archived_at as archivedAtUtc
       FROM ai_sessions
       WHERE workspace_id = @workspaceId
         AND id = @sessionId
       LIMIT 1`, {
            workspaceId,
            sessionId
        }) ?? undefined;
    }
    findActiveSession(db, workspaceId) {
        return db.get(`SELECT id,
              workspace_id as workspaceId,
              scope_type as scopeType,
              title,
              route,
              entity_type as entityType,
              entity_id as entityId,
              entity_title as entityTitle,
              lifecycle_status as lifecycleStatus,
              status,
              runtime_session_id as runtimeSessionId,
              latest_artifact_id as latestArtifactId,
              last_message_at as lastMessageAtUtc,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc,
              closed_at as closedAtUtc,
              archived_at as archivedAtUtc
       FROM ai_sessions
       WHERE workspace_id = @workspaceId
         AND lifecycle_status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`, { workspaceId }) ?? undefined;
    }
    listSessionsForWorkspace(db, workspaceId, includeArchived) {
        return db.all(`SELECT id,
              workspace_id as workspaceId,
              scope_type as scopeType,
              title,
              route,
              entity_type as entityType,
              entity_id as entityId,
              entity_title as entityTitle,
              lifecycle_status as lifecycleStatus,
              status,
              runtime_session_id as runtimeSessionId,
              latest_artifact_id as latestArtifactId,
              last_message_at as lastMessageAtUtc,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc,
              closed_at as closedAtUtc,
              archived_at as archivedAtUtc
       FROM ai_sessions
       WHERE workspace_id = @workspaceId
         AND (@includeArchived = 1 OR lifecycle_status != 'archived')
       ORDER BY COALESCE(last_message_at, created_at) DESC,
                created_at DESC`, {
            workspaceId,
            includeArchived: includeArchived ? 1 : 0
        });
    }
    requireSessionById(db, workspaceId, sessionId) {
        const row = this.findSessionById(db, workspaceId, sessionId);
        if (!row) {
            throw new Error('AI assistant session not found');
        }
        return row;
    }
    createFreshSession(db, workspaceId, title, context) {
        this.closeActiveSessions(db, workspaceId);
        const now = new Date().toISOString();
        const id = (0, node_crypto_1.randomUUID)();
        db.run(`INSERT INTO ai_sessions (
        id, workspace_id, scope_type, title, route, entity_type, entity_id, entity_title, lifecycle_status, status,
        runtime_session_id, latest_artifact_id, last_message_at, created_at, updated_at, closed_at, archived_at
      ) VALUES (
        @id, @workspaceId, 'global', @title, @route, @entityType, @entityId, @entityTitle, 'active', 'idle',
        NULL, NULL, NULL, @createdAt, @updatedAt, NULL, NULL
      )`, {
            id,
            workspaceId,
            title: title?.trim() || this.defaultSessionTitle(),
            route: context?.route ?? shared_types_1.AppRoute.KB_VAULT_HOME,
            entityType: context?.subject?.type ?? null,
            entityId: context?.subject?.id ?? null,
            entityTitle: context?.subject?.title ?? null,
            createdAt: now,
            updatedAt: now
        });
        return this.requireSessionById(db, workspaceId, id);
    }
    activateSession(db, workspaceId, sessionId, context) {
        const session = this.requireSessionById(db, workspaceId, sessionId);
        this.closeActiveSessions(db, workspaceId, sessionId);
        db.run(`UPDATE ai_sessions
       SET lifecycle_status = 'active',
           closed_at = NULL,
           route = COALESCE(@route, route),
           entity_type = COALESCE(@entityType, entity_type),
           entity_id = COALESCE(@entityId, entity_id),
           entity_title = COALESCE(@entityTitle, entity_title)
       WHERE workspace_id = @workspaceId AND id = @sessionId`, {
            workspaceId,
            sessionId,
            route: context?.route ?? null,
            entityType: context?.subject?.type ?? null,
            entityId: context?.subject?.id ?? null,
            entityTitle: context?.subject?.title ?? null
        });
        return this.requireSessionById(db, workspaceId, sessionId);
    }
    closeActiveSessions(db, workspaceId, exceptSessionId) {
        const now = new Date().toISOString();
        db.run(`UPDATE ai_sessions
       SET lifecycle_status = 'closed',
           closed_at = CASE WHEN lifecycle_status = 'active' THEN @closedAt ELSE closed_at END
       WHERE workspace_id = @workspaceId
         AND lifecycle_status = 'active'
         AND (@exceptSessionId IS NULL OR id != @exceptSessionId)`, {
            workspaceId,
            exceptSessionId: exceptSessionId ?? null,
            closedAt: now
        });
    }
    defaultSessionTitle() {
        return 'New chat';
    }
    mapSessionRow(row) {
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            scopeType: row.scopeType,
            title: row.title,
            route: row.route,
            entityType: row.entityType,
            entityId: row.entityId ?? undefined,
            entityTitle: row.entityTitle ?? undefined,
            lifecycleStatus: row.lifecycleStatus,
            status: row.status,
            runtimeSessionId: row.runtimeSessionId ?? undefined,
            latestArtifactId: row.latestArtifactId ?? undefined,
            lastMessageAtUtc: row.lastMessageAtUtc ?? undefined,
            createdAtUtc: row.createdAtUtc,
            updatedAtUtc: row.updatedAtUtc,
            closedAtUtc: row.closedAtUtc ?? undefined,
            archivedAtUtc: row.archivedAtUtc ?? undefined
        };
    }
    insertMessage(db, input) {
        db.run(`INSERT INTO ai_messages (
        id, session_id, workspace_id, role, message_kind, content, metadata_json, created_at
      ) VALUES (
        @id, @sessionId, @workspaceId, @role, @messageKind, @content, @metadataJson, @createdAtUtc
      )`, {
            ...input,
            metadataJson: input.metadata ? JSON.stringify(input.metadata) : null
        });
        return {
            id: input.id,
            sessionId: input.sessionId,
            workspaceId: input.workspaceId,
            role: input.role,
            messageKind: input.messageKind,
            content: input.content,
            metadata: input.metadata,
            createdAtUtc: input.createdAtUtc
        };
    }
    listMessages(db, sessionId) {
        return db.all(`SELECT id,
              session_id as sessionId,
              workspace_id as workspaceId,
              role,
              message_kind as messageKind,
              content,
              metadata_json as metadataJson,
              created_at as createdAtUtc
       FROM ai_messages
       WHERE session_id = @sessionId
       ORDER BY created_at ASC`, { sessionId }).map((row) => ({
            id: row.id,
            sessionId: row.sessionId,
            workspaceId: row.workspaceId,
            role: row.role,
            messageKind: row.messageKind,
            content: row.content,
            metadata: safeParseJson(row.metadataJson) ?? undefined,
            createdAtUtc: row.createdAtUtc
        }));
    }
    insertArtifact(db, input) {
        const now = new Date().toISOString();
        const id = (0, node_crypto_1.randomUUID)();
        db.run(`INSERT INTO ai_artifacts (
        id, session_id, workspace_id, artifact_type, entity_type, entity_id, base_version_token, status,
        payload_json, summary, created_at, updated_at
      ) VALUES (
        @id, @sessionId, @workspaceId, @artifactType, @entityType, @entityId, @baseVersionToken, @status,
        @payloadJson, @summary, @createdAt, @updatedAt
      )`, {
            id,
            sessionId: input.sessionId,
            workspaceId: input.workspaceId,
            artifactType: input.artifactType,
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
            baseVersionToken: input.baseVersionToken ?? null,
            status: input.status,
            payloadJson: JSON.stringify(input.payload ?? {}),
            summary: input.summary,
            createdAt: now,
            updatedAt: now
        });
        return this.requireArtifact(db, input.workspaceId, id);
    }
    getArtifact(db, workspaceId, artifactId) {
        const row = db.get(`SELECT id,
              session_id as sessionId,
              workspace_id as workspaceId,
              artifact_type as artifactType,
              entity_type as entityType,
              entity_id as entityId,
              base_version_token as baseVersionToken,
              status,
              payload_json as payloadJson,
              summary,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
       FROM ai_artifacts
       WHERE workspace_id = @workspaceId AND id = @artifactId`, { workspaceId, artifactId });
        if (!row) {
            return undefined;
        }
        return {
            id: row.id,
            sessionId: row.sessionId,
            workspaceId: row.workspaceId,
            artifactType: row.artifactType,
            entityType: row.entityType,
            entityId: row.entityId ?? undefined,
            baseVersionToken: row.baseVersionToken ?? undefined,
            status: row.status,
            summary: row.summary,
            payload: safeParseJson(row.payloadJson) ?? {},
            createdAtUtc: row.createdAtUtc,
            updatedAtUtc: row.updatedAtUtc
        };
    }
    requireArtifact(db, workspaceId, artifactId) {
        const artifact = this.getArtifact(db, workspaceId, artifactId);
        if (!artifact) {
            throw new Error('AI assistant artifact not found');
        }
        return artifact;
    }
    updateArtifactStatus(db, workspaceId, artifactId, status) {
        const now = new Date().toISOString();
        db.run(`UPDATE ai_artifacts
       SET status = @status,
           updated_at = @updatedAt,
           applied_at = CASE WHEN @status = 'applied' THEN @updatedAt ELSE applied_at END,
           rejected_at = CASE WHEN @status = 'rejected' THEN @updatedAt ELSE rejected_at END
       WHERE workspace_id = @workspaceId AND id = @artifactId`, {
            workspaceId,
            artifactId,
            status,
            updatedAt: now
        });
    }
    updateSessionStatus(db, sessionId, workspaceId, status, context, lastMessageAtUtc, titleHint) {
        const nextTitle = titleHint?.trim()
            && this.requireSessionById(db, workspaceId, sessionId).title === this.defaultSessionTitle()
            ? this.summarizeSessionTitle(titleHint)
            : null;
        db.run(`UPDATE ai_sessions
       SET status = @status,
           title = COALESCE(@title, title),
           route = COALESCE(@route, route),
           entity_type = COALESCE(@entityType, entity_type),
           entity_id = COALESCE(@entityId, entity_id),
           entity_title = COALESCE(@entityTitle, entity_title),
           last_message_at = COALESCE(@lastMessageAt, last_message_at),
           updated_at = @updatedAt
       WHERE workspace_id = @workspaceId AND id = @sessionId`, {
            sessionId,
            workspaceId,
            status,
            title: nextTitle,
            route: context?.route ?? null,
            entityType: context?.subject?.type ?? null,
            entityId: context?.subject?.id ?? null,
            entityTitle: context?.subject?.title ?? null,
            lastMessageAt: lastMessageAtUtc ?? null,
            updatedAt: new Date().toISOString()
        });
    }
    updateSessionAfterTurn(db, workspaceId, sessionId, runtimeSessionId, status, latestArtifactId, context, lastMessageAtUtc, titleOverride) {
        db.run(`UPDATE ai_sessions
       SET runtime_session_id = COALESCE(@runtimeSessionId, runtime_session_id),
           status = @status,
           latest_artifact_id = COALESCE(@latestArtifactId, latest_artifact_id),
           title = CASE
             WHEN @title IS NOT NULL AND (title IS NULL OR title = '' OR title = @defaultTitle) THEN @title
             ELSE title
           END,
           route = COALESCE(@route, route),
           entity_type = COALESCE(@entityType, entity_type),
           entity_id = COALESCE(@entityId, entity_id),
           entity_title = COALESCE(@entityTitle, entity_title),
           last_message_at = COALESCE(@lastMessageAt, last_message_at),
           updated_at = @updatedAt
       WHERE workspace_id = @workspaceId AND id = @sessionId`, {
            workspaceId,
            sessionId,
            runtimeSessionId: runtimeSessionId ?? null,
            status,
            latestArtifactId: latestArtifactId ?? null,
            title: titleOverride?.trim() ? this.summarizeSessionTitle(titleOverride) : null,
            defaultTitle: this.defaultSessionTitle(),
            route: context?.route ?? null,
            entityType: context?.subject?.type ?? null,
            entityId: context?.subject?.id ?? null,
            entityTitle: context?.subject?.title ?? null,
            lastMessageAt: lastMessageAtUtc ?? null,
            updatedAt: new Date().toISOString()
        });
    }
    summarizeSessionTitle(message) {
        const collapsed = message.replace(/\s+/g, ' ').trim();
        if (!collapsed)
            return this.defaultSessionTitle();
        return collapsed.slice(0, 56);
    }
    buildContextMetadata(context) {
        return {
            route: context.route,
            routeLabel: context.routeLabel,
            subjectType: context.subject?.type,
            subjectId: context.subject?.id,
            subjectTitle: context.subject?.title,
            locale: context.subject?.locale,
            versionToken: context.workingState?.versionToken
        };
    }
    migrateLegacyArticleSessions(db, workspaceId) {
        const legacySessions = db.all(`SELECT id,
              locale_variant_id as localeVariantId,
              branch_id as branchId,
              status,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
       FROM article_ai_sessions
       WHERE workspace_id = @workspaceId`, { workspaceId });
        for (const legacySession of legacySessions) {
            const alreadyImported = db.get(`SELECT id
         FROM ai_sessions
         WHERE workspace_id = @workspaceId AND entity_id = @entityId AND created_at = @createdAt
         LIMIT 1`, {
                workspaceId,
                entityId: legacySession.branchId ?? legacySession.localeVariantId,
                createdAt: legacySession.createdAtUtc
            });
            if (alreadyImported) {
                continue;
            }
            const sessionId = (0, node_crypto_1.randomUUID)();
            db.run(`INSERT INTO ai_sessions (
          id, workspace_id, scope_type, title, route, entity_type, entity_id, entity_title, lifecycle_status, status,
          runtime_session_id, latest_artifact_id, last_message_at, created_at, updated_at, closed_at, archived_at
        ) VALUES (
          @id, @workspaceId, 'entity', @title, @route, @entityType, @entityId, NULL, 'closed', 'idle',
          NULL, NULL, @lastMessageAt, @createdAt, @updatedAt, @closedAt, NULL
        )`, {
                id: sessionId,
                workspaceId,
                title: legacySession.branchId ? 'Imported draft chat' : 'Imported article chat',
                route: legacySession.branchId ? shared_types_1.AppRoute.DRAFTS : shared_types_1.AppRoute.ARTICLE_EXPLORER,
                entityType: legacySession.branchId ? 'draft_branch' : 'article',
                entityId: legacySession.branchId ?? legacySession.localeVariantId,
                lastMessageAt: legacySession.updatedAtUtc,
                createdAt: legacySession.createdAtUtc,
                updatedAt: legacySession.updatedAtUtc,
                closedAt: legacySession.updatedAtUtc
            });
            const legacyMessages = db.all(`SELECT id,
                role,
                message_kind as messageKind,
                content,
                metadata_json as metadataJson,
                created_at as createdAtUtc
         FROM article_ai_messages
         WHERE session_id = @sessionId
         ORDER BY created_at ASC`, { sessionId: legacySession.id });
            for (const legacyMessage of legacyMessages) {
                db.run(`INSERT INTO ai_messages (
            id, session_id, workspace_id, role, message_kind, content, metadata_json, created_at
          ) VALUES (
            @id, @sessionId, @workspaceId, @role, @messageKind, @content, @metadataJson, @createdAt
          )`, {
                    id: (0, node_crypto_1.randomUUID)(),
                    sessionId,
                    workspaceId,
                    role: legacyMessage.role,
                    messageKind: legacyMessage.messageKind,
                    content: legacyMessage.content,
                    metadataJson: legacyMessage.metadataJson,
                    createdAt: legacyMessage.createdAtUtc
                });
            }
        }
    }
}
exports.AiAssistantService = AiAssistantService;
function extractJsonObject(value) {
    const candidates = [];
    if (typeof value === 'string') {
        candidates.push(value);
    }
    else if (value && typeof value === 'object') {
        const payload = value;
        if (looksLikeAssistantEnvelope(payload)) {
            return payload;
        }
        if (typeof payload.streamedText === 'string') {
            candidates.push(payload.streamedText);
        }
        if (typeof payload.text === 'string') {
            candidates.push(payload.text);
        }
        if (Array.isArray(payload.content)) {
            for (const item of payload.content) {
                if (item && typeof item === 'object' && typeof item.text === 'string') {
                    candidates.push(item.text);
                }
            }
        }
    }
    for (const candidate of candidates) {
        const parsed = extractLastJsonObjectFromText(candidate);
        if (parsed) {
            return parsed;
        }
    }
    return null;
}
function safeParseJson(value) {
    if (!value)
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function extractString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function looksLikeAssistantEnvelope(value) {
    return (typeof value.response === 'string'
        || typeof value.command === 'string'
        || typeof value.artifactType === 'string'
        || typeof value.completionState === 'string'
        || typeof value.isFinal === 'boolean');
}
function extractLastJsonObjectFromText(value) {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const direct = JSON.parse(trimmed);
        if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
            return direct;
        }
    }
    catch {
        // Fall through to substring extraction.
    }
    let best = null;
    for (let start = 0; start < trimmed.length; start += 1) {
        if (trimmed[start] !== '{') {
            continue;
        }
        for (let end = trimmed.lastIndexOf('}'); end > start; end = trimmed.lastIndexOf('}', end - 1)) {
            try {
                const candidate = JSON.parse(trimmed.slice(start, end + 1));
                if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
                    best = candidate;
                    break;
                }
            }
            catch {
                // continue searching
            }
        }
    }
    return best;
}
function extractChunkString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function findSharedPrefixLength(left, right) {
    const max = Math.min(left.length, right.length);
    let index = 0;
    while (index < max && left[index] === right[index]) {
        index += 1;
    }
    return index;
}
function findStreamingOverlap(left, right) {
    const maxOverlap = Math.min(left.length, right.length);
    for (let overlap = maxOverlap; overlap >= 12; overlap -= 1) {
        if (left.slice(-overlap) === right.slice(0, overlap)) {
            return overlap;
        }
    }
    return 0;
}
function mergeStreamingText(current, incoming) {
    if (!incoming && incoming !== '') {
        return current;
    }
    if (!current) {
        return incoming;
    }
    if (current === incoming || current.endsWith(incoming)) {
        return current;
    }
    if (incoming.endsWith(current) || incoming.startsWith(current)) {
        return incoming;
    }
    const sharedPrefix = findSharedPrefixLength(current, incoming);
    if (sharedPrefix >= 12
        && sharedPrefix >= Math.floor(Math.min(current.length, incoming.length) * 0.6)) {
        return incoming.length >= current.length ? incoming : current;
    }
    const overlap = findStreamingOverlap(current, incoming);
    if (overlap > 0) {
        return `${current}${incoming.slice(overlap)}`;
    }
    return `${current}${incoming}`;
}
function summarizePromptText(value, maxLength) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 24).trimEnd()} …[truncated ${normalized.length - maxLength + 24} chars]`;
}
function summarizePromptData(value, depth = 0) {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return value;
        }
        if (looksLikeMarkupString(trimmed)) {
            return `[omitted markup/string content, length=${trimmed.length}; use kb commands if needed]`;
        }
        return summarizePromptText(trimmed, 400);
    }
    if (Array.isArray(value)) {
        const capped = value.slice(0, 10).map((entry) => summarizePromptData(entry, depth + 1));
        if (value.length > capped.length) {
            capped.push(`[${value.length - capped.length} more items omitted]`);
        }
        return capped;
    }
    if (typeof value === 'object') {
        if (depth >= 4) {
            return '[object omitted for brevity]';
        }
        const entries = Object.entries(value);
        const summarized = {};
        for (const [key, entry] of entries.slice(0, 40)) {
            if (isLargeMarkupField(key, entry)) {
                const length = typeof entry === 'string' ? entry.length : 0;
                summarized[key] = `[omitted ${key}, length=${length}; use kb commands if needed]`;
                continue;
            }
            summarized[key] = summarizePromptData(entry, depth + 1);
        }
        if (entries.length > 40) {
            summarized.__omittedKeys = entries.length - 40;
        }
        return summarized;
    }
    return String(value);
}
function isLargeMarkupField(key, value) {
    if (typeof value !== 'string') {
        return false;
    }
    const normalizedKey = key.trim().toLowerCase();
    if (['html', 'sourcehtml', 'previewhtml', 'proposedhtml'].includes(normalizedKey)) {
        return true;
    }
    return value.length > 800 && looksLikeMarkupString(value);
}
function looksLikeMarkupString(value) {
    return /<\/?[a-z][\s\S]*>/i.test(value);
}
function applyAssistantAuditEvents(audit, events) {
    for (const event of events) {
        if (event.kind === 'thought_chunk' && event.text) {
            audit.thoughtText = mergeStreamingText(audit.thoughtText, event.text);
            continue;
        }
        if (event.kind !== 'tool_call' && event.kind !== 'tool_update') {
            continue;
        }
        if (isFilteredAssistantToolName(event.toolName)) {
            continue;
        }
        const existingIndex = event.toolCallId
            ? audit.toolEvents.findIndex((entry) => entry.toolCallId === event.toolCallId)
            : -1;
        const nextEvent = {
            ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
            ...(event.toolName ? { toolName: event.toolName } : {}),
            ...(event.toolStatus ? { toolStatus: event.toolStatus } : {}),
            ...(event.resourceLabel ? { resourceLabel: event.resourceLabel } : {})
        };
        if (existingIndex === -1) {
            audit.toolEvents.push(nextEvent);
            continue;
        }
        audit.toolEvents[existingIndex] = {
            ...audit.toolEvents[existingIndex],
            ...nextEvent
        };
    }
}
function mergeAssistantToolEvents(current, incoming) {
    const merged = [...current];
    for (const event of incoming) {
        const existingIndex = event.toolCallId
            ? merged.findIndex((entry) => entry.toolCallId === event.toolCallId)
            : -1;
        if (existingIndex === -1) {
            merged.push(event);
            continue;
        }
        merged[existingIndex] = {
            ...merged[existingIndex],
            ...event
        };
    }
    return merged;
}
function isFilteredAssistantToolName(value) {
    void value;
    return false;
}
function mapRuntimeToolAudit(toolCalls) {
    if (!toolCalls?.length) {
        return [];
    }
    return toolCalls
        .map((call) => ({
        toolName: summarizeAssistantToolName(call.args, undefined, undefined, call.toolName) ?? call.toolName,
        resourceLabel: summarizeAssistantResourceLabel(call.args),
        toolStatus: call.allowed === false ? 'blocked' : 'completed'
    }))
        .filter((call) => !isFilteredAssistantToolName(call.toolName));
}
function normalizeAssistantToolKind(value) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }
    if (normalized.includes('shell')) {
        return 'shell';
    }
    if (normalized.includes('mcp')) {
        return 'mcp';
    }
    if (normalized.includes('skill')) {
        return 'skill';
    }
    if (normalized.includes('command')) {
        return 'command';
    }
    return normalized.replace(/[_-]+/g, ' ');
}
function extractKbCliCommandName(value) {
    const normalized = value.replace(/["']/g, ' ').trim();
    if (!normalized) {
        return undefined;
    }
    const kbMatch = normalized.match(/(?:^|\s)(?:kb|kb\.exe)\s+([a-z0-9_]+(?:-[a-z0-9_]+)*(?:\s+[a-z0-9_]+(?:-[a-z0-9_]+)*)?)/i);
    if (kbMatch?.[1]) {
        return kbMatch[1].trim().toLowerCase();
    }
    const shimMatch = normalized.match(/kb-vault-cli-shim\/kb(?:\s+|["']\s+)([a-z0-9_]+(?:-[a-z0-9_]+)*(?:\s+[a-z0-9_]+(?:-[a-z0-9_]+)*)?)/i);
    if (shimMatch?.[1]) {
        return shimMatch[1].trim().toLowerCase();
    }
    return undefined;
}
function looksLikeKbCliShellInvocation(value) {
    const normalized = value?.replace(/["']/g, ' ').trim() ?? '';
    if (!normalized) {
        return false;
    }
    return (/(?:^|\s)(?:kb|kb\.exe)\s+[a-z0-9_-]+/i.test(normalized)
        || /kb-vault-cli-shim\/kb(?:\s+|["']\s+)[a-z0-9_-]+/i.test(normalized)
        || /\/kb(?:\s+|["']\s+)[a-z0-9_-]+/i.test(normalized));
}
function extractAssistantCommand(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const record = value;
    const directCommand = extractString(record.command);
    if (directCommand) {
        return directCommand;
    }
    const stdout = extractString(record.stdout);
    if (!stdout) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(stdout);
        return extractString(parsed.command);
    }
    catch {
        return undefined;
    }
}
function summarizeAssistantToolName(rawInput, rawOutput, kind, title) {
    const explicitTitle = extractString(title);
    if (explicitTitle) {
        const kbCommandName = extractKbCliCommandName(explicitTitle);
        if (kbCommandName) {
            return kbCommandName;
        }
        return explicitTitle;
    }
    if (rawInput && typeof rawInput === 'object') {
        const record = rawInput;
        const explicitKeys = ['toolName', 'tool', 'commandName'];
        for (const key of explicitKeys) {
            const candidate = extractString(record[key]);
            if (candidate) {
                const kbCommandName = extractKbCliCommandName(candidate);
                if (kbCommandName) {
                    return kbCommandName;
                }
                return candidate;
            }
        }
        const command = extractString(record.command);
        if (command) {
            const kbCommandName = extractKbCliCommandName(command);
            if (kbCommandName) {
                return kbCommandName;
            }
            const normalizedKind = typeof kind === 'string' ? normalizeAssistantToolKind(kind) : undefined;
            if (normalizedKind) {
                return normalizedKind;
            }
            const firstToken = command.trim().split(/\s+/, 1)[0]?.trim();
            if (firstToken) {
                return firstToken;
            }
        }
    }
    const outputCommand = extractAssistantCommand(rawOutput);
    if (outputCommand) {
        const kbCommandName = extractKbCliCommandName(outputCommand);
        if (kbCommandName) {
            return kbCommandName;
        }
        const normalizedKind = typeof kind === 'string' ? normalizeAssistantToolKind(kind) : undefined;
        if (normalizedKind) {
            return normalizedKind;
        }
        return outputCommand.split(/\s+/, 1)[0]?.trim() || outputCommand;
    }
    return typeof kind === 'string' ? normalizeAssistantToolKind(kind) : undefined;
}
function summarizeAssistantResourceLabel(value, rawOutput) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? summarizePromptText(trimmed, 120) : undefined;
    }
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const record = value;
    const command = extractString(record.command);
    const query = extractString(record.query);
    if (query) {
        return summarizePromptText(`query: ${query}`, 120);
    }
    const preferredStringKeys = [
        'resourceName',
        'name',
        'title',
        'path',
        'file',
        'articleTitle',
        'targetTitle',
        'articleId',
        'familyId',
        'localeVariantId',
        'revisionId',
        'batchId',
        'entityId',
        'route',
        'url'
    ];
    for (const key of preferredStringKeys) {
        const candidate = extractString(record[key]);
        if (candidate) {
            return summarizePromptText(`${key}: ${candidate}`, 120);
        }
    }
    if (command) {
        return summarizePromptText(command, 120);
    }
    const args = Array.isArray(record.args)
        ? record.args.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    if (args.length > 0) {
        return summarizePromptText(args.join(' '), 120);
    }
    const outputCommand = extractAssistantCommand(rawOutput);
    if (outputCommand) {
        return summarizePromptText(outputCommand, 120);
    }
    return undefined;
}
function normalizeAssistantStreamPayload(workspaceId, sessionId, turnId, atUtc, stream) {
    if (stream.kind !== 'progress' || !stream.data || typeof stream.data !== 'object') {
        return [];
    }
    const params = stream.data;
    const update = params.update;
    const sessionUpdate = typeof update?.sessionUpdate === 'string' ? update.sessionUpdate : '';
    const text = extractChunkString(update?.content?.text);
    if (sessionUpdate === 'agent_message_chunk' && text) {
        return [{
                workspaceId,
                sessionId,
                turnId,
                kind: 'response_chunk',
                atUtc,
                text
            }];
    }
    if (sessionUpdate === 'agent_thought_chunk' && text) {
        return [{
                workspaceId,
                sessionId,
                turnId,
                kind: 'thought_chunk',
                atUtc,
                text
            }];
    }
    if (sessionUpdate === 'tool_call' || sessionUpdate === 'tool_call_update') {
        return [{
                workspaceId,
                sessionId,
                turnId,
                kind: sessionUpdate === 'tool_call' ? 'tool_call' : 'tool_update',
                atUtc,
                toolCallId: typeof update?.toolCallId === 'string' ? update.toolCallId : undefined,
                toolName: summarizeAssistantToolName(update?.rawInput, update?.rawOutput, update?.kind, update?.title),
                toolStatus: typeof update?.status === 'string' ? update.status : undefined,
                resourceLabel: summarizeAssistantResourceLabel(update?.rawInput, update?.rawOutput)
            }];
    }
    return [];
}
function extractAssistantExplicitText(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const payload = value;
    const topLevelText = extractString(payload.text);
    if (topLevelText) {
        return topLevelText;
    }
    if (Array.isArray(payload.content)) {
        for (const item of payload.content) {
            if (!item || typeof item !== 'object')
                continue;
            const text = extractString(item.text);
            if (text) {
                return text;
            }
        }
    }
    return undefined;
}
function extractAssistantStreamedText(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const payload = value;
    return extractChunkString(payload.streamedText);
}
function scoreAssistantEnvelope(value) {
    let score = 0;
    const completionState = normalizeAssistantCompletionState(value.completionState);
    switch (completionState) {
        case 'completed':
            score += 40;
            break;
        case 'needs_user_input':
            score += 15;
            break;
        case 'blocked':
            score += 10;
            break;
        case 'researching':
            score += 5;
            break;
        default:
            break;
    }
    if (typeof value.response === 'string' && value.response.trim()) {
        score += 8;
    }
    if (typeof value.artifactType === 'string') {
        score += 4;
        if (value.artifactType === 'informational_response') {
            score += 4;
        }
    }
    if (typeof value.isFinal === 'boolean' && value.isFinal) {
        score += 2;
    }
    return score;
}
function selectPreferredAssistantEnvelope(resultPayload, transcriptFallbackText) {
    const directObject = resultPayload && typeof resultPayload === 'object' && !Array.isArray(resultPayload)
        ? resultPayload
        : null;
    const directEnvelope = directObject && looksLikeAssistantEnvelope(directObject) ? directObject : null;
    const candidates = [
        { rank: 4, parsed: extractLastJsonObjectFromText(transcriptFallbackText) },
        { rank: 3, parsed: extractLastJsonObjectFromText(extractAssistantStreamedText(resultPayload)) },
        { rank: 2, parsed: extractLastJsonObjectFromText(extractAssistantExplicitText(resultPayload)) },
        { rank: 1, parsed: directEnvelope }
    ];
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
        if (!candidate.parsed) {
            continue;
        }
        const score = scoreAssistantEnvelope(candidate.parsed) * 10 + candidate.rank;
        if (score > bestScore) {
            best = candidate.parsed;
            bestScore = score;
        }
    }
    return best;
}
function normalizeAssistantCompletionState(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    switch (value.trim().toLowerCase()) {
        case 'completed':
            return 'completed';
        case 'researching':
            return 'researching';
        case 'needs_user_input':
        case 'needs-user-input':
            return 'needs_user_input';
        case 'blocked':
            return 'blocked';
        case 'errored':
        case 'error':
            return 'errored';
        case 'unknown':
            return 'unknown';
        default:
            return undefined;
    }
}
function looksLikeAssistantProgressMessage(value) {
    const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    return (/^(gathering|checking|looking|researching|reviewing|investigating|loading|searching)\b/.test(normalized)
        || /^i(?:'m| am) (gathering|checking|looking|researching|reviewing|investigating)\b/.test(normalized)
        || normalized.includes('returning only the structured json')
        || normalized.includes('return the final answer')
        || normalized.includes('using the cli and then returning')
        || normalized.includes('do not send a progress update'));
}
function selectPreferredAssistantReply(resultPayload, transcriptFallbackText) {
    const preferredEnvelope = selectPreferredAssistantEnvelope(resultPayload, transcriptFallbackText);
    const preferredResponse = extractString(preferredEnvelope?.response) ?? extractString(preferredEnvelope?.summary);
    if (preferredResponse) {
        return preferredResponse;
    }
    const explicit = unwrapAssistantDisplayText(extractAssistantExplicitText(resultPayload));
    const streamed = unwrapAssistantDisplayText(extractAssistantStreamedText(resultPayload));
    const transcript = unwrapAssistantDisplayText(transcriptFallbackText);
    if (explicit && !looksLikeAssistantProgressMessage(explicit)) {
        return explicit;
    }
    for (const candidate of [streamed, transcript, explicit]) {
        if (candidate && !looksLikeAssistantProgressMessage(candidate)) {
            return candidate;
        }
    }
    return explicit ?? streamed ?? transcript;
}
function isRetriableAssistantRuntimeFailure(value) {
    if (!value) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === 'internal error' || (normalized.includes('session') && normalized.includes('not found'));
}
function unwrapAssistantDisplayText(value) {
    if (!value) {
        return undefined;
    }
    const parsed = extractJsonObject(value);
    const parsedResponse = extractString(parsed?.response);
    if (parsedResponse) {
        return parsedResponse;
    }
    return value;
}
function collapseAssistantTranscriptText(value) {
    return value;
}
function appendAssistantTranscriptChunk(chunks, text) {
    if (!text && text !== '') {
        return;
    }
    if (!text.trim() && !/[\r\n]/.test(text)) {
        return;
    }
    const current = collapseAssistantTranscriptText(chunks.join(''));
    chunks.splice(0, chunks.length, mergeStreamingText(current, text));
}
function parseAssistantTranscriptEnvelope(line) {
    try {
        return JSON.parse(line);
    }
    catch {
        return null;
    }
}
function parseAssistantTranscriptEntries(text) {
    const entries = [];
    for (const [index, rawLine] of text.split('\n').entries()) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        const parsedLine = parseAssistantTranscriptEnvelope(line);
        if (!parsedLine) {
            continue;
        }
        if (!parsedLine || parsedLine.direction !== 'from_agent') {
            continue;
        }
        const atUtc = typeof parsedLine.atUtc === 'string' ? parsedLine.atUtc : '';
        if (parsedLine.event === 'session_update' && typeof parsedLine.payload === 'string') {
            try {
                const payload = JSON.parse(parsedLine.payload);
                const updateType = payload.update?.sessionUpdate;
                if (updateType === 'tool_call' || updateType === 'tool_call_update') {
                    entries.push({ type: 'tool', atUtc, index });
                    continue;
                }
                if (updateType === 'agent_message_chunk') {
                    const chunkText = extractChunkString(payload.update?.content?.text);
                    if (chunkText) {
                        entries.push({ type: 'chunk', atUtc, index, text: chunkText });
                    }
                }
            }
            catch {
                // ignore malformed transcript update payloads
            }
            continue;
        }
        if (parsedLine.event === 'response' && typeof parsedLine.payload === 'string') {
            try {
                const payload = JSON.parse(parsedLine.payload);
                const candidate = unwrapAssistantDisplayText(extractAssistantExplicitText(payload.result) ?? extractAssistantStreamedText(payload.result));
                if (candidate) {
                    entries.push({ type: 'response', atUtc, index, text: candidate });
                }
            }
            catch {
                // ignore malformed transcript response payloads
            }
        }
    }
    entries.sort((left, right) => {
        const timeCompare = left.atUtc.localeCompare(right.atUtc);
        return timeCompare !== 0 ? timeCompare : left.index - right.index;
    });
    return entries;
}
function parseAssistantTranscriptToolAudit(text) {
    const entries = [];
    for (const [index, rawLine] of text.split('\n').entries()) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        const parsedLine = parseAssistantTranscriptEnvelope(line);
        if (!parsedLine) {
            continue;
        }
        const atUtc = typeof parsedLine.atUtc === 'string' ? parsedLine.atUtc : '';
        if (parsedLine.direction === 'system' && parsedLine.event === 'tool_call_audit' && typeof parsedLine.payload === 'string') {
            const payload = safeParseJson(parsedLine.payload);
            if (!payload) {
                continue;
            }
            entries.push({
                atUtc,
                index,
                toolName: extractString(payload.toolName) ?? summarizeAssistantToolName(payload.args, undefined, undefined, undefined),
                resourceLabel: summarizeAssistantResourceLabel(payload.args),
                toolStatus: payload.allowed === false ? 'blocked' : undefined
            });
            continue;
        }
        if (parsedLine.direction === 'from_agent' && parsedLine.event === 'session_update' && typeof parsedLine.payload === 'string') {
            const payload = safeParseJson(parsedLine.payload);
            const update = payload?.update;
            const updateType = typeof update?.sessionUpdate === 'string' ? update.sessionUpdate : '';
            if (updateType !== 'tool_call' && updateType !== 'tool_call_update') {
                continue;
            }
            entries.push({
                atUtc,
                index,
                toolCallId: typeof update?.toolCallId === 'string' ? update.toolCallId : undefined,
                toolName: summarizeAssistantToolName(update?.rawInput, update?.rawOutput, update?.kind, update?.title),
                toolStatus: typeof update?.status === 'string' ? update.status : undefined,
                resourceLabel: summarizeAssistantResourceLabel(update?.rawInput, update?.rawOutput)
            });
        }
    }
    entries.sort((left, right) => {
        const timeCompare = left.atUtc.localeCompare(right.atUtc);
        return timeCompare !== 0 ? timeCompare : left.index - right.index;
    });
    return mergeAssistantToolEvents([], entries
        .map(({ atUtc: _atUtc, index: _index, ...entry }) => entry)
        .filter((entry) => !isFilteredAssistantToolName(entry.toolName)));
}
function looksLikeArticleChangeRequest(userMessage) {
    const normalized = userMessage.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    const conversationalPrefixes = [
        'what',
        'why',
        'how',
        'when',
        'where',
        'who',
        'summarize',
        'summary',
        'explain',
        'tell me',
        'can you explain',
        'can you tell me',
        'help me understand',
        'does this',
        'is this',
        'should this'
    ];
    if (conversationalPrefixes.some((prefix) => normalized.startsWith(prefix))) {
        return false;
    }
    const changePatterns = [
        /\bchange\b/,
        /\bupdate\b/,
        /\bedit\b/,
        /\brewrite\b/,
        /\bimprove\b/,
        /\brev(?:ise|ision)\b/,
        /\bmake changes?\b/,
        /\bfix\b/,
        /\bpropose\b/,
        /\bcreate proposal\b/,
        /\bdraft (?:a )?proposal\b/,
        /\bwrite (?:a )?proposal\b/
    ];
    return changePatterns.some((pattern) => pattern.test(normalized));
}
function extractHtmlFromContext(context) {
    const working = context.workingState;
    if (!working)
        return undefined;
    if (working.kind === 'article_html' || working.kind === 'proposal_html') {
        if (typeof working.payload === 'string') {
            return working.payload;
        }
        if (working.payload && typeof working.payload === 'object') {
            return extractString(working.payload.html);
        }
    }
    const backing = context.backingData;
    if (backing && typeof backing === 'object') {
        return extractString(backing.sourceHtml)
            ?? extractString(backing.previewHtml)
            ?? extractString(backing.proposedHtml);
    }
    return undefined;
}
function normalizeAssistantConfidenceScore(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 1) {
            return Math.max(0, Math.min(1, value / 100));
        }
        return Math.max(0, Math.min(1, value));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseFloat(value);
        if (!Number.isNaN(parsed)) {
            return normalizeAssistantConfidenceScore(parsed);
        }
    }
    return undefined;
}
function normalizeProposalPatchScope(value) {
    if (value === 'current' || value === 'article' || value === 'batch') {
        return value;
    }
    return undefined;
}
function normalizeProposalLineEdits(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const operations = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const record = item;
        const expectedText = extractString(record.expectedText);
        const lines = normalizeStringArray(record.lines);
        if (record.type === 'replace_lines') {
            const startLine = normalizePositiveInt(record.startLine);
            const endLine = normalizePositiveInt(record.endLine);
            if (!startLine || !endLine || startLine > endLine) {
                continue;
            }
            operations.push({ type: 'replace_lines', startLine, endLine, lines, expectedText });
            continue;
        }
        if (record.type === 'insert_after') {
            const line = normalizeNonNegativeInt(record.line);
            if (line === undefined) {
                continue;
            }
            operations.push({ type: 'insert_after', line, lines, expectedText });
            continue;
        }
        if (record.type === 'delete_lines') {
            const startLine = normalizePositiveInt(record.startLine);
            const endLine = normalizePositiveInt(record.endLine);
            if (!startLine || !endLine || startLine > endLine) {
                continue;
            }
            operations.push({ type: 'delete_lines', startLine, endLine, expectedText });
        }
    }
    return operations;
}
function inferProposalPatchScope(userMessage) {
    const normalized = userMessage.trim().toLowerCase();
    if (/\b(all proposals|every proposal|entire review|whole review|entire batch|whole batch)\b/.test(normalized)) {
        return 'batch';
    }
    if (/\b(this article|current article|article i[' ]?m viewing|article i'm viewing)\b/.test(normalized)) {
        return 'article';
    }
    return 'current';
}
function applyProposalPatchToHtml(currentHtml, patch) {
    if (patch.html && patch.html.trim()) {
        return patch.html;
    }
    const lineEdits = patch.lineEdits ?? [];
    if (lineEdits.length === 0) {
        return currentHtml;
    }
    const lines = currentHtml.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const hadTrailingNewline = currentHtml.endsWith('\n');
    let offset = 0;
    for (const edit of lineEdits) {
        if (edit.type === 'replace_lines') {
            const startIndex = edit.startLine - 1 + offset;
            const endIndex = edit.endLine - 1 + offset;
            const currentSlice = lines.slice(startIndex, endIndex + 1).join('\n');
            if (edit.expectedText && currentSlice !== edit.expectedText) {
                throw new Error(`Proposal patch guard failed for lines ${edit.startLine}-${edit.endLine}.`);
            }
            lines.splice(startIndex, endIndex - startIndex + 1, ...edit.lines);
            offset += edit.lines.length - (endIndex - startIndex + 1);
            continue;
        }
        if (edit.type === 'insert_after') {
            const insertIndex = Math.max(0, Math.min(lines.length, edit.line + offset));
            const anchorIndex = insertIndex - 1;
            if (edit.expectedText && anchorIndex >= 0) {
                const currentLine = lines[anchorIndex] ?? '';
                if (currentLine !== edit.expectedText) {
                    throw new Error(`Proposal patch guard failed for line ${edit.line}.`);
                }
            }
            lines.splice(insertIndex, 0, ...edit.lines);
            offset += edit.lines.length;
            continue;
        }
        const startIndex = edit.startLine - 1 + offset;
        const endIndex = edit.endLine - 1 + offset;
        const currentSlice = lines.slice(startIndex, endIndex + 1).join('\n');
        if (edit.expectedText && currentSlice !== edit.expectedText) {
            throw new Error(`Proposal patch guard failed for lines ${edit.startLine}-${edit.endLine}.`);
        }
        lines.splice(startIndex, endIndex - startIndex + 1);
        offset -= (endIndex - startIndex + 1);
    }
    const result = lines.join('\n');
    return hadTrailingNewline && result && !result.endsWith('\n') ? `${result}\n` : result;
}
function buildProposalWorkingStatePatch(patch) {
    const workingPatch = {};
    if (typeof patch.html === 'string')
        workingPatch.html = patch.html;
    if (typeof patch.title === 'string')
        workingPatch.title = patch.title;
    if (typeof patch.rationale === 'string')
        workingPatch.rationale = patch.rationale;
    if (typeof patch.rationaleSummary === 'string')
        workingPatch.rationaleSummary = patch.rationaleSummary;
    if (typeof patch.aiNotes === 'string')
        workingPatch.aiNotes = patch.aiNotes;
    return workingPatch;
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => typeof item === 'string');
}
function normalizePositiveInt(value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        return undefined;
    }
    return value;
}
function normalizeNonNegativeInt(value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        return undefined;
    }
    return value;
}
function looksLikeSuccessfulMutationClaim(response) {
    const normalized = response.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    return [
        /\bi updated\b/,
        /\bi changed\b/,
        /\bi fixed\b/,
        /\bi converted\b/,
        /\bupdated the\b/,
        /\bchanged the\b/,
        /\bconverted the\b/,
        /\bapplied the\b/
    ].some((pattern) => pattern.test(normalized));
}
