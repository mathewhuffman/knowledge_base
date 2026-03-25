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
class AiAssistantService {
    workspaceRepository;
    agentRuntime;
    resolveWorkspaceKbAccessMode;
    appWorkingStateService;
    constructor(workspaceRepository, agentRuntime, resolveWorkspaceKbAccessMode, appWorkingStateService) {
        this.workspaceRepository = workspaceRepository;
        this.agentRuntime = agentRuntime;
        this.resolveWorkspaceKbAccessMode = resolveWorkspaceKbAccessMode;
        this.appWorkingStateService = appWorkingStateService;
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
        try {
            const session = this.ensureSession(db, context, input.sessionId);
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
            const workspaceKbAccessMode = await this.resolveWorkspaceKbAccessMode(input.workspaceId);
            const kbAccessMode = context.capabilities.canUseUnsavedWorkingState ? 'cli' : workspaceKbAccessMode;
            const runtimeResult = await this.agentRuntime.runAssistantChat({
                workspaceId: input.workspaceId,
                localeVariantId: this.resolveRuntimeLocaleVariantId(context),
                sessionId: session.runtimeSessionId ?? undefined,
                kbAccessMode,
                sessionMode: 'agent',
                locale: context.subject?.locale,
                prompt: this.buildAskPrompt(context, input.message, this.listMessages(db, session.id)),
                sessionType: 'assistant_chat'
            }, () => undefined, () => false);
            const directWorkingStateMutationApplied = this.didWorkingStateChangeDuringTurn(context);
            const transcriptFallbackText = await this.extractTranscriptAssistantText(runtimeResult.transcriptPath);
            const parsed = this.parseRuntimeResult(runtimeResult.resultPayload, context, input.message, directWorkingStateMutationApplied, transcriptFallbackText, runtimeResult.status === 'error' ? runtimeResult.message : undefined);
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
                    artifactId: artifact.id,
                    artifactType: artifact.artifactType,
                    ...this.buildContextMetadata(context)
                },
                createdAtUtc: new Date().toISOString()
            });
            this.updateSessionAfterTurn(db, input.workspaceId, session.id, runtimeResult.sessionId, autoApply ? 'idle' : 'has_pending_artifact', artifact.id, context, assistantMessage.createdAtUtc, parsed.title);
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
    buildAskPrompt(context, message, messages) {
        const allowedArtifacts = this.allowedArtifactTypes(context);
        const transcript = messages
            .slice(-8)
            .map((item) => `${item.role.toUpperCase()} (${item.messageKind}): ${item.content}`)
            .join('\n');
        return [
            'You are the KB Vault global AI assistant.',
            'For normal conversational help, explanations, summaries, and workflow guidance, answer in plain text.',
            'Only return JSON when you are intentionally requesting an artifact action such as creating a proposal, patching a proposal, patching a draft, or patching a template.',
            'When you do return JSON, use this schema:',
            '{',
            '  "command": "none | create_proposal | patch_proposal | patch_draft | patch_template",',
            '  "artifactType": "informational_response | proposal_candidate | proposal_patch | draft_patch | template_patch | clarification_request",',
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
            context.workingState ? `Working state: ${JSON.stringify(context.workingState)}` : 'Working state: none',
            `Backing data: ${JSON.stringify(context.backingData)}`,
            transcript ? `Recent messages:\n${transcript}` : '',
            `User message: ${message.trim()}`,
            'Rules:',
            '- Use working state as the source of truth when it exists.',
            '- Do not silently publish, finalize, or persist user content.',
            '- Any mutating result must include an explicit command and valid JSON. Without a valid command, the result will be treated as informational_response.',
            '- If the user is asking a question, greeting you, asking for explanation, or chatting back and forth, prefer a plain-text answer instead of JSON.',
            '- If the user explicitly asks you to research, ponder, look up, or investigate something, do that work and then return the final findings in the same turn. Do not stop on a progress update.',
            '- If you choose JSON for informational_response, return only the user-facing response text. Do not include chain-of-thought, policy commentary, analysis, or extra JSON-shaped explanation outside the response field.',
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
    parseRuntimeResult(resultPayload, context, userMessage, directWorkingStateMutationApplied = false, transcriptFallbackText, runtimeFailureMessage) {
        const parsed = extractJsonObject(resultPayload);
        const allowed = new Set(this.allowedArtifactTypes(context));
        const requestedArtifactType = parsed?.artifactType && allowed.has(parsed.artifactType)
            ? parsed.artifactType
            : 'informational_response';
        const rawResponse = extractString(parsed?.response)
            ?? extractString(parsed?.summary)
            ?? extractAssistantText(resultPayload)
            ?? transcriptFallbackText
            ?? runtimeFailureMessage;
        const response = unwrapAssistantDisplayText(rawResponse) ?? 'I ran into a runtime error before the assistant produced a reply.';
        const summary = extractString(parsed?.summary) ?? response;
        const html = extractString(parsed?.html) ?? undefined;
        const formPatch = parsed?.formPatch && typeof parsed.formPatch === 'object' ? parsed.formPatch : undefined;
        const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : undefined;
        const command = extractString(parsed?.command) ?? 'none';
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
    async extractTranscriptAssistantText(transcriptPath) {
        if (!transcriptPath) {
            return undefined;
        }
        try {
            const text = await node_fs_1.promises.readFile(transcriptPath, 'utf8');
            const chunkParts = [];
            const candidates = [];
            for (const rawLine of text.split('\n')) {
                const line = rawLine.trim();
                if (!line)
                    continue;
                let parsedLine = null;
                try {
                    parsedLine = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (!parsedLine || parsedLine.direction !== 'from_agent') {
                    continue;
                }
                if (parsedLine.event === 'response' && typeof parsedLine.payload === 'string') {
                    try {
                        const payload = JSON.parse(parsedLine.payload);
                        const candidate = extractAssistantText(payload.result);
                        if (candidate) {
                            candidates.push(candidate);
                        }
                    }
                    catch {
                        // ignore malformed transcript response payloads
                    }
                    continue;
                }
                if (parsedLine.event === 'session_update' && typeof parsedLine.payload === 'string') {
                    try {
                        const payload = JSON.parse(parsedLine.payload);
                        const chunkText = payload.update?.sessionUpdate === 'agent_message_chunk'
                            ? extractString(payload.update.content?.text)
                            : undefined;
                        if (chunkText) {
                            appendAssistantTranscriptChunk(chunkParts, chunkText);
                        }
                    }
                    catch {
                        // ignore malformed transcript update payloads
                    }
                }
            }
            const chunkCandidate = collapseAssistantTranscriptText(chunkParts.join(''));
            if (chunkCandidate) {
                candidates.push(chunkCandidate);
            }
            return candidates
                .map((candidate) => candidate.trim())
                .find(Boolean);
        }
        catch {
            return undefined;
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
        candidates.push(JSON.stringify(value));
        const payload = value;
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
        const trimmed = candidate.trim();
        if (!trimmed)
            continue;
        try {
            const direct = JSON.parse(trimmed);
            if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
                return direct;
            }
        }
        catch {
            const start = trimmed.indexOf('{');
            const end = trimmed.lastIndexOf('}');
            if (start >= 0 && end > start) {
                try {
                    const partial = JSON.parse(trimmed.slice(start, end + 1));
                    if (partial && typeof partial === 'object' && !Array.isArray(partial)) {
                        return partial;
                    }
                }
                catch {
                    // continue
                }
            }
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
function extractAssistantText(value) {
    const candidates = [];
    if (typeof value === 'string') {
        candidates.push(value);
    }
    else if (value && typeof value === 'object') {
        const payload = value;
        const topLevelText = extractString(payload.text);
        if (topLevelText) {
            candidates.push(topLevelText);
        }
        if (Array.isArray(payload.content)) {
            for (const item of payload.content) {
                if (!item || typeof item !== 'object')
                    continue;
                const record = item;
                const text = extractString(record.text);
                if (text) {
                    candidates.push(text);
                }
            }
        }
    }
    for (const candidate of candidates) {
        const cleaned = candidate
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !/^stop reason:/i.test(line) && !/^end of turn$/i.test(line))
            .join('\n')
            .trim();
        if (cleaned) {
            return cleaned;
        }
    }
    return undefined;
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
    let current = value;
    while (current.trim().length >= 64 && current.length % 2 === 0) {
        const midpoint = current.length / 2;
        const left = current.slice(0, midpoint);
        const right = current.slice(midpoint);
        if (!left.trim() || left !== right) {
            break;
        }
        current = left;
    }
    return current.trim();
}
function findAssistantTranscriptChunkOverlap(left, right) {
    const maxOverlap = Math.min(left.length, right.length);
    for (let overlap = maxOverlap; overlap >= 24; overlap -= 1) {
        if (left.slice(-overlap) === right.slice(0, overlap)) {
            return overlap;
        }
    }
    return 0;
}
function appendAssistantTranscriptChunk(chunks, text) {
    if (!text.trim()) {
        return;
    }
    const assembled = chunks.join('');
    if (!assembled) {
        chunks.push(text);
        return;
    }
    if (assembled.endsWith(text)) {
        return;
    }
    const overlap = findAssistantTranscriptChunkOverlap(assembled, text);
    const suffix = overlap > 0 ? text.slice(overlap) : text;
    if (suffix) {
        chunks.push(suffix);
    }
}
function stringifyResult(value) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    if (value && typeof value === 'object') {
        const text = extractString(value.text);
        if (text) {
            return text;
        }
        return JSON.stringify(value);
    }
    return 'Assistant completed the request.';
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
