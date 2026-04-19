import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { useIpcMutation } from '../../hooks/useIpc';
import { BatchAnalysisQuestionCard } from './BatchAnalysisQuestionCard';
import { formatDate, humanizeAnalysisText, ROLE_LABELS, STAGE_LABELS } from './helpers';
function questionSetStatusBadgeVariant(status) {
    switch (status) {
        case 'waiting':
            return 'warning';
        case 'ready_to_resume':
        case 'resuming':
            return 'primary';
        case 'resolved':
            return 'success';
        default:
            return 'neutral';
    }
}
function questionSetStatusLabel(status) {
    switch (status) {
        case 'ready_to_resume':
            return 'Ready to resume';
        default:
            return status.replace(/_/g, ' ');
    }
}
function isAnswered(question) {
    return question.status === 'answered' || question.status === 'resolved' || Boolean(question.answer?.trim());
}
function questionPriority(question) {
    if (question.requiresUserInput && !isAnswered(question)) {
        return 0;
    }
    if (!question.requiresUserInput && !isAnswered(question)) {
        return 1;
    }
    if (question.status === 'answered') {
        return 2;
    }
    if (question.status === 'resolved') {
        return 3;
    }
    return 4;
}
export function OpenQuestionsList({ workspaceId, batchId, questionSets, questions, pausedForUserInput, unansweredRequiredQuestionCount, compact, onRefresh, }) {
    const answerMutation = useIpcMutation('batch.analysis.questions.answer');
    const [submitError, setSubmitError] = useState(null);
    const [optimisticAnswers, setOptimisticAnswers] = useState({});
    const [optimisticSetStatuses, setOptimisticSetStatuses] = useState({});
    const sortedSets = useMemo(() => [...questionSets].sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc)), [questionSets]);
    const activeSet = useMemo(() => sortedSets.find((set) => ['waiting', 'ready_to_resume', 'resuming'].includes(set.status)) ?? sortedSets[0] ?? null, [sortedSets]);
    const visibleSets = compact
        ? activeSet ? [activeSet] : []
        : sortedSets;
    const questionsBySet = useMemo(() => {
        const grouped = new Map();
        questions.forEach((question) => {
            if (!question.questionSetId) {
                return;
            }
            const existing = grouped.get(question.questionSetId) ?? [];
            existing.push(question);
            grouped.set(question.questionSetId, existing);
        });
        for (const [key, value] of grouped.entries()) {
            value.sort((left, right) => {
                const priorityDelta = questionPriority(left) - questionPriority(right);
                if (priorityDelta !== 0) {
                    return priorityDelta;
                }
                return left.createdAtUtc.localeCompare(right.createdAtUtc);
            });
            grouped.set(key, value);
        }
        return grouped;
    }, [questions]);
    const handleSubmit = async (questionId, answer) => {
        setSubmitError(null);
        const response = await answerMutation.mutate({
            workspaceId,
            batchId,
            questionId,
            answer,
        });
        if (!response) {
            setSubmitError(answerMutation.error ?? 'Failed to save the answer.');
            return;
        }
        setOptimisticAnswers((current) => ({
            ...current,
            [questionId]: response.question.answer ?? answer,
        }));
        setOptimisticSetStatuses((current) => ({
            ...current,
            [response.questionSetId]: response.questionSetStatus,
        }));
        if (onRefresh) {
            await Promise.resolve(onRefresh());
        }
        if (response.resumeTriggered && onRefresh) {
            window.setTimeout(() => {
                void Promise.resolve(onRefresh());
            }, 750);
        }
    };
    if (questionSets.length === 0 || visibleSets.length === 0) {
        return (_jsx(EmptyState, { title: "No questions", description: "Planner and reviewer questions will appear here when the batch needs explicit user input." }));
    }
    return (_jsxs("div", { className: "ba-questions", children: [_jsxs("div", { className: `ba-question-banner ${pausedForUserInput ? 'ba-question-banner--warning' : 'ba-question-banner--neutral'}`, children: [_jsx("div", { className: "ba-question-banner-title", children: pausedForUserInput
                            ? `Analysis is paused for ${unansweredRequiredQuestionCount} required answer${unansweredRequiredQuestionCount === 1 ? '' : 's'}.`
                            : 'Question history for this batch.' }), _jsxs("div", { className: "ba-question-banner-meta", children: [activeSet && (_jsx(Badge, { variant: questionSetStatusBadgeVariant(optimisticSetStatuses[activeSet.id] ?? activeSet.status), children: questionSetStatusLabel(optimisticSetStatuses[activeSet.id] ?? activeSet.status) })), unansweredRequiredQuestionCount > 0 && (_jsxs(Badge, { variant: "warning", children: [unansweredRequiredQuestionCount, " required pending"] }))] })] }), submitError && (_jsx("div", { className: "ba-question-error", children: submitError })), visibleSets.map((questionSet) => {
                const setQuestions = questionsBySet.get(questionSet.id) ?? [];
                const effectiveSetStatus = optimisticSetStatuses[questionSet.id] ?? questionSet.status;
                const requiredPendingCount = setQuestions.filter((question) => question.requiresUserInput
                    && !isAnswered({
                        ...question,
                        answer: optimisticAnswers[question.id] ?? question.answer,
                    })).length;
                return (_jsxs("div", { className: "ba-question-set", children: [_jsxs("div", { className: "ba-question-set-header", children: [_jsxs("div", { children: [_jsx("div", { className: "ba-question-set-title", children: humanizeAnalysisText(questionSet.summary) }), _jsxs("div", { className: "ba-question-set-meta", children: [_jsxs("span", { children: [ROLE_LABELS[questionSet.sourceRole], " in ", STAGE_LABELS[questionSet.sourceStage]] }), _jsxs("span", { children: ["Resumes at ", STAGE_LABELS[questionSet.resumeStage]] }), _jsx("span", { children: formatDate(questionSet.updatedAtUtc) })] })] }), _jsxs("div", { className: "ba-question-set-badges", children: [_jsx(Badge, { variant: questionSetStatusBadgeVariant(effectiveSetStatus), children: questionSetStatusLabel(effectiveSetStatus) }), requiredPendingCount > 0 && (_jsxs(Badge, { variant: "warning", children: [requiredPendingCount, " required left"] }))] })] }), _jsx("div", { className: "ba-question-set-list", children: setQuestions.map((question) => {
                                const answerOverride = optimisticAnswers[question.id];
                                return (_jsx(BatchAnalysisQuestionCard, { question: question, questionSetStatus: effectiveSetStatus, disabled: answerMutation.loading, answerOverride: answerOverride, answeredOverride: Boolean(answerOverride?.trim()), onSubmit: handleSubmit }, `${question.id}:${question.status}:${question.answer ?? ''}`));
                            }) })] }, questionSet.id));
            })] }));
}
