"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiAssistantService = void 0;
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
    constructor(workspaceRepository, agentRuntime, resolveWorkspaceKbAccessMode) {
        this.workspaceRepository = workspaceRepository;
        this.agentRuntime = agentRuntime;
        this.resolveWorkspaceKbAccessMode = resolveWorkspaceKbAccessMode;
    }
    async getContext(input) {
        await this.workspaceRepository.getWorkspace(input.workspaceId);
        return input.context;
    }
    async getSession(input) {
        await this.workspaceRepository.getWorkspace(input.workspaceId);
        const db = await this.openAssistantDb(input.workspaceId);
        try {
            const session = this.findSession(db, input.workspaceId, input.route, input.entityType, input.entityId);
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
             updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND id = @sessionId`, {
                ...input,
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
            const session = this.ensureSession(db, context);
            this.insertMessage(db, {
                id: (0, node_crypto_1.randomUUID)(),
                sessionId: session.id,
                workspaceId: input.workspaceId,
                role: 'user',
                messageKind: 'chat',
                content: input.message.trim(),
                createdAtUtc: new Date().toISOString()
            });
            this.updateSessionStatus(db, session.id, input.workspaceId, 'running');
            const kbAccessMode = await this.resolveWorkspaceKbAccessMode(input.workspaceId);
            const runtimeResult = await this.agentRuntime.runAssistantChat({
                workspaceId: input.workspaceId,
                localeVariantId: this.resolveRuntimeLocaleVariantId(context),
                sessionId: session.runtimeSessionId ?? undefined,
                kbAccessMode,
                locale: context.subject?.locale,
                prompt: this.buildAskPrompt(context, input.message, this.listMessages(db, session.id)),
                sessionType: 'assistant_chat'
            }, () => undefined, () => false);
            const parsed = this.parseRuntimeResult(runtimeResult.resultPayload, context, input.message);
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
                metadata: { artifactId: artifact.id, artifactType: artifact.artifactType },
                createdAtUtc: new Date().toISOString()
            });
            this.updateSessionAfterTurn(db, input.workspaceId, session.id, runtimeResult.sessionId, autoApply ? 'idle' : 'has_pending_artifact', artifact.id);
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
        const proposalId = artifact.entityId ?? context?.subject?.id;
        if (!proposalId) {
            return;
        }
        await this.workspaceRepository.updateProposalReviewWorkingCopy(artifact.workspaceId, proposalId, artifact.payload);
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
            'You are the KB Vault global AI assistant in ask mode.',
            'Return only valid JSON.',
            'JSON schema:',
            '{',
            '  "artifactType": "informational_response | proposal_candidate | proposal_patch | draft_patch | template_patch | clarification_request",',
            '  "response": "assistant-visible message",',
            '  "summary": "optional short summary for non-chat artifacts only",',
            '  "rationale": "optional rationale",',
            '  "title": "optional title",',
            '  "html": "required for proposal_patch or draft_patch",',
            '  "formPatch": { "name"?: "...", "language"?: "...", "templateType"?: "...", "promptTemplate"?: "...", "toneRules"?: "...", "description"?: "...", "examples"?: "...", "active"?: true },',
            '  "payload": { "targetTitle"?: "...", "targetLocale"?: "...", "sourceHtml"?: "...", "proposedHtml"?: "...", "metadata"?: {} }',
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
            '- If the user is asking a question, greeting you, asking for explanation, or chatting back and forth, use informational_response.',
            '- For informational_response, return only the user-facing response text. Do not include chain-of-thought, policy commentary, analysis, or extra JSON-shaped explanation outside the response field.',
            '- For informational_response, omit summary unless it is genuinely needed for internal bookkeeping.',
            '- If you are editing draft or proposal HTML, put the full replacement HTML in "html".',
            '- If you are editing a template, return only changed fields in "formPatch".',
            '- Only use proposal_candidate on article view when the user clearly asks to change, rewrite, update, or create a proposal for the article.'
        ].filter(Boolean).join('\n\n');
    }
    parseRuntimeResult(resultPayload, context, userMessage) {
        const parsed = extractJsonObject(resultPayload);
        const allowed = new Set(this.allowedArtifactTypes(context));
        const fallbackArtifactType = this.defaultArtifactType(context, userMessage);
        const artifactType = parsed?.artifactType && allowed.has(parsed.artifactType)
            ? parsed.artifactType
            : fallbackArtifactType;
        const rawResponse = extractString(parsed?.response) ?? extractString(parsed?.summary) ?? extractAssistantText(resultPayload);
        const response = unwrapAssistantDisplayText(rawResponse) ?? 'Assistant completed the request.';
        const summary = extractString(parsed?.summary) ?? response;
        return {
            artifactType,
            response,
            summary,
            rationale: extractString(parsed?.rationale) ?? undefined,
            title: extractString(parsed?.title) ?? undefined,
            html: extractString(parsed?.html) ?? undefined,
            formPatch: parsed?.formPatch && typeof parsed.formPatch === 'object' ? parsed.formPatch : undefined,
            payload: parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : undefined
        };
    }
    buildArtifactPayload(parsed, context) {
        if (parsed.artifactType === 'draft_patch') {
            return { html: parsed.html ?? '' };
        }
        if (parsed.artifactType === 'proposal_patch') {
            return {
                title: parsed.title,
                rationale: parsed.rationale,
                rationaleSummary: parsed.summary,
                html: parsed.html ?? ''
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
            const payload = artifact.payload;
            return [{ type: 'replace_working_html', target: 'proposal', html: payload.html }];
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
    defaultArtifactType(context, userMessage) {
        if (context.capabilities.canPatchDraft)
            return 'draft_patch';
        if (context.capabilities.canPatchProposal)
            return 'proposal_patch';
        if (context.capabilities.canPatchTemplate)
            return 'template_patch';
        if (context.capabilities.canCreateProposal) {
            return looksLikeArticleChangeRequest(userMessage) ? 'proposal_candidate' : 'informational_response';
        }
        return 'informational_response';
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
        return (0, db_1.openWorkspaceDatabase)(dbPath);
    }
    ensureSession(db, context) {
        const existing = this.findSession(db, context.workspaceId, context.route, context.subject?.type, context.subject?.id);
        if (existing) {
            return existing;
        }
        const now = new Date().toISOString();
        const id = (0, node_crypto_1.randomUUID)();
        db.run(`INSERT INTO ai_sessions (
        id, workspace_id, scope_type, route, entity_type, entity_id, status, runtime_session_id, latest_artifact_id, created_at, updated_at
      ) VALUES (
        @id, @workspaceId, @scopeType, @route, @entityType, @entityId, 'idle', NULL, NULL, @createdAt, @updatedAt
      )`, {
            id,
            workspaceId: context.workspaceId,
            scopeType: context.subject ? 'entity' : 'page',
            route: context.route,
            entityType: context.subject?.type ?? null,
            entityId: context.subject?.id ?? null,
            createdAt: now,
            updatedAt: now
        });
        return this.requireSessionById(db, context.workspaceId, id);
    }
    findSession(db, workspaceId, route, entityType, entityId) {
        return db.get(`SELECT id,
              workspace_id as workspaceId,
              scope_type as scopeType,
              route,
              entity_type as entityType,
              entity_id as entityId,
              status,
              runtime_session_id as runtimeSessionId,
              latest_artifact_id as latestArtifactId,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
       FROM ai_sessions
       WHERE workspace_id = @workspaceId
         AND route = @route
         AND COALESCE(entity_type, '') = COALESCE(@entityType, '')
         AND COALESCE(entity_id, '') = COALESCE(@entityId, '')
       LIMIT 1`, {
            workspaceId,
            route,
            entityType: entityType ?? null,
            entityId: entityId ?? null
        }) ?? undefined;
    }
    requireSessionById(db, workspaceId, sessionId) {
        const row = db.get(`SELECT id,
              workspace_id as workspaceId,
              scope_type as scopeType,
              route,
              entity_type as entityType,
              entity_id as entityId,
              status,
              runtime_session_id as runtimeSessionId,
              latest_artifact_id as latestArtifactId,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
       FROM ai_sessions
       WHERE workspace_id = @workspaceId AND id = @sessionId`, { workspaceId, sessionId });
        if (!row) {
            throw new Error('AI assistant session not found');
        }
        return row;
    }
    mapSessionRow(row) {
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            scopeType: row.scopeType,
            route: row.route,
            entityType: row.entityType,
            entityId: row.entityId ?? undefined,
            status: row.status,
            runtimeSessionId: row.runtimeSessionId ?? undefined,
            latestArtifactId: row.latestArtifactId ?? undefined,
            createdAtUtc: row.createdAtUtc,
            updatedAtUtc: row.updatedAtUtc
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
    updateSessionStatus(db, sessionId, workspaceId, status) {
        db.run(`UPDATE ai_sessions
       SET status = @status,
           updated_at = @updatedAt
       WHERE workspace_id = @workspaceId AND id = @sessionId`, {
            sessionId,
            workspaceId,
            status,
            updatedAt: new Date().toISOString()
        });
    }
    updateSessionAfterTurn(db, workspaceId, sessionId, runtimeSessionId, status, latestArtifactId) {
        db.run(`UPDATE ai_sessions
       SET runtime_session_id = COALESCE(@runtimeSessionId, runtime_session_id),
           status = @status,
           latest_artifact_id = COALESCE(@latestArtifactId, latest_artifact_id),
           updated_at = @updatedAt
       WHERE workspace_id = @workspaceId AND id = @sessionId`, {
            workspaceId,
            sessionId,
            runtimeSessionId: runtimeSessionId ?? null,
            status,
            latestArtifactId: latestArtifactId ?? null,
            updatedAt: new Date().toISOString()
        });
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
