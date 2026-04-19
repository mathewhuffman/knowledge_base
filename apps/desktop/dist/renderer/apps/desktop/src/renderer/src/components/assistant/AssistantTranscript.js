import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { extractStreamedAssistantEnvelope } from './assistant-streaming';
import { IconZap } from '../icons';
function formatTime(utc) {
    try {
        return new Date(utc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    catch {
        return '';
    }
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function formatAssistantHtml(content) {
    const trimmed = content.trim();
    if (!trimmed)
        return '';
    const looksLikeHtml = /<[a-z][\s\S]*>/i.test(trimmed);
    if (looksLikeHtml) {
        return trimmed;
    }
    return escapeHtml(content).replace(/\n/g, '<br />');
}
function extractAuditMetadata(message) {
    const metadata = message.metadata;
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }
    const thoughtText = typeof metadata.thoughtText === 'string' ? metadata.thoughtText : undefined;
    const completionState = typeof metadata.completionState === 'string'
        ? metadata.completionState
        : undefined;
    const isFinal = typeof metadata.isFinal === 'boolean' ? metadata.isFinal : undefined;
    const toolEvents = Array.isArray(metadata.toolEvents)
        ? metadata.toolEvents.filter((entry) => Boolean(entry) && typeof entry === 'object')
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
function formatToolStatus(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return value;
    }
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
function formatThoughtResourceLabel(value) {
    return value.replace(/^(resourceName|name|title|articleTitle|targetTitle):\s*/i, '').trim();
}
function formatThoughtToolLine(tool) {
    const toolName = tool.toolName ?? 'Unknown tool';
    const resourceLabel = tool.resourceLabel ? formatThoughtResourceLabel(tool.resourceLabel) : '';
    const status = tool.toolStatus ? formatToolStatus(tool.toolStatus) : '';
    const resourcePart = resourceLabel ? `; ${resourceLabel}` : '';
    const statusPart = status ? ` - ${status}` : '';
    return `Tool: ${toolName}${resourcePart}${statusPart}`;
}
function formatCompletionLine(completionState, isFinal) {
    if (!completionState && isFinal === undefined) {
        return null;
    }
    const stateLabel = completionState
        ? completionState.replace(/_/g, ' ')
        : 'unknown';
    const finalLabel = isFinal === undefined ? '' : `; final=${isFinal ? 'true' : 'false'}`;
    return `State: ${stateLabel}${finalLabel}`;
}
function ThoughtsBlock({ thoughtText, toolEvents, completionState, isFinal, open = false }) {
    const hasThoughts = Boolean(thoughtText?.trim())
        || Boolean(toolEvents?.length)
        || completionState !== undefined
        || isFinal !== undefined;
    if (!hasThoughts) {
        return null;
    }
    const completionLine = formatCompletionLine(completionState, isFinal);
    return (_jsxs("details", { className: "ai-msg__thoughts", open: open, children: [_jsx("summary", { children: "Thoughts" }), completionLine ? (_jsx("div", { className: "ai-msg__thoughts-text", children: completionLine })) : null, thoughtText?.trim() ? (_jsx("div", { className: "ai-msg__thoughts-text", children: thoughtText })) : null, toolEvents && toolEvents.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "ai-msg__thoughts-section-title", children: "Tools" }), _jsx("div", { className: "ai-msg__thoughts-tools", children: toolEvents.map((tool, index) => (_jsx("div", { className: "ai-msg__thoughts-tool", children: formatThoughtToolLine(tool) }, `${tool.toolCallId ?? 'tool'}:${index}`))) })] })) : null] }));
}
function MessageBubble({ message }) {
    const isUser = message.role === 'user';
    const isWarning = message.messageKind === 'warning';
    const isDecision = message.messageKind === 'decision';
    const audit = extractAuditMetadata(message);
    return (_jsxs("div", { className: [
            'ai-msg',
            `ai-msg--${message.role}`,
            isWarning && 'ai-msg--warning',
            isDecision && 'ai-msg--decision'
        ]
            .filter(Boolean)
            .join(' '), children: [!isUser && (_jsx("div", { className: "ai-msg__avatar", children: _jsx(IconZap, { size: 12 }) })), _jsxs("div", { className: "ai-msg__body", children: [isUser ? (_jsx("div", { className: "ai-msg__content", children: message.content })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "ai-msg__content ai-msg__content--rich", dangerouslySetInnerHTML: { __html: formatAssistantHtml(message.content) } }), _jsx(ThoughtsBlock, { thoughtText: audit?.thoughtText, toolEvents: audit?.toolEvents, completionState: audit?.completionState, isFinal: audit?.isFinal })] })), _jsx("div", { className: "ai-msg__time", children: formatTime(message.createdAtUtc) })] })] }));
}
function PendingAssistantBubble({ pendingTurn, processingCommand }) {
    const hasThoughts = pendingTurn.thoughtText.trim().length > 0 || pendingTurn.toolEvents.length > 0;
    const streamedEnvelope = extractStreamedAssistantEnvelope(pendingTurn.rawResponseText);
    const displayResponse = streamedEnvelope.responseText || pendingTurn.responseText;
    const showProcessingIndicator = processingCommand && pendingTurn.hasRenderableFinalResponse && displayResponse.trim().length > 0;
    return (_jsxs("div", { className: "ai-msg ai-msg--assistant ai-msg--streaming", children: [_jsx("div", { className: "ai-msg__avatar", children: _jsx(IconZap, { size: 12 }) }), _jsxs("div", { className: "ai-msg__body", children: [_jsx("div", { className: "ai-msg__content ai-msg__content--rich", children: displayResponse ? (_jsx("div", { dangerouslySetInnerHTML: { __html: formatAssistantHtml(displayResponse) } })) : (_jsxs("div", { className: "ai-typing", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] })) }), showProcessingIndicator && (_jsx("div", { className: "ai-msg__processing", "aria-label": "Processing assistant action", role: "status", children: _jsxs("div", { className: "ai-typing ai-typing--compact", "aria-hidden": "true", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }) })), hasThoughts ? (_jsx(ThoughtsBlock, { thoughtText: pendingTurn.thoughtText, toolEvents: pendingTurn.toolEvents, completionState: streamedEnvelope.completionState, isFinal: streamedEnvelope.isFinal, open: pendingTurn.toolEvents.length > 0 })) : null, pendingTurn.error && (_jsx("div", { className: "ai-msg__stream-error", children: pendingTurn.error })), _jsx("div", { className: "ai-msg__time", children: formatTime(pendingTurn.startedAtUtc) })] })] }));
}
export function AssistantTranscript({ messages, pendingTurn, loading }) {
    const endRef = useRef(null);
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, pendingTurn?.responseText, pendingTurn?.thoughtText, loading]);
    return (_jsxs("div", { className: "ai-transcript", role: "log", "aria-label": "Assistant conversation", children: [messages.map((msg) => (_jsx(MessageBubble, { message: msg }, msg.id))), pendingTurn && _jsx(PendingAssistantBubble, { pendingTurn: pendingTurn, processingCommand: loading }), loading && !pendingTurn && (_jsxs("div", { className: "ai-msg ai-msg--assistant ai-msg--typing", children: [_jsx("div", { className: "ai-msg__avatar", children: _jsx(IconZap, { size: 12 }) }), _jsx("div", { className: "ai-msg__body", children: _jsxs("div", { className: "ai-typing", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }) })] })), _jsx("div", { ref: endRef })] }));
}
