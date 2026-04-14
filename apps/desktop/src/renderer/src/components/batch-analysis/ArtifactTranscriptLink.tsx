import type { BatchAnalysisTranscriptLink } from '@kb-vault/shared-types';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { IconChevronRight, IconTerminal } from '../icons';
import { getVisibleStageLabel, STAGE_LABELS, ROLE_LABELS, formatTimestamp } from './helpers';

interface ArtifactTranscriptLinkProps {
  links: BatchAnalysisTranscriptLink[];
  onOpenSession?: (sessionId: string) => void;
}

function artifactIcon(type: BatchAnalysisTranscriptLink['artifactType']): string {
  switch (type) {
    case 'plan':
      return 'Plan';
    case 'review':
      return 'Review';
    case 'worker_report':
      return 'Worker';
    case 'amendment':
      return 'Amendment';
    case 'final_review':
      return 'Final Review';
    case 'iteration':
      return 'Iteration';
    case 'stage_run':
      return 'Stage Run';
    default:
      return type;
  }
}

export function ArtifactTranscriptLink({ links, onOpenSession }: ArtifactTranscriptLinkProps) {
  if (links.length === 0) {
    return (
      <EmptyState
        icon={<IconTerminal size={32} />}
        title="No transcript links"
        description="Transcript links will appear as stage artifacts are created."
      />
    );
  }

  return (
    <div className="ba-transcript-links" role="list" aria-label="Artifact transcript links">
      {links.map((link, idx) => (
        <div
          key={`${link.artifactId}-${idx}`}
          className="ba-transcript-link"
          role="listitem"
          tabIndex={link.sessionId ? 0 : undefined}
          onClick={() => link.sessionId && onOpenSession?.(link.sessionId)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && link.sessionId) {
              e.preventDefault();
              onOpenSession?.(link.sessionId);
            }
          }}
        >
          <div className="ba-transcript-link-left">
            <span className="ba-transcript-link-type">
              {artifactIcon(link.artifactType)}
            </span>
            <Badge variant="neutral">{getVisibleStageLabel(link.stage) ?? STAGE_LABELS[link.stage]}</Badge>
            <Badge variant="neutral">{ROLE_LABELS[link.role]}</Badge>
            {link.agentModelId && (
              <code className="ba-transcript-link-model">{link.agentModelId}</code>
            )}
          </div>

          <div className="ba-transcript-link-right">
            <span className="ba-transcript-link-time">
              {formatTimestamp(link.createdAtUtc)}
            </span>
            {link.sessionId && (
              <IconChevronRight size={14} className="ba-transcript-link-chevron" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
