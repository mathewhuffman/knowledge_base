import { IconZap, IconX } from '../icons';

interface AssistantLauncherProps {
  open: boolean;
  loading: boolean;
  hasUnread: boolean;
  onToggle: () => void;
}

export function AssistantLauncher({ open, loading, hasUnread, onToggle }: AssistantLauncherProps) {
  return (
    <button
      type="button"
      className={[
        'ai-launcher',
        open && 'ai-launcher--open',
        loading && 'ai-launcher--busy',
        hasUnread && !open && 'ai-launcher--unread'
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onToggle}
      title={open ? 'Close AI assistant' : 'Open AI assistant'}
      aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
      aria-expanded={open}
    >
      {loading && <span className="ai-launcher__pulse" aria-hidden="true" />}
      {hasUnread && !open && <span className="ai-launcher__badge" aria-label="New assistant response" />}
      <span className="ai-launcher__icon">
        {open ? <IconX size={18} /> : <IconZap size={18} />}
      </span>
    </button>
  );
}
