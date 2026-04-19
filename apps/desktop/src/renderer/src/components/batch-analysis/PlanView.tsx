import { useState, useMemo } from 'react';
import type { BatchAnalysisPlan, BatchAnalysisQuestion, BatchPlanItem } from '@kb-vault/shared-types';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { IconChevronRight } from '../icons';
import {
  actionBadgeVariant,
  actionLabel,
  executionStatusBadgeVariant,
  verdictBadgeVariant,
  confidenceColor,
  getVisibleStageLabel,
  STAGE_LABELS,
  humanizeAnalysisText,
} from './helpers';

interface PlanViewProps {
  plans: BatchAnalysisPlan[];
  supersededPlans?: BatchAnalysisPlan[];
  compact?: boolean;
}

function questionStatusBadgeVariant(question: BatchAnalysisQuestion) {
  if (question.status === 'resolved') {
    return 'success' as const;
  }
  if (question.status === 'answered') {
    return 'success' as const;
  }
  if (question.status === 'dismissed') {
    return 'neutral' as const;
  }
  return question.requiresUserInput ? 'warning' as const : 'neutral' as const;
}

function questionStatusLabel(question: BatchAnalysisQuestion): string {
  if (question.status === 'pending' && question.requiresUserInput) {
    return 'Needs input';
  }
  return question.status.replace(/_/g, ' ');
}

function PlanItemRow({
  item,
  expanded,
  onToggle,
}: {
  item: BatchPlanItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`ba-plan-item ${expanded ? 'ba-plan-item--expanded' : ''}`}>
      <div
        className="ba-plan-item-row"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        aria-expanded={expanded}
      >
        <span className="ba-plan-item-chevron" aria-hidden="true">
          <IconChevronRight size={12} />
        </span>
        <Badge variant={actionBadgeVariant(item.action)}>
          {actionLabel(item.action)}
        </Badge>
        <span className="ba-plan-item-target" title={humanizeAnalysisText(item.targetTitle)}>
          {humanizeAnalysisText(item.targetTitle)}
        </span>
        <span className="ba-confidence-bar" title={`${Math.round(item.confidence * 100)}% confidence`}>
          <span
            className="ba-confidence-fill"
            style={{
              width: `${Math.round(item.confidence * 100)}%`,
              background: confidenceColor(item.confidence * 100),
            }}
          />
        </span>
        <Badge variant={executionStatusBadgeVariant(item.executionStatus)}>
          {item.executionStatus}
        </Badge>
      </div>

      {expanded && (
        <div className="ba-plan-item-detail">
          {item.pbiIds.length > 0 && (
            <div className="ba-plan-item-pbis">
              <span className="ba-detail-label">PBIs:</span>
              {item.pbiIds.map((id) => (
                <span key={id} className="ba-pbi-tag">{id}</span>
              ))}
            </div>
          )}
          <div className="ba-plan-item-reason">
            <span className="ba-detail-label">Reason:</span>
            <span>{humanizeAnalysisText(item.reason)}</span>
          </div>
          {item.evidence.length > 0 && (
            <div className="ba-plan-item-evidence">
              <span className="ba-detail-label">Evidence:</span>
              <ul className="ba-evidence-list">
                {item.evidence.map((ev, i) => (
                  <li key={i}>
                    <Badge variant="neutral">{ev.kind}</Badge>
                    <span>{humanizeAnalysisText(ev.summary)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {item.targetArticleId && (
            <div className="ba-plan-item-meta-row">
              <span className="ba-detail-label">Target article:</span>
              <code>{item.targetArticleId}</code>
            </div>
          )}
          {item.targetFamilyId && (
            <div className="ba-plan-item-meta-row">
              <span className="ba-detail-label">Target family:</span>
              <code>{item.targetFamilyId}</code>
            </div>
          )}
          {item.dependsOn && item.dependsOn.length > 0 && (
            <div className="ba-plan-item-meta-row">
              <span className="ba-detail-label">Depends on:</span>
              <span>{item.dependsOn.join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PlanView({ plans, supersededPlans, compact }: PlanViewProps) {
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [showAllCompactItems, setShowAllCompactItems] = useState(false);

  const latestPlan = plans[0] ?? null;
  const displayItems = useMemo(() => {
    if (!latestPlan) return [];
    return compact && !showAllCompactItems ? latestPlan.items.slice(0, 5) : latestPlan.items;
  }, [latestPlan, compact, showAllCompactItems]);

  if (!latestPlan) {
    return (
      <EmptyState
        title="No plan yet"
        description="A plan will appear once the planner stage completes."
      />
    );
  }

  const totalItems = latestPlan.items.length;
  const supersededCount = supersededPlans?.length ?? 0;
  const structuredQuestions = latestPlan.questions ?? [];
  const requiredQuestionCount = structuredQuestions.filter((question) => question.requiresUserInput).length;
  const unansweredRequiredQuestionCount = structuredQuestions.filter((question) =>
    question.requiresUserInput
    && question.status !== 'answered'
    && question.status !== 'resolved'
  ).length;
  const displayedQuestions = compact ? structuredQuestions.slice(0, 3) : structuredQuestions;

  return (
    <div className="ba-plan-view">
      {/* Plan header */}
      <div className="ba-plan-header">
        <div className="ba-plan-header-left">
          <span className="ba-plan-title">
            Plan v{latestPlan.planVersion}
          </span>
          <Badge variant={verdictBadgeVariant(latestPlan.verdict)}>
            {latestPlan.verdict}
          </Badge>
          <span className="ba-plan-meta">
            {getVisibleStageLabel(latestPlan.stage) ?? STAGE_LABELS[latestPlan.stage]} &middot; Iter {latestPlan.iteration}
          </span>
        </div>
        <span className="ba-plan-count">{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
      </div>

      {/* Plan summary */}
      {latestPlan.summary && (
        <div className="ba-plan-summary">{humanizeAnalysisText(latestPlan.summary)}</div>
      )}

      {/* Structured questions */}
      {structuredQuestions.length > 0 && (
        <div className="ba-plan-questions">
          <div className="ba-plan-questions-header">
            <span className="ba-detail-label">Questions</span>
            <div className="ba-plan-question-badges">
              <Badge variant={unansweredRequiredQuestionCount > 0 ? 'warning' : 'neutral'}>
                {structuredQuestions.length} total
              </Badge>
              {requiredQuestionCount > 0 && (
                <Badge variant={unansweredRequiredQuestionCount > 0 ? 'warning' : 'success'}>
                  {unansweredRequiredQuestionCount > 0 ? `${unansweredRequiredQuestionCount} required pending` : 'Required answered'}
                </Badge>
              )}
            </div>
          </div>
          <div className="ba-plan-question-list">
            {displayedQuestions.map((question) => (
              <div key={question.id} className="ba-plan-question-row">
                <div className="ba-plan-question-row-top">
                  <span className="ba-plan-question-prompt">{humanizeAnalysisText(question.prompt)}</span>
                  <div className="ba-plan-question-row-badges">
                    {question.requiresUserInput && (
                      <Badge variant="warning">Required</Badge>
                    )}
                    <Badge variant={questionStatusBadgeVariant(question)}>
                      {questionStatusLabel(question)}
                    </Badge>
                  </div>
                </div>
                {!compact && question.reason && (
                  <div className="ba-plan-question-detail">
                    {humanizeAnalysisText(question.reason)}
                  </div>
                )}
                {!compact && question.answer && (
                  <div className="ba-plan-question-answer">
                    <span className="ba-detail-label">Answer</span>
                    <span>{question.answer}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {compact && structuredQuestions.length > displayedQuestions.length && (
            <div className="ba-plan-question-more">
              +{structuredQuestions.length - displayedQuestions.length} more question{structuredQuestions.length - displayedQuestions.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* Legacy string questions */}
      {structuredQuestions.length === 0 && latestPlan.openQuestions.length > 0 && (
        <div className="ba-plan-questions">
          <span className="ba-detail-label">Legacy open questions</span>
          <ul>
            {latestPlan.openQuestions.map((q, i) => (
              <li key={i}>{humanizeAnalysisText(q)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Items list */}
      <div className="ba-plan-items">
        {displayItems.map((item) => (
          <PlanItemRow
            key={item.planItemId}
            item={item}
            expanded={expandedItemId === item.planItemId}
            onToggle={() =>
              setExpandedItemId((prev) =>
                prev === item.planItemId ? null : item.planItemId,
              )
            }
          />
        ))}
        {compact && totalItems > 5 && (
          <button
            type="button"
            className="ba-plan-more btn btn-ghost btn-sm"
            onClick={() => setShowAllCompactItems((current) => !current)}
          >
            {showAllCompactItems
              ? 'Show fewer items'
              : `+${totalItems - 5} more item${totalItems - 5 !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {/* Superseded plans toggle */}
      {!compact && supersededCount > 0 && (
        <div className="ba-plan-superseded-toggle">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowSuperseded(!showSuperseded)}
          >
            {showSuperseded ? 'Hide' : 'Show'} superseded plans ({supersededCount})
          </button>
          {showSuperseded && supersededPlans && (
            <div className="ba-plan-superseded-list">
              {supersededPlans.map((plan) => (
                <div key={plan.id} className="ba-plan-superseded">
                  <div className="ba-plan-header">
                    <span className="ba-plan-title ba-plan-title--superseded">
                      Plan v{plan.planVersion}
                    </span>
                    <Badge variant="neutral">superseded</Badge>
                    <span className="ba-plan-meta">
                      {plan.items.length} items
                    </span>
                  </div>
                  {plan.summary && (
                    <div className="ba-plan-summary ba-plan-summary--superseded">
                      {humanizeAnalysisText(plan.summary)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
