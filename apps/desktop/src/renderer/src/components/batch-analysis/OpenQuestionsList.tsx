import { useMemo, useState } from 'react';
import type {
  BatchAnalysisQuestion,
  BatchAnalysisQuestionAnswerResponse,
  BatchAnalysisQuestionSet,
  BatchAnalysisQuestionSetStatus,
} from '@kb-vault/shared-types';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { useIpcMutation } from '../../hooks/useIpc';
import { BatchAnalysisQuestionCard } from './BatchAnalysisQuestionCard';
import { formatDate, humanizeAnalysisText, ROLE_LABELS, STAGE_LABELS } from './helpers';

interface OpenQuestionsListProps {
  workspaceId: string;
  batchId: string;
  questionSets: BatchAnalysisQuestionSet[];
  questions: BatchAnalysisQuestion[];
  pausedForUserInput: boolean;
  unansweredRequiredQuestionCount: number;
  compact?: boolean;
  onRefresh?: () => void | Promise<void>;
}

function questionSetStatusBadgeVariant(status: BatchAnalysisQuestionSetStatus) {
  switch (status) {
    case 'waiting':
      return 'warning' as const;
    case 'ready_to_resume':
    case 'resuming':
      return 'primary' as const;
    case 'resolved':
      return 'success' as const;
    default:
      return 'neutral' as const;
  }
}

function questionSetStatusLabel(status: BatchAnalysisQuestionSetStatus): string {
  switch (status) {
    case 'ready_to_resume':
      return 'Ready to resume';
    default:
      return status.replace(/_/g, ' ');
  }
}

function isAnswered(question: BatchAnalysisQuestion): boolean {
  return question.status === 'answered' || question.status === 'resolved' || Boolean(question.answer?.trim());
}

function questionPriority(question: BatchAnalysisQuestion): number {
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

export function OpenQuestionsList({
  workspaceId,
  batchId,
  questionSets,
  questions,
  pausedForUserInput,
  unansweredRequiredQuestionCount,
  compact,
  onRefresh,
}: OpenQuestionsListProps) {
  const answerMutation = useIpcMutation<BatchAnalysisQuestionAnswerResponse>('batch.analysis.questions.answer');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [optimisticAnswers, setOptimisticAnswers] = useState<Record<string, string>>({});
  const [optimisticSetStatuses, setOptimisticSetStatuses] = useState<Record<string, BatchAnalysisQuestionSetStatus>>({});

  const sortedSets = useMemo(
    () => [...questionSets].sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc)),
    [questionSets],
  );
  const activeSet = useMemo(
    () => sortedSets.find((set) => ['waiting', 'ready_to_resume', 'resuming'].includes(set.status)) ?? sortedSets[0] ?? null,
    [sortedSets],
  );
  const visibleSets = compact
    ? activeSet ? [activeSet] : []
    : sortedSets;

  const questionsBySet = useMemo(() => {
    const grouped = new Map<string, BatchAnalysisQuestion[]>();
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

  const handleSubmit = async (questionId: string, answer: string) => {
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
    return (
      <EmptyState
        title="No questions"
        description="Planner and reviewer questions will appear here when the batch needs explicit user input."
      />
    );
  }

  return (
    <div className="ba-questions">
      <div className={`ba-question-banner ${pausedForUserInput ? 'ba-question-banner--warning' : 'ba-question-banner--neutral'}`}>
        <div className="ba-question-banner-title">
          {pausedForUserInput
            ? `Analysis is paused for ${unansweredRequiredQuestionCount} required answer${unansweredRequiredQuestionCount === 1 ? '' : 's'}.`
            : 'Question history for this batch.'}
        </div>
        <div className="ba-question-banner-meta">
          {activeSet && (
            <Badge variant={questionSetStatusBadgeVariant(optimisticSetStatuses[activeSet.id] ?? activeSet.status)}>
              {questionSetStatusLabel(optimisticSetStatuses[activeSet.id] ?? activeSet.status)}
            </Badge>
          )}
          {unansweredRequiredQuestionCount > 0 && (
            <Badge variant="warning">{unansweredRequiredQuestionCount} required pending</Badge>
          )}
        </div>
      </div>

      {submitError && (
        <div className="ba-question-error">
          {submitError}
        </div>
      )}

      {visibleSets.map((questionSet) => {
        const setQuestions = questionsBySet.get(questionSet.id) ?? [];
        const effectiveSetStatus = optimisticSetStatuses[questionSet.id] ?? questionSet.status;
        const requiredPendingCount = setQuestions.filter((question) =>
          question.requiresUserInput
          && !isAnswered({
            ...question,
            answer: optimisticAnswers[question.id] ?? question.answer,
          })
        ).length;

        return (
          <div key={questionSet.id} className="ba-question-set">
            <div className="ba-question-set-header">
              <div>
                <div className="ba-question-set-title">{humanizeAnalysisText(questionSet.summary)}</div>
                <div className="ba-question-set-meta">
                  <span>{ROLE_LABELS[questionSet.sourceRole]} in {STAGE_LABELS[questionSet.sourceStage]}</span>
                  <span>Resumes at {STAGE_LABELS[questionSet.resumeStage]}</span>
                  <span>{formatDate(questionSet.updatedAtUtc)}</span>
                </div>
              </div>
              <div className="ba-question-set-badges">
                <Badge variant={questionSetStatusBadgeVariant(effectiveSetStatus)}>
                  {questionSetStatusLabel(effectiveSetStatus)}
                </Badge>
                {requiredPendingCount > 0 && (
                  <Badge variant="warning">{requiredPendingCount} required left</Badge>
                )}
              </div>
            </div>

            <div className="ba-question-set-list">
              {setQuestions.map((question) => {
                const answerOverride = optimisticAnswers[question.id];
                return (
                  <BatchAnalysisQuestionCard
                    key={`${question.id}:${question.status}:${question.answer ?? ''}`}
                    question={question}
                    questionSetStatus={effectiveSetStatus}
                    disabled={answerMutation.loading}
                    answerOverride={answerOverride}
                    answeredOverride={Boolean(answerOverride?.trim())}
                    onSubmit={handleSubmit}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
