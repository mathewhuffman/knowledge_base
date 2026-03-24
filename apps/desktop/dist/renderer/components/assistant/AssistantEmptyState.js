import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AppRoute } from '@kb-vault/shared-types';
import { IconMessageSquare, IconFileText, IconGitBranch, IconEye, IconTool, IconZap } from '../icons';
const ROUTE_EMPTY = {
    [AppRoute.ARTICLE_EXPLORER]: {
        icon: _jsx(IconFileText, { size: 24 }),
        heading: 'Article assistant ready',
        description: 'Ask questions about this article or request a proposal to improve it. Changes will be created as proposals for your review.'
    },
    [AppRoute.DRAFTS]: {
        icon: _jsx(IconGitBranch, { size: 24 }),
        heading: 'Draft assistant ready',
        description: 'Ask the assistant to revise, restructure, or improve this draft. Changes update your working copy — save when you\'re satisfied.'
    },
    [AppRoute.PROPOSAL_REVIEW]: {
        icon: _jsx(IconEye, { size: 24 }),
        heading: 'Proposal assistant ready',
        description: 'Refine this proposal\'s content, rationale, or language. Changes update the review copy — accept or deny remains your decision.'
    },
    [AppRoute.TEMPLATES_AND_PROMPTS]: {
        icon: _jsx(IconTool, { size: 24 }),
        heading: 'Template assistant ready',
        description: 'Improve prompt templates, tone rules, or adapt for different locales. Changes update the form — save when ready.'
    }
};
const DEFAULT_EMPTY = {
    icon: _jsx(IconMessageSquare, { size: 24 }),
    heading: 'AI Assistant',
    description: 'Navigate to a page with content to get context-aware assistance.'
};
export function AssistantEmptyState({ context }) {
    const config = context ? ROUTE_EMPTY[context.route] ?? DEFAULT_EMPTY : DEFAULT_EMPTY;
    const hasSubject = !!context?.subject?.title;
    return (_jsxs("div", { className: "ai-empty", role: "status", children: [_jsx("div", { className: "ai-empty__icon", children: config.icon }), _jsx("div", { className: "ai-empty__heading", children: config.heading }), _jsx("div", { className: "ai-empty__description", children: config.description }), hasSubject && (_jsxs("div", { className: "ai-empty__scope", children: [_jsx(IconZap, { size: 12 }), _jsxs("span", { children: ["Focused on: ", _jsx("strong", { children: context.subject.title })] })] }))] }));
}
