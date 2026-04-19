import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Badge } from '../Badge';
import { humanizeAnalysisText } from './helpers';
export function BatchAnalysisQuestionCard({ question, questionSetStatus, disabled, answerOverride, answeredOverride, onSubmit, }) {
    const persistedAnswer = answerOverride ?? question.answer ?? '';
    const isAnswered = answeredOverride || question.status === 'answered' || question.status === 'resolved' || persistedAnswer.trim().length > 0;
    const [draftAnswer, setDraftAnswer] = useState(persistedAnswer);
    const isResuming = questionSetStatus === 'ready_to_resume' || questionSetStatus === 'resuming';
    const canSubmit = !disabled && !isAnswered && questionSetStatus === 'waiting' && draftAnswer.trim().length > 0;
    useEffect(() => {
        setDraftAnswer(persistedAnswer);
    }, [persistedAnswer]);
    return (_jsxs("div", { className: `ba-question-card ${question.requiresUserInput ? 'ba-question-card--required' : ''}`, children: [_jsxs("div", { className: "ba-question-card-header", children: [_jsx("div", { className: "ba-question-card-title", children: humanizeAnalysisText(question.prompt) }), _jsxs("div", { className: "ba-question-card-badges", children: [_jsx(Badge, { variant: question.requiresUserInput ? 'warning' : 'neutral', children: question.requiresUserInput ? 'Required' : 'Optional' }), _jsx(Badge, { variant: isAnswered ? 'success' : isResuming ? 'primary' : 'neutral', children: isAnswered ? 'Answered' : isResuming ? 'Resuming' : 'Awaiting answer' })] })] }), _jsx("div", { className: "ba-question-card-reason", children: humanizeAnalysisText(question.reason) }), (question.linkedPbiIds.length > 0 || question.linkedPlanItemIds.length > 0 || question.linkedDiscoveryIds.length > 0) && (_jsxs("div", { className: "ba-question-card-links", children: [question.linkedPbiIds.map((id) => (_jsxs("span", { className: "ba-question-link-tag ba-question-link-tag--pbi", children: ["PBI ", id] }, `${question.id}:pbi:${id}`))), question.linkedPlanItemIds.map((id) => (_jsxs("span", { className: "ba-question-link-tag ba-question-link-tag--plan", children: ["Plan ", id] }, `${question.id}:plan:${id}`))), question.linkedDiscoveryIds.map((id) => (_jsxs("span", { className: "ba-question-link-tag ba-question-link-tag--discovery", children: ["Discovery ", id] }, `${question.id}:discovery:${id}`)))] })), _jsx("textarea", { className: "input ba-question-card-input", rows: 4, value: isAnswered ? persistedAnswer : draftAnswer, onChange: (event) => setDraftAnswer(event.target.value), placeholder: "Answer this question so the analysis can continue...", disabled: disabled || isAnswered || questionSetStatus !== 'waiting' }), _jsx("div", { className: "ba-question-card-actions", children: _jsx("button", { type: "button", className: "btn btn-primary btn-sm", disabled: !canSubmit, onClick: () => {
                        if (!canSubmit || !onSubmit) {
                            return;
                        }
                        void onSubmit(question.id, draftAnswer.trim());
                    }, children: disabled ? 'Saving...' : isAnswered ? 'Answered' : 'Submit answer' }) }), isResuming && (_jsx("div", { className: "ba-question-card-state", children: "All required answers are in. Resuming analysis now." })), !isResuming && isAnswered && questionSetStatus === 'waiting' && (_jsx("div", { className: "ba-question-card-state", children: "Saved. Waiting for the remaining required answers before analysis resumes." })), !isAnswered && question.requiresUserInput && questionSetStatus === 'waiting' && (_jsx("div", { className: "ba-question-card-state", children: "This answer is required before the batch can continue past plan review." }))] }));
}
