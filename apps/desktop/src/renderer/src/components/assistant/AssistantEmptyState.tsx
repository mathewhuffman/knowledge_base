import type { AiViewContext } from '@kb-vault/shared-types';
import { AppRoute } from '@kb-vault/shared-types';
import { IconMessageSquare, IconFileText, IconGitBranch, IconEye, IconTool, IconZap } from '../icons';

interface RouteEmptyConfig {
  icon: React.ReactNode;
  heading: string;
  description: string;
}

const ROUTE_EMPTY: Partial<Record<AppRoute, RouteEmptyConfig>> = {
  [AppRoute.ARTICLE_EXPLORER]: {
    icon: <IconFileText size={24} />,
    heading: 'Article assistant ready',
    description: 'Ask questions about this article or request a proposal to improve it. Changes will be created as proposals for your review.'
  },
  [AppRoute.DRAFTS]: {
    icon: <IconGitBranch size={24} />,
    heading: 'Draft assistant ready',
    description: 'Ask the assistant to revise, restructure, or improve this draft. Changes update your working copy — save when you\'re satisfied.'
  },
  [AppRoute.PROPOSAL_REVIEW]: {
    icon: <IconEye size={24} />,
    heading: 'Proposal assistant ready',
    description: 'Refine this proposal\'s content, rationale, or language. Changes update the review copy — accept or deny remains your decision.'
  },
  [AppRoute.TEMPLATES_AND_PROMPTS]: {
    icon: <IconTool size={24} />,
    heading: 'Template assistant ready',
    description: 'Improve prompt templates, tone rules, or adapt for different locales. Changes update the form — save when ready.'
  }
};

const DEFAULT_EMPTY: RouteEmptyConfig = {
  icon: <IconMessageSquare size={24} />,
  heading: 'AI Assistant',
  description: 'Navigate to a page with content to get context-aware assistance.'
};

interface AssistantEmptyStateProps {
  context: AiViewContext | null;
}

export function AssistantEmptyState({ context }: AssistantEmptyStateProps) {
  const config = context ? ROUTE_EMPTY[context.route] ?? DEFAULT_EMPTY : DEFAULT_EMPTY;
  const hasSubject = !!context?.subject?.title;

  return (
    <div className="ai-empty" role="status">
      <div className="ai-empty__icon">{config.icon}</div>
      <div className="ai-empty__heading">{config.heading}</div>
      <div className="ai-empty__description">{config.description}</div>
      {hasSubject && (
        <div className="ai-empty__scope">
          <IconZap size={12} />
          <span>Focused on: <strong>{context!.subject!.title}</strong></span>
        </div>
      )}
    </div>
  );
}
