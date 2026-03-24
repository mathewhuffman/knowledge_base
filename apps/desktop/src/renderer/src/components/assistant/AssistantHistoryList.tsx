import { useState, useMemo } from 'react';
import type { AiSessionRecord } from '@kb-vault/shared-types';
import { IconClock, IconPlus, IconX, IconSearch, IconMessageSquare } from '../icons';

function formatSessionTime(value?: string): string {
  if (!value) return 'No messages yet';
  try {
    return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return value;
  }
}

function dateGroupLabel(value?: string): string {
  if (!value) return 'Unknown';
  try {
    const d = new Date(value);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return 'This week';
    if (diffDays < 30) return 'This month';
    return d.toLocaleString([], { month: 'long', year: 'numeric' });
  } catch {
    return 'Unknown';
  }
}

interface GroupedSessions {
  label: string;
  sessions: AiSessionRecord[];
}

function groupByDate(sessions: AiSessionRecord[]): GroupedSessions[] {
  const groups = new Map<string, AiSessionRecord[]>();
  for (const s of sessions) {
    const label = dateGroupLabel(s.lastMessageAtUtc ?? s.updatedAtUtc);
    const list = groups.get(label) ?? [];
    list.push(s);
    groups.set(label, list);
  }
  return Array.from(groups, ([label, items]) => ({ label, sessions: items }));
}

export function AssistantHistoryList({
  sessions,
  activeSessionId,
  loading,
  onOpen,
  onDelete,
  onNewChat,
  onClose
}: {
  sessions: AiSessionRecord[];
  activeSessionId?: string;
  loading: boolean;
  onOpen: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter(
      (s) =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.entityTitle && s.entityTitle.toLowerCase().includes(q))
    );
  }, [sessions, search]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <div className="ai-history" aria-label="Chat history">
      {/* Sidebar header */}
      <div className="ai-history__header">
        <span className="ai-history__heading">Chat History</span>
        <button
          type="button"
          className="ai-history__close"
          onClick={onClose}
          title="Close history"
          aria-label="Close history"
        >
          <IconX size={14} />
        </button>
      </div>

      {/* New chat + search */}
      <div className="ai-history__toolbar">
        <button
          type="button"
          className="ai-history__new-chat"
          onClick={onNewChat}
          disabled={loading}
        >
          <IconPlus size={12} />
          <span>New Chat</span>
        </button>
        <div className="ai-history__search">
          <IconSearch size={12} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats..."
            className="ai-history__search-input"
            aria-label="Search chat history"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="ai-history__list">
        {groups.length === 0 ? (
          <div className="ai-history__empty">
            <IconMessageSquare size={20} />
            <span>{search ? 'No matching chats.' : 'No saved chats yet.'}</span>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="ai-history__group">
              <div className="ai-history__group-label">{group.label}</div>
              {group.sessions.map((session) => (
                <div
                  key={session.id}
                  className={`ai-history__item${session.id === activeSessionId ? ' active' : ''}`}
                >
                  <button
                    type="button"
                    className="ai-history__item-main"
                    onClick={() => onOpen(session.id)}
                    disabled={loading}
                  >
                    <div className="ai-history__item-top">
                      <span className="ai-history__title">{session.title || 'Untitled chat'}</span>
                      {session.id === activeSessionId && <span className="ai-history__badge">Current</span>}
                    </div>
                    {session.entityTitle && (
                      <div className="ai-history__meta">
                        <span>{session.entityTitle}</span>
                      </div>
                    )}
                    <div className="ai-history__time">
                      <IconClock size={11} />
                      <span>{formatSessionTime(session.lastMessageAtUtc ?? session.updatedAtUtc)}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="ai-history__delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onDelete(session.id);
                    }}
                    disabled={loading}
                    title="Delete conversation"
                    aria-label="Delete conversation"
                  >
                    <IconX size={12} />
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
