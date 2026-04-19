import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useMemo } from 'react';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { IconChevronRight } from '../icons';
import { actionBadgeVariant, actionLabel, executionStatusBadgeVariant, verdictBadgeVariant, confidenceColor, getVisibleStageLabel, STAGE_LABELS, humanizeAnalysisText, } from './helpers';
function questionStatusBadgeVariant(question) {
    if (question.status === 'resolved') {
        return 'success';
    }
    if (question.status === 'answered') {
        return 'success';
    }
    if (question.status === 'dismissed') {
        return 'neutral';
    }
    return question.requiresUserInput ? 'warning' : 'neutral';
}
function questionStatusLabel(question) {
    if (question.status === 'pending' && question.requiresUserInput) {
        return 'Needs input';
    }
    return question.status.replace(/_/g, ' ');
}
function PlanItemRow({ item, expanded, onToggle, }) {
    return (_jsxs("div", { className: `ba-plan-item ${expanded ? 'ba-plan-item--expanded' : ''}`, children: [_jsxs("div", { className: "ba-plan-item-row", onClick: onToggle, role: "button", tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle();
                } }, "aria-expanded": expanded, children: [_jsx("span", { className: "ba-plan-item-chevron", "aria-hidden": "true", children: _jsx(IconChevronRight, { size: 12 }) }), _jsx(Badge, { variant: actionBadgeVariant(item.action), children: actionLabel(item.action) }), _jsx("span", { className: "ba-plan-item-target", title: humanizeAnalysisText(item.targetTitle), children: humanizeAnalysisText(item.targetTitle) }), _jsx("span", { className: "ba-confidence-bar", title: `${Math.round(item.confidence * 100)}% confidence`, children: _jsx("span", { className: "ba-confidence-fill", style: {
                                width: `${Math.round(item.confidence * 100)}%`,
                                background: confidenceColor(item.confidence * 100),
                            } }) }), _jsx(Badge, { variant: executionStatusBadgeVariant(item.executionStatus), children: item.executionStatus })] }), expanded && (_jsxs("div", { className: "ba-plan-item-detail", children: [item.pbiIds.length > 0 && (_jsxs("div", { className: "ba-plan-item-pbis", children: [_jsx("span", { className: "ba-detail-label", children: "PBIs:" }), item.pbiIds.map((id) => (_jsx("span", { className: "ba-pbi-tag", children: id }, id)))] })), _jsxs("div", { className: "ba-plan-item-reason", children: [_jsx("span", { className: "ba-detail-label", children: "Reason:" }), _jsx("span", { children: humanizeAnalysisText(item.reason) })] }), item.evidence.length > 0 && (_jsxs("div", { className: "ba-plan-item-evidence", children: [_jsx("span", { className: "ba-detail-label", children: "Evidence:" }), _jsx("ul", { className: "ba-evidence-list", children: item.evidence.map((ev, i) => (_jsxs("li", { children: [_jsx(Badge, { variant: "neutral", children: ev.kind }), _jsx("span", { children: humanizeAnalysisText(ev.summary) })] }, i))) })] })), item.targetArticleId && (_jsxs("div", { className: "ba-plan-item-meta-row", children: [_jsx("span", { className: "ba-detail-label", children: "Target article:" }), _jsx("code", { children: item.targetArticleId })] })), item.targetFamilyId && (_jsxs("div", { className: "ba-plan-item-meta-row", children: [_jsx("span", { className: "ba-detail-label", children: "Target family:" }), _jsx("code", { children: item.targetFamilyId })] })), item.dependsOn && item.dependsOn.length > 0 && (_jsxs("div", { className: "ba-plan-item-meta-row", children: [_jsx("span", { className: "ba-detail-label", children: "Depends on:" }), _jsx("span", { children: item.dependsOn.join(', ') })] }))] }))] }));
}
export function PlanView({ plans, supersededPlans, compact }) {
    const [expandedItemId, setExpandedItemId] = useState(null);
    const [showSuperseded, setShowSuperseded] = useState(false);
    const [showAllCompactItems, setShowAllCompactItems] = useState(false);
    const latestPlan = plans[0] ?? null;
    const displayItems = useMemo(() => {
        if (!latestPlan)
            return [];
        return compact && !showAllCompactItems ? latestPlan.items.slice(0, 5) : latestPlan.items;
    }, [latestPlan, compact, showAllCompactItems]);
    if (!latestPlan) {
        return (_jsx(EmptyState, { title: "No plan yet", description: "A plan will appear once the planner stage completes." }));
    }
    const totalItems = latestPlan.items.length;
    const supersededCount = supersededPlans?.length ?? 0;
    const structuredQuestions = latestPlan.questions ?? [];
    const requiredQuestionCount = structuredQuestions.filter((question) => question.requiresUserInput).length;
    const unansweredRequiredQuestionCount = structuredQuestions.filter((question) => question.requiresUserInput
        && question.status !== 'answered'
        && question.status !== 'resolved').length;
    const displayedQuestions = compact ? structuredQuestions.slice(0, 3) : structuredQuestions;
    return (_jsxs("div", { className: "ba-plan-view", children: [_jsxs("div", { className: "ba-plan-header", children: [_jsxs("div", { className: "ba-plan-header-left", children: [_jsxs("span", { className: "ba-plan-title", children: ["Plan v", latestPlan.planVersion] }), _jsx(Badge, { variant: verdictBadgeVariant(latestPlan.verdict), children: latestPlan.verdict }), _jsxs("span", { className: "ba-plan-meta", children: [getVisibleStageLabel(latestPlan.stage) ?? STAGE_LABELS[latestPlan.stage], " \u00B7 Iter ", latestPlan.iteration] })] }), _jsxs("span", { className: "ba-plan-count", children: [totalItems, " item", totalItems !== 1 ? 's' : ''] })] }), latestPlan.summary && (_jsx("div", { className: "ba-plan-summary", children: humanizeAnalysisText(latestPlan.summary) })), structuredQuestions.length > 0 && (_jsxs("div", { className: "ba-plan-questions", children: [_jsxs("div", { className: "ba-plan-questions-header", children: [_jsx("span", { className: "ba-detail-label", children: "Questions" }), _jsxs("div", { className: "ba-plan-question-badges", children: [_jsxs(Badge, { variant: unansweredRequiredQuestionCount > 0 ? 'warning' : 'neutral', children: [structuredQuestions.length, " total"] }), requiredQuestionCount > 0 && (_jsx(Badge, { variant: unansweredRequiredQuestionCount > 0 ? 'warning' : 'success', children: unansweredRequiredQuestionCount > 0 ? `${unansweredRequiredQuestionCount} required pending` : 'Required answered' }))] })] }), _jsx("div", { className: "ba-plan-question-list", children: displayedQuestions.map((question) => (_jsxs("div", { className: "ba-plan-question-row", children: [_jsxs("div", { className: "ba-plan-question-row-top", children: [_jsx("span", { className: "ba-plan-question-prompt", children: humanizeAnalysisText(question.prompt) }), _jsxs("div", { className: "ba-plan-question-row-badges", children: [question.requiresUserInput && (_jsx(Badge, { variant: "warning", children: "Required" })), _jsx(Badge, { variant: questionStatusBadgeVariant(question), children: questionStatusLabel(question) })] })] }), !compact && question.reason && (_jsx("div", { className: "ba-plan-question-detail", children: humanizeAnalysisText(question.reason) })), !compact && question.answer && (_jsxs("div", { className: "ba-plan-question-answer", children: [_jsx("span", { className: "ba-detail-label", children: "Answer" }), _jsx("span", { children: question.answer })] }))] }, question.id))) }), compact && structuredQuestions.length > displayedQuestions.length && (_jsxs("div", { className: "ba-plan-question-more", children: ["+", structuredQuestions.length - displayedQuestions.length, " more question", structuredQuestions.length - displayedQuestions.length !== 1 ? 's' : ''] }))] })), structuredQuestions.length === 0 && latestPlan.openQuestions.length > 0 && (_jsxs("div", { className: "ba-plan-questions", children: [_jsx("span", { className: "ba-detail-label", children: "Legacy open questions" }), _jsx("ul", { children: latestPlan.openQuestions.map((q, i) => (_jsx("li", { children: humanizeAnalysisText(q) }, i))) })] })), _jsxs("div", { className: "ba-plan-items", children: [displayItems.map((item) => (_jsx(PlanItemRow, { item: item, expanded: expandedItemId === item.planItemId, onToggle: () => setExpandedItemId((prev) => prev === item.planItemId ? null : item.planItemId) }, item.planItemId))), compact && totalItems > 5 && (_jsx("button", { type: "button", className: "ba-plan-more btn btn-ghost btn-sm", onClick: () => setShowAllCompactItems((current) => !current), children: showAllCompactItems
                            ? 'Show fewer items'
                            : `+${totalItems - 5} more item${totalItems - 5 !== 1 ? 's' : ''}` }))] }), !compact && supersededCount > 0 && (_jsxs("div", { className: "ba-plan-superseded-toggle", children: [_jsxs("button", { className: "btn btn-ghost btn-sm", onClick: () => setShowSuperseded(!showSuperseded), children: [showSuperseded ? 'Hide' : 'Show', " superseded plans (", supersededCount, ")"] }), showSuperseded && supersededPlans && (_jsx("div", { className: "ba-plan-superseded-list", children: supersededPlans.map((plan) => (_jsxs("div", { className: "ba-plan-superseded", children: [_jsxs("div", { className: "ba-plan-header", children: [_jsxs("span", { className: "ba-plan-title ba-plan-title--superseded", children: ["Plan v", plan.planVersion] }), _jsx(Badge, { variant: "neutral", children: "superseded" }), _jsxs("span", { className: "ba-plan-meta", children: [plan.items.length, " items"] })] }), plan.summary && (_jsx("div", { className: "ba-plan-summary ba-plan-summary--superseded", children: humanizeAnalysisText(plan.summary) }))] }, plan.id))) }))] }))] }));
}
