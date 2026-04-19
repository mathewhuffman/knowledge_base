import { useEffect, useState } from 'react';
import type { BatchAnalysisQuestion, BatchAnalysisQuestionSetStatus } from '@kb-vault/shared-types';
import { Badge } from '../Badge';
import { humanizeAnalysisText } from './helpers';

interface BatchAnalysisQuestionCardProps {
  question: BatchAnalysisQuestion;
  questionSetStatus: BatchAnalysisQuestionSetStatus;
  disabled?: boolean;
  answerOverride?: string;
  answeredOverride?: boolean;
  onSubmit?: (questionId: string, answer: string) => Promise<void>;
}

export function BatchAnalysisQuestionCard({
  question,
  questionSetStatus,
  disabled,
  answerOverride,
  answeredOverride,
  onSubmit,
}: BatchAnalysisQuestionCardProps) {
  const persistedAnswer = answerOverride ?? question.answer ?? '';
  const isAnswered = answeredOverride || question.status === 'answered' || question.status === 'resolved' || persistedAnswer.trim().length > 0;
  const [draftAnswer, setDraftAnswer] = useState(persistedAnswer);
  const isResuming = questionSetStatus === 'ready_to_resume' || questionSetStatus === 'resuming';
  const canSubmit = !disabled && !isAnswered && questionSetStatus === 'waiting' && draftAnswer.trim().length > 0;

  useEffect(() => {
    setDraftAnswer(persistedAnswer);
  }, [persistedAnswer]);

  return (
    <div className={`ba-question-card ${question.requiresUserInput ? 'ba-question-card--required' : ''}`}>
      <div className="ba-question-card-header">
        <div className="ba-question-card-title">{humanizeAnalysisText(question.prompt)}</div>
        <div className="ba-question-card-badges">
          <Badge variant={question.requiresUserInput ? 'warning' : 'neutral'}>
            {question.requiresUserInput ? 'Required' : 'Optional'}
          </Badge>
          <Badge variant={isAnswered ? 'success' : isResuming ? 'primary' : 'neutral'}>
            {isAnswered ? 'Answered' : isResuming ? 'Resuming' : 'Awaiting answer'}
          </Badge>
        </div>
      </div>

      <div className="ba-question-card-reason">{humanizeAnalysisText(question.reason)}</div>

      {(question.linkedPbiIds.length > 0 || question.linkedPlanItemIds.length > 0 || question.linkedDiscoveryIds.length > 0) && (
        <div className="ba-question-card-links">
          {question.linkedPbiIds.map((id) => (
            <span key={`${question.id}:pbi:${id}`} className="ba-question-link-tag ba-question-link-tag--pbi">PBI {id}</span>
          ))}
          {question.linkedPlanItemIds.map((id) => (
            <span key={`${question.id}:plan:${id}`} className="ba-question-link-tag ba-question-link-tag--plan">Plan {id}</span>
          ))}
          {question.linkedDiscoveryIds.map((id) => (
            <span key={`${question.id}:discovery:${id}`} className="ba-question-link-tag ba-question-link-tag--discovery">Discovery {id}</span>
          ))}
        </div>
      )}

      <textarea
        className="input ba-question-card-input"
        rows={4}
        value={isAnswered ? persistedAnswer : draftAnswer}
        onChange={(event) => setDraftAnswer(event.target.value)}
        placeholder="Answer this question so the analysis can continue..."
        disabled={disabled || isAnswered || questionSetStatus !== 'waiting'}
      />

      <div className="ba-question-card-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canSubmit}
          onClick={() => {
            if (!canSubmit || !onSubmit) {
              return;
            }
            void onSubmit(question.id, draftAnswer.trim());
          }}
        >
          {disabled ? 'Saving...' : isAnswered ? 'Answered' : 'Submit answer'}
        </button>
      </div>

      {isResuming && (
        <div className="ba-question-card-state">
          All required answers are in. Resuming analysis now.
        </div>
      )}
      {!isResuming && isAnswered && questionSetStatus === 'waiting' && (
        <div className="ba-question-card-state">
          Saved. Waiting for the remaining required answers before analysis resumes.
        </div>
      )}
      {!isAnswered && question.requiresUserInput && questionSetStatus === 'waiting' && (
        <div className="ba-question-card-state">
          This answer is required before the batch can continue past plan review.
        </div>
      )}
    </div>
  );
}
