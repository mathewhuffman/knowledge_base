import type { AiViewContext, AiSessionRecord, AiArtifactRecord } from '@kb-vault/shared-types';
import { AppRoute } from '@kb-vault/shared-types';
import { IconRefreshCw, IconGlobe, IconFileText, IconGitBranch, IconEye, IconTool } from '../icons';

const ROUTE_ICONS: Partial<Record<AppRoute, React.ReactNode>> = {
  [AppRoute.ARTICLE_EXPLORER]: <IconFileText size={14} />,
  [AppRoute.DRAFTS]: <IconGitBranch size={14} />,
  [AppRoute.PROPOSAL_REVIEW]: <IconEye size={14} />,
  [AppRoute.TEMPLATES_AND_PROMPTS]: <IconTool size={14} />,
};

function capabilityTags(ctx: AiViewContext): string[] {
  const tags: string[] = [];
  if (ctx.capabilities.canCreateProposal) tags.push('Can propose');
  if (ctx.capabilities.canPatchDraft) tags.push('Can edit draft');
  if (ctx.capabilities.canPatchProposal) tags.push('Can refine');
  if (ctx.capabilities.canPatchTemplate) tags.push('Can edit template');
  return tags;
}

function statusLabel(session: AiSessionRecord | null, artifact: AiArtifactRecord | null): string | null {
  if (artifact?.status === 'pending') return 'Pending review';
  if (session?.status === 'running') return 'Generating...';
  if (session?.status === 'error') return 'Error';
  return null;
}

interface AssistantHeaderProps {
  context: AiViewContext | null;
  session: AiSessionRecord | null;
  artifact: AiArtifactRecord | null;
  loading: boolean;
  onReset: () => void;
}

export function AssistantHeader({ context, session, artifact, loading, onReset }: AssistantHeaderProps) {
  const routeIcon = context ? ROUTE_ICONS[context.route] ?? <IconGlobe size={14} /> : <IconGlobe size={14} />;
  const status = statusLabel(session, artifact);
  const caps = context ? capabilityTags(context) : [];

  return (
    <div className="ai-header">
      <div className="ai-header__top">
        <div className="ai-header__context">
          <span className="ai-header__route-badge">
            {routeIcon}
            <span>{context?.routeLabel ?? 'No context'}</span>
          </span>
          {context?.subject?.locale && (
            <span className="ai-header__locale-badge">{context.subject.locale.toUpperCase()}</span>
          )}
        </div>
        <button
          type="button"
          className="ai-header__reset"
          onClick={onReset}
          disabled={loading || !session}
          title="Reset conversation"
          aria-label="Reset conversation"
        >
          <IconRefreshCw size={12} />
        </button>
      </div>

      {context?.subject?.title && (
        <div className="ai-header__subject" title={context.subject.title}>
          {context.subject.title}
        </div>
      )}

      <div className="ai-header__meta">
        {caps.map((tag) => (
          <span key={tag} className="ai-header__cap-tag">{tag}</span>
        ))}
        {status && (
          <span className={`ai-header__status ai-header__status--${artifact?.status === 'pending' ? 'pending' : session?.status ?? 'idle'}`}>
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
