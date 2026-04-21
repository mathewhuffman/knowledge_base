import { useState } from 'react';
import type { BatchWorkerExecutionReport } from '@kb-vault/shared-types';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { IconChevronRight } from '../icons';
import {
  actionBadgeVariant,
  actionLabel,
  executionStatusBadgeVariant,
  formatTimestamp,
  getVisibleStageLabel,
  STAGE_LABELS,
  humanizeAnalysisText,
} from './helpers';

interface WorkerReportViewProps {
  reports: BatchWorkerExecutionReport[];
  compact?: boolean;
}

function ExecutionBar({ report }: { report: BatchWorkerExecutionReport }) {
  const executed = report.executedItems.filter((i) => i.status === 'executed').length;
  const blocked = report.executedItems.filter((i) => i.status === 'blocked').length;
  const skipped = report.executedItems.filter((i) => i.status === 'skipped').length;
  const total = report.executedItems.length || 1;

  return (
    <div className="ba-exec-section">
      <div className="ba-exec-counts">
        <span className="ba-exec-count ba-exec-count--executed">
          Executed: {executed}
        </span>
        <span className="ba-exec-count ba-exec-count--blocked">
          Blocked: {blocked}
        </span>
        <span className="ba-exec-count ba-exec-count--skipped">
          Skipped: {skipped}
        </span>
      </div>
      <div className="ba-exec-bar" role="img" aria-label={`${executed} executed, ${blocked} blocked, ${skipped} skipped`}>
        {executed > 0 && (
          <div
            className="ba-exec-segment ba-exec-segment--executed"
            style={{ width: `${(executed / total) * 100}%` }}
          />
        )}
        {blocked > 0 && (
          <div
            className="ba-exec-segment ba-exec-segment--blocked"
            style={{ width: `${(blocked / total) * 100}%` }}
          />
        )}
        {skipped > 0 && (
          <div
            className="ba-exec-segment ba-exec-segment--skipped"
            style={{ width: `${(skipped / total) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

function ExecutedItemRow({
  item,
  expanded,
  onToggle,
}: {
  item: BatchWorkerExecutionReport['executedItems'][number];
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
        <code className="ba-exec-item-id">{item.planItemId}</code>
        <Badge variant={executionStatusBadgeVariant(item.status)}>
          {item.status}
        </Badge>
      </div>

      {expanded && (
        <div className="ba-plan-item-detail">
          {item.note && (
            <div className="ba-plan-item-reason">
              <span className="ba-detail-label">Note:</span>
              <span>{humanizeAnalysisText(item.note)}</span>
            </div>
          )}
          {item.artifactIds && item.artifactIds.length > 0 && (
            <div className="ba-plan-item-meta-row">
              <span className="ba-detail-label">Artifacts:</span>
              <span>{item.artifactIds.join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkerReportView({ reports, compact }: WorkerReportViewProps) {
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  if (reports.length === 0) {
    return (
      <EmptyState
        title="No worker reports yet"
        description="Reports will appear after the worker execution stage."
      />
    );
  }

  return (
    <div className="ba-worker-reports">
      {reports.map((report) => (
        <div key={report.id} className="ba-worker-report card">
          <div className="ba-review-header">
            <span className="ba-review-title">Worker Report</span>
            <Badge variant={report.status === 'completed' ? 'success' : report.status === 'failed' ? 'danger' : 'warning'}>
              {report.status}
            </Badge>
            <span className="ba-review-meta">
              {getVisibleStageLabel(report.stage) ?? STAGE_LABELS[report.stage]} &middot; Iter {report.iteration}
            </span>
            <span className="ba-review-time">{formatTimestamp(report.createdAtUtc)}</span>
          </div>

          {report.summary && (
            <div className="ba-review-summary">{humanizeAnalysisText(report.summary)}</div>
          )}

          <ExecutionBar report={report} />

          {report.blockerNotes.length > 0 && (
            <div className="ba-worker-blockers">
              <span className="ba-detail-label">Blockers:</span>
              <ul className="ba-delta-list">
                {report.blockerNotes.map((note, i) => (
                  <li key={i}>{humanizeAnalysisText(note)}</li>
                ))}
              </ul>
            </div>
          )}

          {!compact && (
            <div className="ba-plan-items">
              {report.executedItems.map((item) => (
                <ExecutedItemRow
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
            </div>
          )}

          {report.discoveredWork.length > 0 && (
            <div className="ba-worker-discoveries-note">
              <Badge variant="warning">
                {report.discoveredWork.length} discovered work item{report.discoveredWork.length !== 1 ? 's' : ''}
              </Badge>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
