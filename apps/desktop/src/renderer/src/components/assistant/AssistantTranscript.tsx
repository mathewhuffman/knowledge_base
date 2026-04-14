import { useEffect, useRef } from 'react';
import type {
  AiAssistantTurnCompletionState,
  AiAssistantMessageAuditMetadata,
  AiAssistantToolAuditRecord,
  AiMessageRecord
} from '@kb-vault/shared-types';
import type { PendingAssistantTurn } from './AssistantContext';
import { IconZap } from '../icons';

interface AssistantTranscriptProps {
  messages: AiMessageRecord[];
  pendingTurn: PendingAssistantTurn | null;
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

function extractAuditMetadata(message: AiMessageRecord): AiAssistantMessageAuditMetadata | null {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const thoughtText = typeof metadata.thoughtText === 'string' ? metadata.thoughtText : undefined;
  const completionState = typeof metadata.completionState === 'string'
    ? metadata.completionState as AiAssistantTurnCompletionState
    : undefined;
  const isFinal = typeof metadata.isFinal === 'boolean' ? metadata.isFinal : undefined;
  const toolEvents = Array.isArray(metadata.toolEvents)
    ? metadata.toolEvents.filter((entry): entry is AiAssistantToolAuditRecord => Boolean(entry) && typeof entry === 'object')
    : [];

  if (!thoughtText && toolEvents.length === 0 && !completionState && isFinal === undefined) {
    return null;
  }

  return {
    ...(thoughtText ? { thoughtText } : {}),
    ...(toolEvents.length > 0 ? { toolEvents } : {}),
    ...(completionState ? { completionState } : {}),
    ...(isFinal !== undefined ? { isFinal } : {})
  };
}

function formatToolStatus(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function formatThoughtResourceLabel(value: string): string {
  return value.replace(/^(resourceName|name|title|articleTitle|targetTitle):\s*/i, '').trim();
}

function formatThoughtToolLine(tool: {
  toolName?: string;
  toolStatus?: string;
  resourceLabel?: string;
}): string {
  const toolName = tool.toolName ?? 'Unknown tool';
  const resourceLabel = tool.resourceLabel ? formatThoughtResourceLabel(tool.resourceLabel) : '';
  const status = tool.toolStatus ? formatToolStatus(tool.toolStatus) : '';
  const resourcePart = resourceLabel ? `; ${resourceLabel}` : '';
  const statusPart = status ? ` - ${status}` : '';
  return `Tool: ${toolName}${resourcePart}${statusPart}`;
}

function formatCompletionLine(
  completionState: AiAssistantTurnCompletionState | undefined,
  isFinal: boolean | undefined
): string | null {
  if (!completionState && isFinal === undefined) {
    return null;
  }
  const stateLabel = completionState
    ? completionState.replace(/_/g, ' ')
    : 'unknown';
  const finalLabel = isFinal === undefined ? '' : `; final=${isFinal ? 'true' : 'false'}`;
  return `State: ${stateLabel}${finalLabel}`;
}

function ThoughtsBlock({
  thoughtText,
  toolEvents,
  completionState,
  isFinal
}: {
  thoughtText?: string;
  toolEvents?: Array<{
    toolCallId?: string;
    toolName?: string;
    toolStatus?: string;
    resourceLabel?: string;
  }>;
  completionState?: AiAssistantTurnCompletionState;
  isFinal?: boolean;
}) {
  const hasThoughts =
    Boolean(thoughtText?.trim())
    || Boolean(toolEvents?.length)
    || completionState !== undefined
    || isFinal !== undefined;
  if (!hasThoughts) {
    return null;
  }

  const completionLine = formatCompletionLine(completionState, isFinal);

  return (
    <details className="ai-msg__thoughts">
      <summary>Thoughts</summary>
      {completionLine ? (
        <div className="ai-msg__thoughts-text">{completionLine}</div>
      ) : null}
      {thoughtText?.trim() ? (
        <div className="ai-msg__thoughts-text">{thoughtText}</div>
      ) : null}
      {toolEvents && toolEvents.length > 0 ? (
        <div className="ai-msg__thoughts-tools">
          {toolEvents.map((tool, index) => (
            <div key={`${tool.toolCallId ?? 'tool'}:${index}`} className="ai-msg__thoughts-tool">
              {formatThoughtToolLine(tool)}
            </div>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function MessageBubble({ message }: { message: AiMessageRecord }) {
  const isUser = message.role === 'user';
  const isWarning = message.messageKind === 'warning';
  const isDecision = message.messageKind === 'decision';
  const audit = extractAuditMetadata(message);

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
          <>
            <div
              className="ai-msg__content ai-msg__content--rich"
              dangerouslySetInnerHTML={{ __html: formatAssistantHtml(message.content) }}
            />
            <ThoughtsBlock
              thoughtText={audit?.thoughtText}
              toolEvents={audit?.toolEvents}
              completionState={audit?.completionState}
              isFinal={audit?.isFinal}
            />
          </>
        )}
        <div className="ai-msg__time">{formatTime(message.createdAtUtc)}</div>
      </div>
    </div>
  );
}

function PendingAssistantBubble({ pendingTurn }: { pendingTurn: PendingAssistantTurn }) {
  const hasThoughts = pendingTurn.thoughtText.trim().length > 0 || pendingTurn.toolEvents.length > 0;

  return (
    <div className="ai-msg ai-msg--assistant ai-msg--streaming">
      <div className="ai-msg__avatar">
        <IconZap size={12} />
      </div>
      <div className="ai-msg__body">
        <div className="ai-msg__content ai-msg__content--rich">
          {pendingTurn.responseText ? (
            <div dangerouslySetInnerHTML={{ __html: formatAssistantHtml(pendingTurn.responseText) }} />
          ) : (
            <div className="ai-typing">
              <span /><span /><span />
            </div>
          )}
        </div>
        {hasThoughts ? (
          <ThoughtsBlock thoughtText={pendingTurn.thoughtText} toolEvents={pendingTurn.toolEvents} />
        ) : null}
        {pendingTurn.error && (
          <div className="ai-msg__stream-error">{pendingTurn.error}</div>
        )}
        <div className="ai-msg__time">{formatTime(pendingTurn.startedAtUtc)}</div>
      </div>
    </div>
  );
}

export function AssistantTranscript({ messages, pendingTurn, loading }: AssistantTranscriptProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pendingTurn?.responseText, pendingTurn?.thoughtText, loading]);

  return (
    <div className="ai-transcript" role="log" aria-label="Assistant conversation">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {pendingTurn && <PendingAssistantBubble pendingTurn={pendingTurn} />}
      {loading && !pendingTurn && (
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
