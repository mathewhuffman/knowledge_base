import { useState, useCallback, useRef, useEffect } from 'react';
import type { AiViewContext } from '@kb-vault/shared-types';
import { AppRoute } from '@kb-vault/shared-types';
import { IconSend } from '../icons';

interface QuickAction {
  label: string;
  prompt: string;
}

const ROUTE_QUICK_ACTIONS: Partial<Record<AppRoute, QuickAction[]>> = {
  [AppRoute.ARTICLE_EXPLORER]: [
    { label: 'Suggest improvements', prompt: 'What improvements would you suggest for this article?' },
    { label: 'Propose update', prompt: 'Create a proposal to improve this article based on its current content.' },
    { label: 'Summarize', prompt: 'Summarize this article and highlight any gaps or outdated sections.' }
  ],
  [AppRoute.DRAFTS]: [
    { label: 'Improve clarity', prompt: 'Improve the clarity and readability of this draft.' },
    { label: 'Fix grammar', prompt: 'Fix any grammar and spelling issues in this draft.' },
    { label: 'Shorten', prompt: 'Make this draft more concise while preserving key information.' }
  ],
  [AppRoute.PROPOSAL_REVIEW]: [
    { label: 'Refine language', prompt: 'Refine the language and tone of this proposal to be more professional.' },
    { label: 'Strengthen rationale', prompt: 'Strengthen the rationale for this proposed change.' },
    { label: 'Simplify', prompt: 'Simplify this proposal while keeping all essential information.' }
  ],
  [AppRoute.TEMPLATES_AND_PROMPTS]: [
    { label: 'Improve template', prompt: 'Improve this template for clearer, more consistent article generation.' },
    { label: 'Add tone rules', prompt: 'Suggest tone rules appropriate for this template type.' },
    { label: 'Adapt for locale', prompt: 'Adapt this template for better localization support.' }
  ]
};

const ROUTE_PLACEHOLDERS: Partial<Record<AppRoute, string>> = {
  [AppRoute.ARTICLE_EXPLORER]: 'Ask about this article or request a proposal...',
  [AppRoute.DRAFTS]: 'Ask to revise this draft...',
  [AppRoute.PROPOSAL_REVIEW]: 'Ask to refine this proposal...',
  [AppRoute.TEMPLATES_AND_PROMPTS]: 'Ask to improve this template...'
};

interface AssistantComposerProps {
  context: AiViewContext | null;
  loading: boolean;
  onSend: (message: string) => Promise<void>;
}

export function AssistantComposer({ context, loading, onSend }: AssistantComposerProps) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const quickActions = context ? ROUTE_QUICK_ACTIONS[context.route] ?? [] : [];
  const placeholder = context
    ? ROUTE_PLACEHOLDERS[context.route] ?? 'Ask the assistant about this page...'
    : 'Select a page to get started...';

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || loading) return;
    setDraft('');
    await onSend(text);
  }, [draft, loading, onSend]);

  const handleQuickAction = useCallback(async (prompt: string) => {
    if (loading) return;
    setDraft('');
    await onSend(prompt);
  }, [loading, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  return (
    <div className="ai-composer">
      {quickActions.length > 0 && !draft && (
        <div className="ai-composer__quick-actions" role="group" aria-label="Quick actions">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="ai-composer__chip"
              onClick={() => void handleQuickAction(action.prompt)}
              disabled={loading}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      <div className="ai-composer__input-row">
        <textarea
          ref={textareaRef}
          className="ai-composer__textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          aria-label="Message to assistant"
        />
        <button
          type="button"
          className="ai-composer__send"
          disabled={loading || !draft.trim()}
          onClick={() => void handleSend()}
          aria-label="Send message"
        >
          {loading ? <span className="ai-composer__send-spinner" aria-hidden="true" /> : <IconSend size={14} />}
        </button>
      </div>
    </div>
  );
}
