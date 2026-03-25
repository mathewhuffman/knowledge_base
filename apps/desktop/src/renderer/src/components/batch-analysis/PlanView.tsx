import { useState, useMemo } from 'react';
import type { BatchAnalysisPlan, BatchPlanItem } from '@kb-vault/shared-types';
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

  const latestPlan = plans[plans.length - 1] ?? null;
  const displayItems = useMemo(() => {
    if (!latestPlan) return [];
    return compact ? latestPlan.items.slice(0, 5) : latestPlan.items;
  }, [latestPlan, compact]);

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

      {/* Open questions */}
      {latestPlan.openQuestions.length > 0 && (
        <div className="ba-plan-questions">
          <span className="ba-detail-label">Open questions:</span>
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
          <div className="ba-plan-more">
            +{totalItems - 5} more item{totalItems - 5 !== 1 ? 's' : ''}
          </div>
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
