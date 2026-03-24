import { useEffect, useRef } from 'react';
import type { AiMessageRecord } from '@kb-vault/shared-types';
import { IconZap } from '../icons';

interface AssistantTranscriptProps {
  messages: AiMessageRecord[];
  loading: boolean;
}

function formatTime(utc: string): string {
  try {
    return new Date(utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAssistantHtml(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(trimmed);
  if (looksLikeHtml) {
    return trimmed;
  }
  return escapeHtml(content).replace(/\n/g, '<br />');
}

function MessageBubble({ message }: { message: AiMessageRecord }) {
  const isUser = message.role === 'user';
  const isWarning = message.messageKind === 'warning';
  const isDecision = message.messageKind === 'decision';

  return (
    <div
      className={[
        'ai-msg',
        `ai-msg--${message.role}`,
        isWarning && 'ai-msg--warning',
        isDecision && 'ai-msg--decision'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {!isUser && (
        <div className="ai-msg__avatar">
          <IconZap size={12} />
        </div>
      )}
      <div className="ai-msg__body">
        {isUser ? (
          <div className="ai-msg__content">{message.content}</div>
        ) : (
          <div
            className="ai-msg__content ai-msg__content--rich"
            dangerouslySetInnerHTML={{ __html: formatAssistantHtml(message.content) }}
          />
        )}
        <div className="ai-msg__time">{formatTime(message.createdAtUtc)}</div>
      </div>
    </div>
  );
}

export function AssistantTranscript({ messages, loading }: AssistantTranscriptProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading]);

  return (
    <div className="ai-transcript" role="log" aria-label="Assistant conversation">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {loading && (
        <div className="ai-msg ai-msg--assistant ai-msg--typing">
          <div className="ai-msg__avatar">
            <IconZap size={12} />
          </div>
          <div className="ai-msg__body">
            <div className="ai-typing">
              <span /><span /><span />
            </div>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
