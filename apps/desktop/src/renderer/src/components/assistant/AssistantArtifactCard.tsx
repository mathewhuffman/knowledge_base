import type { AiArtifactRecord, AiArtifactType } from '@kb-vault/shared-types';
import {
  IconCheckCircle,
  IconXCircle,
  IconAlertCircle,
  IconFileText,
  IconGitBranch,
  IconEye,
  IconTool,
  IconArrowUpRight,
  IconRefreshCw
} from '../icons';

const TYPE_META: Record<AiArtifactType, { label: string; icon: React.ReactNode; family: 'proposal' | 'patch' | 'info' }> = {
  informational_response: { label: 'Response', icon: <IconFileText size={14} />, family: 'info' },
  proposal_candidate: { label: 'New Proposal', icon: <IconArrowUpRight size={14} />, family: 'proposal' },
  proposal_patch: { label: 'Proposal Refinement', icon: <IconEye size={14} />, family: 'patch' },
  draft_patch: { label: 'Draft Update', icon: <IconGitBranch size={14} />, family: 'patch' },
  template_patch: { label: 'Template Update', icon: <IconTool size={14} />, family: 'patch' },
  navigation_suggestion: { label: 'Navigation', icon: <IconArrowUpRight size={14} />, family: 'info' },
  clarification_request: { label: 'Clarification Needed', icon: <IconAlertCircle size={14} />, family: 'info' }
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting your decision',
  applied: 'Applied',
  rejected: 'Rejected',
  superseded: 'Superseded'
};

interface AssistantArtifactCardProps {
  artifact: AiArtifactRecord;
  stale?: boolean;
  loading: boolean;
  onApply: () => void;
  onReject: () => void;
  onRerun: () => void;
}

export function AssistantArtifactCard({ artifact, stale, loading, onApply, onReject, onRerun }: AssistantArtifactCardProps) {
  const meta = TYPE_META[artifact.artifactType] ?? TYPE_META.informational_response;
  const isPending = artifact.status === 'pending';
  const isProposalCandidate = artifact.artifactType === 'proposal_candidate';
  const isPatch = meta.family === 'patch';

  return (
    <div
      className={[
        'ai-artifact',
        `ai-artifact--${artifact.status}`,
        `ai-artifact--${meta.family}`,
        stale && 'ai-artifact--stale'
      ]
        .filter(Boolean)
        .join(' ')}
      role="region"
      aria-label={`${meta.label}: ${artifact.summary}`}
    >
      {/* Type badge row */}
      <div className="ai-artifact__type-row">
        <span className="ai-artifact__type-badge">
          {meta.icon}
          <span>{meta.label}</span>
        </span>
        <div className="ai-artifact__type-row-actions">
          <span className={`ai-artifact__status ai-artifact__status--${artifact.status}`}>
            {stale ? 'Stale — version changed' : STATUS_LABELS[artifact.status] ?? artifact.status}
          </span>
          {stale && isPending && (
            <button
              type="button"
              className="ai-artifact__dismiss"
              onClick={onReject}
              disabled={loading}
              aria-label="Close clarification alert"
              title="Close"
            >
              <IconXCircle size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="ai-artifact__summary">{artifact.summary}</div>

      {/* Stale warning */}
      {stale && isPending && (
        <div className="ai-artifact__stale-warning" role="alert">
          <IconAlertCircle size={14} />
          <div>
            <strong>Content has changed</strong> since this was generated. You can re-run the request or review carefully before applying.
          </div>
        </div>
      )}

      {/* Patch applied indicator */}
      {isPatch && artifact.status === 'applied' && (
        <div className="ai-artifact__applied-note">
          <IconCheckCircle size={14} />
          <span>Working copy updated — save when ready</span>
        </div>
      )}

      {/* Proposal candidate — approval-gated actions */}
      {isProposalCandidate && isPending && (
        <div className="ai-artifact__actions">
          <button
            type="button"
            className="ai-artifact__btn ai-artifact__btn--apply"
            onClick={onApply}
            disabled={loading}
          >
            <IconCheckCircle size={14} />
            Create Proposal
          </button>
          <button
            type="button"
            className="ai-artifact__btn ai-artifact__btn--reject"
            onClick={onReject}
            disabled={loading}
          >
            <IconXCircle size={14} />
            Dismiss
          </button>
        </div>
      )}

      {/* Stale re-run action */}
      {stale && isPending && (
        <div className="ai-artifact__actions ai-artifact__actions--stale">
          <button
            type="button"
            className="ai-artifact__btn ai-artifact__btn--rerun"
            onClick={onRerun}
            disabled={loading}
            title="Re-run with current content"
          >
            <IconRefreshCw size={14} />
            Re-run
          </button>
        </div>
      )}
    </div>
  );
}
