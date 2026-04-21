import type { KbAccessMode } from './batch2';
import type { AppWorkingStateEntityType } from './app-working-state';
import type { AppRoute } from './routes';
import type { ProposalPlacementSuggestion } from './batch7';
export type AgentSessionType = 'batch_analysis' | 'article_edit' | 'assistant_chat';
export type AgentSessionMode = 'plan' | 'agent' | 'ask';
export type BatchAnalysisAgentRole = 'planner' | 'plan-reviewer' | 'worker' | 'final-reviewer';
export type BatchAnalysisSessionReusePolicy = 'reuse' | 'reset_acp' | 'new_local_session';
export type BatchAnalysisStageStatus = 'queued' | 'planning' | 'plan_reviewing' | 'plan_revision' | 'awaiting_user_input' | 'building' | 'worker_discovery_review' | 'final_reviewing' | 'reworking' | 'approved' | 'needs_human_review' | 'failed' | 'canceled';
export type BatchAnalysisArtifactVerdict = 'approved' | 'needs_revision' | 'needs_user_input' | 'needs_rework' | 'rejected' | 'blocked' | 'needs_human_review';
export type BatchPlanItemAction = 'create' | 'edit' | 'retire' | 'no_impact';
export type BatchPlanTargetType = 'article' | 'article_family' | 'article_set' | 'new_article' | 'unknown';
export type BatchPlanExecutionStatus = 'pending' | 'approved' | 'executed' | 'blocked' | 'rejected';
export type BatchAnalysisIterationStatus = 'running' | 'completed' | 'failed' | 'needs_user_input' | 'needs_human_review' | 'canceled';
export type AgentSessionStatus = 'starting' | 'running' | 'idle' | 'closed' | 'error';
export declare const MIN_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES = 5;
export declare const MAX_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES = 180;
export declare const DEFAULT_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES = 10;
export declare function normalizeBatchAnalysisWorkerStageBudgetMinutes(value: unknown): number | undefined;
export declare enum AgentCommand {
    ANALYSIS_RUN = "agent.analysis.run",
    ARTICLE_EDIT_RUN = "agent.article_edit.run"
}
export interface AgentSessionRecord {
    id: string;
    workspaceId: string;
    kbAccessMode: KbAccessMode;
    type: AgentSessionType;
    mode?: AgentSessionMode;
    role?: BatchAnalysisAgentRole;
    status: AgentSessionStatus;
    batchId?: string;
    locale?: string;
    templatePackId?: string;
    scope?: {
        localeVariantIds?: string[];
        familyIds?: string[];
    };
    directContext?: AgentDirectSessionContext;
    createdAtUtc: string;
    updatedAtUtc: string;
}
export interface AgentDirectSessionContext {
    route?: AppRoute;
    entityType?: AppWorkingStateEntityType;
    entityId?: string;
    workingStateVersionToken?: string;
    allowPatchForm?: boolean;
    localeVariantIds?: string[];
    familyIds?: string[];
}
export interface AgentSessionCreateRequest {
    workspaceId: string;
    kbAccessMode?: KbAccessMode;
    type: AgentSessionType;
    mode?: AgentSessionMode;
    role?: BatchAnalysisAgentRole;
    batchId?: string;
    locale?: string;
    templatePackId?: string;
    scope?: {
        localeVariantIds?: string[];
        familyIds?: string[];
    };
    directContext?: AgentDirectSessionContext;
}
export interface AgentSessionCloseRequest {
    workspaceId: string;
    sessionId: string;
}
export interface AgentSessionListRequest {
    workspaceId: string;
    includeClosed?: boolean;
}
export interface AgentSessionListResponse {
    workspaceId: string;
    sessions: AgentSessionRecord[];
}
export interface AgentSessionGetRequest {
    workspaceId: string;
    sessionId: string;
}
export interface AgentRuntimeOptionsRequest {
    workspaceId: string;
}
export interface AgentRuntimeModelCost {
    inputUsdPerMillion: number | null;
    cacheWriteUsdPerMillion: number | null;
    cacheReadUsdPerMillion: number | null;
    outputUsdPerMillion: number | null;
}
export interface AgentRuntimeModelOption {
    id: string;
    provider: string;
    name: string;
    costs: AgentRuntimeModelCost;
}
export interface AgentRuntimeOptionsResponse {
    workspaceId: string;
    currentModelId?: string;
    availableModels?: string[];
    modelCatalog?: AgentRuntimeModelOption[];
}
export interface AgentAnalysisRunRequest {
    workspaceId: string;
    batchId: string;
    kbAccessMode?: KbAccessMode;
    locale?: string;
    sessionId?: string;
    sessionReusePolicy?: BatchAnalysisSessionReusePolicy;
    sessionType?: AgentSessionType;
    sessionMode?: AgentSessionMode;
    agentRole?: BatchAnalysisAgentRole;
    prompt?: string;
    systemPrompt?: string;
    templatePackId?: string;
    localeVariantScope?: string[];
    timeoutMs?: number;
    workerStageBudgetMinutes?: number;
}
export interface AgentArticleEditRunRequest {
    workspaceId: string;
    localeVariantId: string;
    kbAccessMode?: KbAccessMode;
    locale?: string;
    sessionId?: string;
    sessionReusePolicy?: BatchAnalysisSessionReusePolicy;
    sessionType?: AgentSessionType;
    sessionMode?: AgentSessionMode;
    agentRole?: BatchAnalysisAgentRole;
    prompt?: string;
    timeoutMs?: number;
    directContext?: AgentDirectSessionContext;
}
export interface AgentAssistantChatRunRequest {
    workspaceId: string;
    localeVariantId: string;
    kbAccessMode?: KbAccessMode;
    locale?: string;
    sessionId?: string;
    sessionReusePolicy?: BatchAnalysisSessionReusePolicy;
    sessionType?: AgentSessionType;
    sessionMode?: AgentSessionMode;
    agentRole?: BatchAnalysisAgentRole;
    prompt?: string;
    timeoutMs?: number;
    directContext?: AgentDirectSessionContext;
}
export declare enum CliHealthFailure {
    BINARY_NOT_FOUND = "binary_not_found",
    BINARY_NOT_EXECUTABLE = "binary_not_executable",
    LOOPBACK_NOT_RUNNING = "loopback_not_running",
    LOOPBACK_UNREACHABLE = "loopback_unreachable",
    LOOPBACK_UNHEALTHY = "loopback_unhealthy",
    AUTH_TOKEN_MISSING = "auth_token_missing",
    HEALTH_PROBE_TIMEOUT = "health_probe_timeout",
    HEALTH_PROBE_FAILED = "health_probe_failed",
    HEALTH_PROBE_REJECTED = "health_probe_rejected"
}
export interface KbAccessHealth {
    mode: KbAccessMode;
    provider: KbAccessMode;
    ok: boolean;
    message?: string;
    binaryPath?: string;
    baseUrl?: string;
    acpReachable?: boolean;
    bridgeConfigPresent?: boolean;
    bridgeSocketPath?: string;
    bridgeReachable?: boolean;
    toolsetReady?: boolean;
    expectedToolNames?: string[];
    registeredToolNames?: string[];
    missingToolNames?: string[];
    issues?: string[];
    failureCode?: CliHealthFailure;
}
export interface KbAccessProviderDescriptor {
    mode: KbAccessMode;
    label: string;
    description: string;
    available: boolean;
    health: KbAccessHealth;
}
export interface AgentHealthCheckResponse {
    checkedAtUtc: string;
    workspaceId?: string;
    workspaceKbAccessMode?: KbAccessMode;
    selectedMode: KbAccessMode;
    providers: Record<KbAccessMode, KbAccessHealth>;
    issues: string[];
    availableModes: KbAccessMode[];
}
import type { AiAssistantTurnCompletionState } from './ai-assistant';
export interface AgentTranscriptRequest {
    workspaceId: string;
    sessionId: string;
    limit?: number;
}
export interface AgentTranscriptLine {
    atUtc: string;
    seq?: number;
    direction: 'to_agent' | 'from_agent' | 'system';
    event: string;
    payload: string;
}
export interface AgentTranscriptResponse {
    workspaceId: string;
    sessionId: string;
    lines: AgentTranscriptLine[];
}
export interface AgentToolCallAudit {
    workspaceId: string;
    sessionId: string;
    toolName: string;
    args: unknown;
    calledAtUtc: string;
    allowed: boolean;
    reason?: string;
}
export interface AgentRunResult {
    sessionId: string;
    acpSessionId?: string;
    kbAccessMode: KbAccessMode;
    status: 'ok' | 'error' | 'timeout' | 'canceled';
    completionState?: AiAssistantTurnCompletionState;
    isFinal?: boolean;
    transcriptPath: string;
    rawOutput: string[];
    resultPayload?: unknown;
    finalText?: string;
    toolCalls: AgentToolCallAudit[];
    startedAtUtc: string;
    endedAtUtc: string;
    durationMs: number;
    message?: string;
}
export interface PersistedAgentAnalysisRun {
    id: string;
    workspaceId: string;
    batchId: string;
    sessionId?: string;
    acpSessionId?: string;
    kbAccessMode?: KbAccessMode;
    agentModelId?: string;
    status: 'running' | 'complete' | 'failed' | 'canceled';
    startedAtUtc: string;
    endedAtUtc?: string;
    promptTemplate?: string;
    transcriptPath?: string;
    toolCalls: AgentToolCallAudit[];
    rawOutput?: string[];
    resultPayload?: unknown;
    message?: string;
}
export interface BatchAnalysisStageRunRecord {
    id: string;
    workspaceId: string;
    batchId: string;
    iterationId: string;
    iteration: number;
    stage: BatchAnalysisStageStatus;
    role: BatchAnalysisAgentRole;
    attempt: number;
    retryType?: string;
    sessionReusePolicy?: BatchAnalysisSessionReusePolicy;
    localSessionId?: string;
    acpSessionId?: string;
    kbAccessMode?: KbAccessMode;
    agentModelId?: string;
    status: PersistedAgentAnalysisRun['status'];
    promptTemplate?: string;
    transcriptPath?: string;
    toolCallCount: number;
    toolCalls: AgentToolCallAudit[];
    rawOutput?: string[];
    message?: string;
    parseable?: boolean;
    usedTranscriptRecovery?: boolean;
    initialCandidateCount?: number;
    transcriptCandidateCount?: number;
    textLength?: number;
    resultTextPreview?: string;
    createdAtUtc: string;
    startedAtUtc: string;
    endedAtUtc?: string;
}
export interface PersistedAgentAnalysisRunResponse {
    workspaceId: string;
    batchId: string;
    run: PersistedAgentAnalysisRun | null;
    lines: AgentTranscriptLine[];
    orchestration?: BatchAnalysisSnapshotResponse | null;
}
export interface BatchPlanEvidenceItem {
    kind: 'pbi' | 'article' | 'search' | 'review' | 'transcript' | 'other';
    ref: string;
    summary: string;
}
export interface BatchPlanCoverage {
    pbiId: string;
    outcome: 'covered' | 'gap' | 'no_impact' | 'blocked';
    planItemIds: string[];
    notes?: string;
}
export type BatchAnalysisQuestionStatus = 'pending' | 'answered' | 'resolved' | 'dismissed';
export type BatchAnalysisQuestionSetStatus = 'waiting' | 'ready_to_resume' | 'resuming' | 'resolved' | 'canceled';
export interface BatchAnalysisQuestion {
    id: string;
    questionSetId?: string;
    prompt: string;
    reason: string;
    requiresUserInput: boolean;
    linkedPbiIds: string[];
    linkedPlanItemIds: string[];
    linkedDiscoveryIds: string[];
    answer?: string;
    status: BatchAnalysisQuestionStatus;
    createdAtUtc: string;
    answeredAtUtc?: string;
}
export interface BatchAnalysisQuestionAnswer {
    questionId: string;
    prompt: string;
    answer: string;
    answeredAtUtc?: string;
}
export interface BatchAnalysisQuestionSet {
    id: string;
    workspaceId: string;
    batchId: string;
    iterationId: string;
    sourceStage: BatchAnalysisStageStatus;
    sourceRole: BatchAnalysisAgentRole;
    resumeStage: Extract<BatchAnalysisStageStatus, 'planning' | 'plan_revision' | 'worker_discovery_review'>;
    resumeRole: Extract<BatchAnalysisAgentRole, 'planner' | 'plan-reviewer'>;
    status: BatchAnalysisQuestionSetStatus;
    summary: string;
    planId?: string;
    reviewId?: string;
    createdAtUtc: string;
    updatedAtUtc: string;
}
export interface BatchPlanItem {
    planItemId: string;
    pbiIds: string[];
    action: BatchPlanItemAction;
    targetType: BatchPlanTargetType;
    targetArticleId?: string;
    targetFamilyId?: string;
    targetTitle: string;
    targetLocale?: string;
    suggestedPlacement?: ProposalPlacementSuggestion;
    reason: string;
    evidence: BatchPlanEvidenceItem[];
    confidence: number;
    dependsOn?: string[];
    executionStatus: BatchPlanExecutionStatus;
}
export interface BatchAnalysisPlan {
    id: string;
    workspaceId: string;
    batchId: string;
    iterationId: string;
    iteration: number;
    stage: Extract<BatchAnalysisStageStatus, 'planning' | 'plan_revision' | 'worker_discovery_review'>;
    role: 'planner';
    verdict: BatchAnalysisArtifactVerdict | 'draft';
    planVersion: number;
    summary: string;
    coverage: BatchPlanCoverage[];
    items: BatchPlanItem[];
    questions?: BatchAnalysisQuestion[];
    openQuestions: string[];
    createdAtUtc: string;
    supersedesPlanId?: string;
    sourceDiscoveryIds?: string[];
    agentModelId?: string;
    sessionId?: string;
}
export interface BatchPlanReviewDelta {
    summary: string;
    requestedChanges: string[];
    missingPbiIds: string[];
    missingCreates: string[];
    missingEdits: string[];
    additionalArticleWork: string[];
    targetCorrections: string[];
    overlapConflicts: string[];
}
export interface BatchPlanReview {
    id: string;
    workspaceId: string;
    batchId: string;
    iterationId: string;
    iteration: number;
    stage: Extract<BatchAnalysisStageStatus, 'plan_reviewing' | 'worker_discovery_review'>;
    role: 'plan-reviewer';
    verdict: BatchAnalysisArtifactVerdict;
    summary: string;
    didAccountForEveryPbi: boolean;
    hasMissingCreates: boolean;
    hasMissingEdits: boolean;
    hasTargetIssues: boolean;
    hasOverlapOrConflict: boolean;
    foundAdditionalArticleWork: boolean;
    underScopedKbImpact: boolean;
    delta?: BatchPlanReviewDelta;
    questions?: BatchAnalysisQuestion[];
    createdAtUtc: string;
    planId?: string;
    agentModelId?: string;
    sessionId?: string;
}
export interface BatchDiscoveredWorkItem {
    discoveryId: string;
    sourceWorkerRunId: string;
    discoveredAction: Exclude<BatchPlanItemAction, 'no_impact'>;
    suspectedTarget: string;
    reason: string;
    evidence: BatchPlanEvidenceItem[];
    linkedPbiIds: string[];
    confidence: number;
    requiresPlanAmendment: boolean;
    status?: 'pending_review' | 'approved' | 'rejected' | 'escalated';
}
export interface BatchWorkerExecutionItemResult {
    planItemId: string;
    action: BatchPlanItemAction;
    targetTitle?: string;
    status: 'executed' | 'blocked' | 'skipped';
    proposalId?: string;
    artifactIds?: string[];
    note?: string;
}
export interface BatchWorkerExecutionReport {
    id: string;
    workspaceId: string;
    batchId: string;
    iterationId: string;
    iteration: number;
    stage: Extract<BatchAnalysisStageStatus, 'building' | 'reworking'>;
    role: 'worker';
    summary: string;
    status: 'completed' | 'blocked' | 'needs_amendment' | 'failed';
    planId?: string;
    executedItems: BatchWorkerExecutionItemResult[];
    discoveredWork: BatchDiscoveredWorkItem[];
    blockerNotes: string[];
    createdAtUtc: string;
    agentModelId?: string;
    sessionId?: string;
}
export interface BatchPlanAmendment {
    id: string;
    workspaceId: string;
    batchId: string;
    iterationId: string;
    approvedPlanId?: string;
    sourceWorkerReportId: string;
    sourceDiscoveryIds: string[];
    proposedPlanId?: string;
    reviewId?: string;
    status: 'pending' | 'approved' | 'rejected' | 'needs_user_input' | 'needs_human_review';
    summary: string;
    createdAtUtc: string;
    updatedAtUtc: string;
}
export interface BatchFinalReviewDelta {
    summary: string;
    requestedRework: string[];
    uncoveredPbiIds: string[];
    missingArticleChanges: string[];
    duplicateRiskTitles: string[];
    unnecessaryChanges: string[];
    unresolvedAmbiguities: string[];
}
export interface BatchFinalReview {
    id: string;
    workspaceId: string;
    batchId: string;
    iterationId: string;
    iteration: number;
    stage: 'final_reviewing';
    role: 'final-reviewer';
    verdict: BatchAnalysisArtifactVerdict;
    summary: string;
    allPbisMapped: boolean;
    planExecutionComplete: boolean;
    hasMissingArticleChanges: boolean;
    hasUnresolvedDiscoveredWork: boolean;
    delta?: BatchFinalReviewDelta;
    createdAtUtc: string;
    planId?: string;
    workerReportId?: string;
    agentModelId?: string;
    sessionId?: string;
}
export interface BatchAnalysisExecutionCounts {
    total: number;
    create: number;
    edit: number;
    retire: number;
    noImpact: number;
    executed: number;
    blocked: number;
    rejected: number;
}
export interface BatchPlannerPrefetchPriorAnalysis {
    latestPlanSummary?: string;
    latestApprovedPlanSummary?: string;
    latestReviewVerdict?: string;
    latestFinalVerdict?: string;
}
export interface BatchPlannerPrefetchCluster {
    clusterId: string;
    label: string;
    pbiIds: string[];
    sampleTitles: string[];
    queries: string[];
}
export interface BatchPlannerArticleMatchResult {
    title: string;
    familyId: string;
    localeVariantId: string;
    score: number;
    matchContext?: string;
    snippet: string;
    placement?: ProposalPlacementSuggestion;
}
export interface BatchPlannerArticleMatch {
    clusterId: string;
    query: string;
    total: number;
    topResults: BatchPlannerArticleMatchResult[];
}
export interface BatchPlannerRelationMatch {
    title: string;
    familyId: string;
    strengthScore: number;
    relationType: string;
    evidence: string[];
    localeVariantIds?: string[];
    relationEligible?: boolean;
    typedEvidence?: BatchPlannerRelationEvidence[];
}
export interface BatchPlannerRelationEvidence {
    evidenceType: string;
    sourceRef?: string;
    snippet?: string;
    weight: number;
    metadata?: unknown;
}
export interface BatchPlannerTaxonomySection {
    sectionId: string;
    sectionName: string;
}
export interface BatchPlannerTaxonomyCategory {
    categoryId: string;
    categoryName: string;
    sections: BatchPlannerTaxonomySection[];
}
export interface BatchPlannerZendeskTaxonomy {
    locale: string;
    categories: BatchPlannerTaxonomyCategory[];
}
export interface BatchPlannerPrefetch {
    priorAnalysis: BatchPlannerPrefetchPriorAnalysis | null;
    topicClusters: BatchPlannerPrefetchCluster[];
    articleMatches: BatchPlannerArticleMatch[];
    relationMatches: BatchPlannerRelationMatch[];
    zendeskTaxonomy: BatchPlannerZendeskTaxonomy | null;
}
export interface BatchAnalysisIterationRecord {
    id: string;
    workspaceId: string;
    batchId: string;
    iteration: number;
    status: BatchAnalysisIterationStatus;
    stage: BatchAnalysisStageStatus;
    role: BatchAnalysisAgentRole;
    summary?: string;
    agentModelId?: string;
    sessionId?: string;
    approvedPlanId?: string;
    lastReviewVerdict?: BatchAnalysisArtifactVerdict;
    outstandingDiscoveredWorkCount: number;
    executionCounts: BatchAnalysisExecutionCounts;
    startedAtUtc: string;
    endedAtUtc?: string;
    createdAtUtc: string;
    updatedAtUtc: string;
}
export interface BatchAnalysisSnapshotResponse {
    workspaceId: string;
    batchId: string;
    latestIteration: BatchAnalysisIterationRecord | null;
    latestApprovedPlan: BatchAnalysisPlan | null;
    latestPlanReview: BatchPlanReview | null;
    latestWorkerReport: BatchWorkerExecutionReport | null;
    latestFinalReview: BatchFinalReview | null;
    discoveredWork: BatchDiscoveredWorkItem[];
    activeQuestionSet: BatchAnalysisQuestionSet | null;
    questions: BatchAnalysisQuestion[];
    pausedForUserInput: boolean;
    unansweredRequiredQuestionCount: number;
}
export interface BatchAnalysisReviewDeltaRecord {
    reviewId: string;
    iterationId: string;
    iteration: number;
    stage: BatchPlanReview['stage'];
    verdict: BatchAnalysisArtifactVerdict;
    summary: string;
    createdAtUtc: string;
    planId?: string;
    delta: BatchPlanReviewDelta;
}
export interface BatchAnalysisFinalReviewDeltaRecord {
    finalReviewId: string;
    iterationId: string;
    iteration: number;
    verdict: BatchAnalysisArtifactVerdict;
    summary: string;
    createdAtUtc: string;
    planId?: string;
    workerReportId?: string;
    delta: BatchFinalReviewDelta;
}
export interface BatchAnalysisTranscriptLink {
    artifactType: 'iteration' | 'plan' | 'review' | 'worker_report' | 'amendment' | 'final_review' | 'stage_run';
    artifactId: string;
    iterationId?: string;
    iteration?: number;
    stage: BatchAnalysisStageStatus;
    role: BatchAnalysisAgentRole;
    sessionId?: string;
    transcriptPath?: string;
    agentModelId?: string;
    createdAtUtc: string;
}
export interface BatchAnalysisTimelineEntry {
    artifactType: 'iteration' | 'plan' | 'review' | 'worker_report' | 'amendment' | 'final_review' | 'stage_run';
    artifactId: string;
    iterationId?: string;
    iteration?: number;
    stage: BatchAnalysisStageStatus;
    role: BatchAnalysisAgentRole;
    status?: string;
    verdict?: BatchAnalysisArtifactVerdict | 'draft';
    summary?: string;
    relatedPlanId?: string;
    relatedReviewId?: string;
    relatedWorkerReportId?: string;
    sessionId?: string;
    agentModelId?: string;
    createdAtUtc: string;
}
export interface BatchAnalysisInspectionResponse {
    workspaceId: string;
    batchId: string;
    snapshot: BatchAnalysisSnapshotResponse;
    iterations: BatchAnalysisIterationRecord[];
    stageRuns: BatchAnalysisStageRunRecord[];
    plans: BatchAnalysisPlan[];
    supersededPlans: BatchAnalysisPlan[];
    reviews: BatchPlanReview[];
    reviewDeltas: BatchAnalysisReviewDeltaRecord[];
    workerReports: BatchWorkerExecutionReport[];
    discoveredWork: BatchDiscoveredWorkItem[];
    questionSets: BatchAnalysisQuestionSet[];
    questions: BatchAnalysisQuestion[];
    amendments: BatchPlanAmendment[];
    finalReviews: BatchFinalReview[];
    finalReviewReworkPlans: BatchAnalysisFinalReviewDeltaRecord[];
    timeline: BatchAnalysisTimelineEntry[];
    transcriptLinks: BatchAnalysisTranscriptLink[];
}
export interface BatchAnalysisRuntimeStatus {
    workspaceId: string;
    batchId: string;
    iterationId?: string;
    iteration?: number;
    iterationStatus?: BatchAnalysisIterationStatus;
    stage?: BatchAnalysisStageStatus;
    role?: BatchAnalysisAgentRole;
    agentModelId?: string;
    sessionId?: string;
    approvedPlanId?: string;
    lastReviewVerdict?: BatchAnalysisArtifactVerdict;
    outstandingDiscoveredWorkCount: number;
    activeQuestionSetId?: string;
    activeQuestionSetStatus?: BatchAnalysisQuestionSetStatus;
    pausedForUserInput: boolean;
    unansweredRequiredQuestionCount: number;
    executionCounts: BatchAnalysisExecutionCounts;
    stageStartedAtUtc?: string;
    stageEndedAtUtc?: string;
    updatedAtUtc?: string;
    latestEventId?: string;
    latestEventType?: BatchAnalysisStageEventRecord['eventType'];
}
export interface BatchAnalysisStageEventDetails {
    previousStage?: BatchAnalysisStageStatus;
    previousRole?: BatchAnalysisAgentRole;
    transitionReason?: string;
    triggerBranch?: string;
    triggerArtifactType?: 'plan' | 'review' | 'worker_report' | 'amendment' | 'final_review' | 'stage_run' | 'question_set' | 'session' | 'system';
    triggerArtifactId?: string;
    triggerSessionId?: string;
    triggerVerdict?: BatchAnalysisArtifactVerdict | 'draft';
    triggerSummary?: string;
    parseable?: boolean;
    usedTranscriptRecovery?: boolean;
    textLength?: number;
    resultTextPreview?: string;
    [key: string]: unknown;
}
export interface BatchAnalysisStageEventRecord {
    id: string;
    workspaceId: string;
    batchId: string;
    iterationId: string;
    iteration: number;
    stage: BatchAnalysisStageStatus;
    role: BatchAnalysisAgentRole;
    eventType: 'iteration_started' | 'stage_transition' | 'stage_progress' | 'iteration_completed';
    status?: BatchAnalysisIterationStatus;
    summary?: string;
    sessionId?: string;
    agentModelId?: string;
    approvedPlanId?: string;
    lastReviewVerdict?: BatchAnalysisArtifactVerdict;
    outstandingDiscoveredWorkCount: number;
    executionCounts: BatchAnalysisExecutionCounts;
    details?: BatchAnalysisStageEventDetails;
    createdAtUtc: string;
}
export interface BatchAnalysisEventStreamResponse {
    workspaceId: string;
    batchId: string;
    events: BatchAnalysisStageEventRecord[];
}
export interface BatchAnalysisQuestionAnswerRequest {
    workspaceId: string;
    batchId: string;
    questionId: string;
    answer: string;
}
export interface BatchAnalysisQuestionAnswerResponse {
    workspaceId: string;
    batchId: string;
    questionId: string;
    questionSetId: string;
    unansweredRequiredQuestionCount: number;
    resumeTriggered: boolean;
    questionSetStatus: BatchAnalysisQuestionSetStatus;
    question: BatchAnalysisQuestion;
}
export interface AgentStreamingPayload {
    sessionId: string;
    kind: 'session_started' | 'progress' | 'tool_call' | 'tool_response' | 'result' | 'warning' | 'error' | 'timeout' | 'canceled';
    data?: unknown;
    message?: string;
    atUtc: string;
}
export interface AgentPromptContextRequest {
    workspaceId: string;
    locale?: string;
    templatePackId?: string;
    prompt?: string;
    batchId?: string;
}
export interface MCPToolInput {
    workspaceId: string;
}
export interface MCPSearchKbInput extends MCPToolInput {
    query?: string;
    localeVariantIds?: string[];
    familyIds?: string[];
    revisionIds?: string[];
    includeArchived?: boolean;
}
export interface MCPGetArticleInput extends MCPToolInput {
    revisionId?: string;
    localeVariantId?: string;
}
export interface MCPGetArticleFamilyInput extends MCPToolInput {
    familyId: string;
}
export interface MCPGetLocaleVariantInput extends MCPToolInput {
    localeVariantId: string;
}
export interface MCPAppGetFormSchemaInput extends MCPToolInput {
    route: AppRoute;
    entityType: AppWorkingStateEntityType;
    entityId: string;
}
export interface MCPAppPatchFormInput extends MCPToolInput {
    route: AppRoute;
    entityType: AppWorkingStateEntityType;
    entityId: string;
    versionToken?: string;
    patch: Record<string, unknown>;
}
export interface MCPFindRelatedArticlesInput extends MCPToolInput {
    query?: string;
    articleId?: string;
    familyId?: string;
    batchId?: string;
    locale?: string;
    max?: number;
    minScore?: number;
    includeEvidence?: boolean;
}
export interface MCPListCategoriesInput extends MCPToolInput {
    locale: string;
}
export interface MCPListSectionsInput extends MCPToolInput {
    locale: string;
    categoryId: number;
}
export interface MCPListArticleTemplatesInput extends MCPToolInput {
    locale?: string;
    includeInactive?: boolean;
}
export interface MCPGetTemplateInput extends MCPToolInput {
    templatePackId: string;
}
export interface MCPGetBatchContextInput extends MCPToolInput {
    batchId: string;
}
export interface MCPGetPBIInput extends MCPToolInput {
    pbiId: string;
}
export interface MCPGetPBISubsetInput extends MCPToolInput {
    batchId: string;
    rowNumbers?: number[];
}
export interface MCPGetArticleHistoryInput extends MCPToolInput {
    localeVariantId: string;
}
export interface MCPRecordAgentNotesInput extends MCPToolInput {
    sessionId?: string;
    note: string;
    metadata?: unknown;
    batchId?: string;
    localeVariantId?: string;
    familyId?: string;
    pbiIds?: string[];
    rationale?: string;
}
export declare const MCP_SEARCH_KB_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId"];
    readonly anyOf: readonly [{
        readonly required: readonly ["query"];
    }, {
        readonly required: readonly ["localeVariantIds"];
    }, {
        readonly required: readonly ["familyIds"];
    }, {
        readonly required: readonly ["revisionIds"];
    }];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly query: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly localeVariantIds: {
            readonly type: "array";
            readonly minItems: 1;
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
            };
        };
        readonly familyIds: {
            readonly type: "array";
            readonly minItems: 1;
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
            };
        };
        readonly revisionIds: {
            readonly type: "array";
            readonly minItems: 1;
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
            };
        };
        readonly includeArchived: {
            readonly type: "boolean";
        };
    };
};
export declare const MCP_GET_ARTICLE_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId"];
    readonly anyOf: readonly [{
        readonly required: readonly ["revisionId"];
    }, {
        readonly required: readonly ["localeVariantId"];
    }];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly revisionId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly localeVariantId: {
            readonly type: "string";
            readonly minLength: 1;
        };
    };
};
export declare const MCP_GET_ARTICLE_FAMILY_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId", "familyId"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly familyId: {
            readonly type: "string";
            readonly minLength: 1;
        };
    };
};
export declare const MCP_GET_LOCALE_VARIANT_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId", "localeVariantId"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly localeVariantId: {
            readonly type: "string";
            readonly minLength: 1;
        };
    };
};
export declare const MCP_FIND_RELATED_ARTICLES_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId"];
    readonly anyOf: readonly [{
        readonly required: readonly ["query"];
    }, {
        readonly required: readonly ["articleId"];
    }, {
        readonly required: readonly ["familyId"];
    }, {
        readonly required: readonly ["batchId"];
    }];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly query: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly articleId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly familyId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly batchId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly locale: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly max: {
            readonly type: "integer";
            readonly minimum: 1;
            readonly maximum: 100;
        };
        readonly minScore: {
            readonly type: "number";
            readonly minimum: 0;
            readonly maximum: 1;
        };
        readonly includeEvidence: {
            readonly type: "boolean";
        };
    };
};
export declare const MCP_LIST_CATEGORIES_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId", "locale"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly locale: {
            readonly type: "string";
            readonly minLength: 1;
        };
    };
};
export declare const MCP_LIST_SECTIONS_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId", "locale", "categoryId"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly locale: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly categoryId: {
            readonly type: "integer";
            readonly minimum: 1;
        };
    };
};
export declare const MCP_LIST_ARTICLE_TEMPLATES_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly locale: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly includeInactive: {
            readonly type: "boolean";
        };
    };
};
export declare const MCP_GET_TEMPLATE_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId", "templatePackId"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly templatePackId: {
            readonly type: "string";
            readonly minLength: 1;
        };
    };
};
export declare const MCP_GET_BATCH_CONTEXT_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId", "batchId"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly batchId: {
            readonly type: "string";
            readonly minLength: 1;
        };
    };
};
export declare const MCP_GET_PBI_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId", "pbiId"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly pbiId: {
            readonly type: "string";
            readonly minLength: 1;
        };
    };
};
export declare const MCP_GET_PBI_SUBSET_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId", "batchId"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly batchId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly rowNumbers: {
            readonly type: "array";
            readonly items: {
                readonly type: "integer";
                readonly minimum: 1;
            };
        };
    };
};
export declare const MCP_GET_ARTICLE_HISTORY_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId", "localeVariantId"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly localeVariantId: {
            readonly type: "string";
            readonly minLength: 1;
        };
    };
};
export declare const MCP_RECORD_AGENT_NOTES_INPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["workspaceId", "note"];
    readonly properties: {
        readonly workspaceId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly sessionId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly note: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly metadata: {};
        readonly batchId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly localeVariantId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly familyId: {
            readonly type: "string";
            readonly minLength: 1;
        };
        readonly pbiIds: {
            readonly type: "array";
            readonly minItems: 1;
            readonly items: {
                readonly type: "string";
                readonly minLength: 1;
            };
        };
        readonly rationale: {
            readonly type: "string";
            readonly minLength: 1;
        };
    };
};
