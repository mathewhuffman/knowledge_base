import type { BatchDiscoveredWorkItem } from '@kb-vault/shared-types';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import {
  actionBadgeVariant,
  actionLabel,
  discoveryStatusBadgeVariant,
  confidenceColor,
  humanizeAnalysisText,
} from './helpers';

interface DiscoveredWorkListProps {
  items: BatchDiscoveredWorkItem[];
  compact?: boolean;
}

export function DiscoveredWorkList({ items, compact }: DiscoveredWorkListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No discovered work"
        description="The worker has not identified any additional work items."
      />
    );
  }

  const displayItems = compact ? items.slice(0, 3) : items;

  return (
    <div className="ba-discoveries">
      {displayItems.map((item, index) => {
        const isRejected = item.status === 'rejected';
        return (
          <div
            key={`${item.sourceWorkerRunId}:${item.discoveryId}:${index}`}
            className={`ba-discovery-card ${item.status === 'escalated' ? 'ba-discovery-card--escalated' : ''} ${isRejected ? 'ba-discovery-card--rejected' : ''}`}
          >
            <div className="ba-discovery-header">
              <Badge variant={actionBadgeVariant(item.discoveredAction)}>
                {actionLabel(item.discoveredAction)}
              </Badge>
              <span className="ba-discovery-target" title={humanizeAnalysisText(item.suspectedTarget)}>
                {humanizeAnalysisText(item.suspectedTarget)}
              </span>
              <span className="ba-confidence-bar ba-confidence-bar--inline" title={`${Math.round(item.confidence * 100)}% confidence`}>
                <span
                  className="ba-confidence-fill"
                  style={{
                    width: `${Math.round(item.confidence * 100)}%`,
                    background: confidenceColor(item.confidence * 100),
                  }}
                />
              </span>
              {item.status && (
                <Badge variant={discoveryStatusBadgeVariant(item.status)}>
                  {item.status.replace('_', ' ')}
                </Badge>
              )}
            </div>

            <div className="ba-discovery-reason">{humanizeAnalysisText(item.reason)}</div>

            {!compact && (
              <>
                {item.linkedPbiIds.length > 0 && (
                  <div className="ba-discovery-pbis">
                    {item.linkedPbiIds.map((id, pbiIndex) => (
                      <span key={`${item.discoveryId}:pbi:${id}:${pbiIndex}`} className="ba-pbi-tag">{id}</span>
                    ))}
                  </div>
                )}

                {item.evidence.length > 0 && (
                  <div className="ba-discovery-evidence">
                    {item.evidence.map((ev, i) => (
                      <div key={i} className="ba-evidence-item">
                        <Badge variant="neutral">{ev.kind}</Badge>
                        <span>{humanizeAnalysisText(ev.summary)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {item.requiresPlanAmendment && (
                  <div className="ba-discovery-amendment-flag">
                    Requires plan amendment
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {compact && items.length > 3 && (
        <div className="ba-plan-more">
          +{items.length - 3} more discovery item{items.length - 3 !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
