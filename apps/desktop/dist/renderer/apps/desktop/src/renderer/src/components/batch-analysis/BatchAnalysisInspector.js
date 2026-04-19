import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useMemo } from 'react';
import { Badge } from '../Badge';
import { StagePipeline } from './StagePipeline';
import { PlanView } from './PlanView';
import { PlanReviewView } from './PlanReviewView';
import { FinalReviewView } from './FinalReviewView';
import { WorkerReportView } from './WorkerReportView';
import { DiscoveredWorkList } from './DiscoveredWorkList';
import { OpenQuestionsList } from './OpenQuestionsList';
import { TimelineView } from './TimelineView';
import { ArtifactTranscriptLink } from './ArtifactTranscriptLink';
import { deriveCompletedStages, getVisibleStage, getVisibleStageLabel, STAGE_LABELS, ROLE_LABELS } from './helpers';
function ExecCountsSummary({ counts }) {
    return (_jsxs("div", { className: "ba-overview-counts", children: [_jsxs("div", { className: "ba-overview-count", children: [_jsx("span", { className: "ba-overview-count-value", children: counts.total }), _jsx("span", { className: "ba-overview-count-label", children: "Total" })] }), _jsxs("div", { className: "ba-overview-count", children: [_jsx("span", { className: "ba-overview-count-value ba-overview-count--create", children: counts.create }), _jsx("span", { className: "ba-overview-count-label", children: "Create" })] }), _jsxs("div", { className: "ba-overview-count", children: [_jsx("span", { className: "ba-overview-count-value ba-overview-count--edit", children: counts.edit }), _jsx("span", { className: "ba-overview-count-label", children: "Edit" })] }), _jsxs("div", { className: "ba-overview-count", children: [_jsx("span", { className: "ba-overview-count-value ba-overview-count--retire", children: counts.retire }), _jsx("span", { className: "ba-overview-count-label", children: "Retire" })] }), _jsxs("div", { className: "ba-overview-count", children: [_jsx("span", { className: "ba-overview-count-value", children: counts.executed }), _jsx("span", { className: "ba-overview-count-label", children: "Executed" })] }), _jsxs("div", { className: "ba-overview-count", children: [_jsx("span", { className: "ba-overview-count-value ba-overview-count--blocked", children: counts.blocked }), _jsx("span", { className: "ba-overview-count-label", children: "Blocked" })] })] }));
}
export function BatchAnalysisInspector({ inspection, runtimeStatus, eventStream, isRunning, onOpenSession, onRefresh, }) {
    const [activeTab, setActiveTab] = useState('overview');
    const snapshot = inspection.snapshot;
    const currentStage = runtimeStatus?.stage ?? snapshot.latestIteration?.stage;
    const visibleCurrentStage = getVisibleStage(currentStage);
    const currentIteration = runtimeStatus?.iteration ?? snapshot.latestIteration?.iteration;
    const currentRole = runtimeStatus?.role ?? snapshot.latestIteration?.role;
    const executionCounts = runtimeStatus?.executionCounts ?? snapshot.latestIteration?.executionCounts;
    const outstandingDiscoveries = runtimeStatus?.outstandingDiscoveredWorkCount ?? snapshot.latestIteration?.outstandingDiscoveredWorkCount ?? 0;
    const pausedForUserInput = runtimeStatus?.pausedForUserInput ?? snapshot.pausedForUserInput;
    const unansweredRequiredQuestions = runtimeStatus?.unansweredRequiredQuestionCount ?? snapshot.unansweredRequiredQuestionCount ?? 0;
    const questionCount = inspection.questions.length;
    const completedStages = useMemo(() => deriveCompletedStages(inspection.timeline), [inspection.timeline]);
    const latestPlanReview = inspection.reviews[0] ?? null;
    const latestFinalReview = inspection.finalReviews[0] ?? null;
    const latestPlanReviewDelta = latestPlanReview
        ? inspection.reviewDeltas.find((delta) => delta.reviewId === latestPlanReview.id) ?? null
        : null;
    const latestFinalReviewDelta = latestFinalReview
        ? inspection.finalReviewReworkPlans.find((delta) => delta.finalReviewId === latestFinalReview.id) ?? null
        : null;
    const stageMetrics = useMemo(() => {
        const events = eventStream?.events ?? [];
        const grouped = new Map();
        for (const event of events) {
            const toolCallCount = typeof event.details?.toolCallCount === 'number' ? event.details.toolCallCount : undefined;
            const durationMs = typeof event.details?.durationMs === 'number' ? event.details.durationMs : undefined;
            const attempt = typeof event.details?.attempt === 'number' ? event.details.attempt : undefined;
            const retryType = typeof event.details?.retryType === 'string' ? event.details.retryType : undefined;
            if (toolCallCount == null && durationMs == null && attempt == null && !retryType) {
                continue;
            }
            const key = `${event.stage}:${event.role}`;
            const existing = grouped.get(key) ?? {
                stage: event.stage,
                role: event.role,
                toolCallCount: 0,
                durationMs: undefined,
                attempts: 0,
                retries: 0
            };
            if (toolCallCount != null) {
                existing.toolCallCount = Math.max(existing.toolCallCount, toolCallCount);
            }
            if (durationMs != null) {
                existing.durationMs = Math.max(existing.durationMs ?? 0, durationMs);
            }
            if (attempt != null) {
                existing.attempts = Math.max(existing.attempts, attempt);
            }
            if (retryType) {
                existing.retries += 1;
            }
            grouped.set(key, existing);
        }
        return Array.from(grouped.values());
    }, [eventStream?.events]);
    const failedStage = useMemo(() => {
        if (currentStage === 'failed' || currentStage === 'canceled') {
            const lastNonTerminal = inspection.timeline
                .filter((e) => e.stage !== 'failed' && e.stage !== 'canceled' && e.stage !== 'approved' && e.stage !== 'needs_human_review')
                .pop();
            return lastNonTerminal?.stage;
        }
        return undefined;
    }, [currentStage, inspection.timeline]);
    const tabs = [
        { key: 'overview', label: 'Overview' },
        { key: 'questions', label: 'Questions', count: unansweredRequiredQuestions || questionCount },
        { key: 'plan', label: 'Plan', count: inspection.plans.length },
        { key: 'reviews', label: 'Reviews', count: inspection.reviews.length + inspection.finalReviews.length },
        { key: 'execution', label: 'Execution', count: inspection.workerReports.length },
        { key: 'timeline', label: 'Timeline', count: inspection.timeline.length },
        { key: 'transcripts', label: 'Transcripts', count: inspection.transcriptLinks.length },
    ];
    return (_jsxs("div", { className: "ba-inspector", children: [_jsx("div", { className: "ba-inspector-pipeline", children: _jsx(StagePipeline, { currentStage: currentStage, iteration: currentIteration, completedStages: completedStages, failedStage: failedStage, isRunning: isRunning }) }), _jsx("div", { className: "tab-bar ba-inspector-tabs", children: tabs.map((tab) => (_jsxs("button", { className: `tab-item ${activeTab === tab.key ? 'active' : ''}`, onClick: () => setActiveTab(tab.key), children: [tab.label, tab.count != null && tab.count > 0 && (_jsx("span", { className: "ba-tab-count", children: tab.count }))] }, tab.key))) }), _jsxs("div", { className: "ba-inspector-body", children: [activeTab === 'overview' && (_jsxs("div", { className: "ba-overview", children: [_jsxs("div", { className: "ba-overview-meta", children: [currentStage && (_jsxs("div", { className: "ba-overview-meta-item", children: [_jsx("span", { className: "ba-detail-label", children: "Stage" }), _jsx(Badge, { variant: visibleCurrentStage === 'queued' ? 'success' : 'primary', children: getVisibleStageLabel(currentStage) ?? STAGE_LABELS[currentStage] })] })), currentRole && (_jsxs("div", { className: "ba-overview-meta-item", children: [_jsx("span", { className: "ba-detail-label", children: "Role" }), _jsx(Badge, { variant: "neutral", children: ROLE_LABELS[currentRole] })] })), currentIteration != null && (_jsxs("div", { className: "ba-overview-meta-item", children: [_jsx("span", { className: "ba-detail-label", children: "Iteration" }), _jsx("span", { children: currentIteration })] })), outstandingDiscoveries > 0 && (_jsxs("div", { className: "ba-overview-meta-item", children: [_jsx("span", { className: "ba-detail-label", children: "Discoveries" }), _jsx(Badge, { variant: "warning", children: outstandingDiscoveries })] })), (pausedForUserInput || questionCount > 0) && (_jsxs("div", { className: "ba-overview-meta-item", children: [_jsx("span", { className: "ba-detail-label", children: "Questions" }), _jsx(Badge, { variant: pausedForUserInput || unansweredRequiredQuestions > 0 ? 'warning' : 'neutral', children: unansweredRequiredQuestions > 0 ? `${unansweredRequiredQuestions} pending` : `${questionCount} tracked` })] })), runtimeStatus?.agentModelId && (_jsxs("div", { className: "ba-overview-meta-item", children: [_jsx("span", { className: "ba-detail-label", children: "Model" }), _jsx("code", { children: runtimeStatus.agentModelId })] }))] }), executionCounts && executionCounts.total > 0 && (_jsx(ExecCountsSummary, { counts: executionCounts })), stageMetrics.length > 0 && (_jsxs("div", { className: "ba-overview-section", children: [_jsx("h4", { className: "ba-section-heading", children: "Stage Metrics" }), _jsx("div", { className: "ba-detail-list", children: stageMetrics.map((metric) => (_jsx("div", { className: "ba-detail-card", children: _jsxs("div", { className: "ba-detail-card-header", children: [_jsx("div", { className: "ba-detail-card-title", children: getVisibleStageLabel(metric.stage) ?? STAGE_LABELS[metric.stage] }), _jsxs("div", { className: "ba-detail-card-meta", children: [_jsx(Badge, { variant: "neutral", children: ROLE_LABELS[metric.role] }), _jsxs("span", { children: [metric.toolCallCount, " tools"] }), metric.durationMs != null && _jsxs("span", { children: [Math.round(metric.durationMs / 1000), "s"] }), metric.attempts > 0 && _jsxs("span", { children: ["attempt ", metric.attempts] }), metric.retries > 0 && _jsxs("span", { children: [metric.retries, " retry"] })] })] }) }, `${metric.stage}:${metric.role}`))) })] })), inspection.plans.length > 0 && (_jsxs("div", { className: "ba-overview-section", children: [_jsx("h4", { className: "ba-section-heading", children: "Latest Plan" }), _jsx(PlanView, { plans: inspection.plans, compact: true })] })), inspection.questionSets.length > 0 && (_jsxs("div", { className: "ba-overview-section", children: [_jsxs("h4", { className: "ba-section-heading", children: ["Questions", _jsx(Badge, { variant: pausedForUserInput || unansweredRequiredQuestions > 0 ? 'warning' : 'neutral', children: unansweredRequiredQuestions || questionCount })] }), _jsx(OpenQuestionsList, { workspaceId: inspection.workspaceId, batchId: inspection.batchId, questionSets: inspection.questionSets, questions: inspection.questions, pausedForUserInput: pausedForUserInput, unansweredRequiredQuestionCount: unansweredRequiredQuestions, compact: true, onRefresh: onRefresh })] })), latestPlanReview && (_jsxs("div", { className: "ba-overview-section", children: [_jsx("h4", { className: "ba-section-heading", children: "Latest Plan Review" }), _jsx(PlanReviewView, { reviews: [latestPlanReview], reviewDeltas: latestPlanReviewDelta ? [latestPlanReviewDelta] : [] })] })), latestFinalReview && (_jsxs("div", { className: "ba-overview-section", children: [_jsx("h4", { className: "ba-section-heading", children: "Latest Final Review" }), _jsx(FinalReviewView, { finalReviews: [latestFinalReview], finalReviewDeltas: latestFinalReviewDelta ? [latestFinalReviewDelta] : [] })] })), inspection.discoveredWork.length > 0 && (_jsxs("div", { className: "ba-overview-section", children: [_jsxs("h4", { className: "ba-section-heading", children: ["Discovered Work", _jsx(Badge, { variant: "warning", children: inspection.discoveredWork.length })] }), _jsx(DiscoveredWorkList, { items: inspection.discoveredWork, compact: true })] }))] })), activeTab === 'plan' && (_jsx(PlanView, { plans: inspection.plans, supersededPlans: inspection.supersededPlans })), activeTab === 'questions' && (_jsx(OpenQuestionsList, { workspaceId: inspection.workspaceId, batchId: inspection.batchId, questionSets: inspection.questionSets, questions: inspection.questions, pausedForUserInput: pausedForUserInput, unansweredRequiredQuestionCount: unansweredRequiredQuestions, onRefresh: onRefresh })), activeTab === 'reviews' && (_jsxs("div", { className: "ba-reviews-combined", children: [_jsxs("div", { className: "ba-overview-section", children: [_jsx("h4", { className: "ba-section-heading", children: "Plan Reviews" }), _jsx(PlanReviewView, { reviews: inspection.reviews, reviewDeltas: inspection.reviewDeltas })] }), inspection.finalReviews.length > 0 && (_jsxs("div", { className: "ba-overview-section", children: [_jsx("h4", { className: "ba-section-heading", children: "Final Reviews" }), _jsx(FinalReviewView, { finalReviews: inspection.finalReviews, finalReviewDeltas: inspection.finalReviewReworkPlans })] }))] })), activeTab === 'execution' && (_jsxs("div", { className: "ba-execution-combined", children: [_jsx(WorkerReportView, { reports: inspection.workerReports }), inspection.discoveredWork.length > 0 && (_jsxs("div", { className: "ba-overview-section", children: [_jsxs("h4", { className: "ba-section-heading", children: ["Discovered Work", _jsx(Badge, { variant: "warning", children: inspection.discoveredWork.length })] }), _jsx(DiscoveredWorkList, { items: inspection.discoveredWork })] }))] })), activeTab === 'timeline' && (_jsx(TimelineView, { entries: inspection.timeline, stageEvents: eventStream?.events ?? [] })), activeTab === 'transcripts' && (_jsx(ArtifactTranscriptLink, { links: inspection.transcriptLinks, onOpenSession: onOpenSession }))] })] }));
}
