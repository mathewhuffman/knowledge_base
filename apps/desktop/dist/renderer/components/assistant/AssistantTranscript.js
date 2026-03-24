import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
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
function MessageBubble({ message }) {
    const isUser = message.role === 'user';
    const isWarning = message.messageKind === 'warning';
    const isDecision = message.messageKind === 'decision';
    return (_jsxs("div", { className: [
            'ai-msg',
            `ai-msg--${message.role}`,
            isWarning && 'ai-msg--warning',
            isDecision && 'ai-msg--decision'
        ]
            .filter(Boolean)
            .join(' '), children: [!isUser && (_jsx("div", { className: "ai-msg__avatar", children: _jsx(IconZap, { size: 12 }) })), _jsxs("div", { className: "ai-msg__body", children: [isUser ? (_jsx("div", { className: "ai-msg__content", children: message.content })) : (_jsx("div", { className: "ai-msg__content ai-msg__content--rich", dangerouslySetInnerHTML: { __html: formatAssistantHtml(message.content) } })), _jsx("div", { className: "ai-msg__time", children: formatTime(message.createdAtUtc) })] })] }));
}
export function AssistantTranscript({ messages, loading }) {
    const endRef = useRef(null);
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, loading]);
    return (_jsxs("div", { className: "ai-transcript", role: "log", "aria-label": "Assistant conversation", children: [messages.map((msg) => (_jsx(MessageBubble, { message: msg }, msg.id))), loading && (_jsxs("div", { className: "ai-msg ai-msg--assistant ai-msg--typing", children: [_jsx("div", { className: "ai-msg__avatar", children: _jsx(IconZap, { size: 12 }) }), _jsx("div", { className: "ai-msg__body", children: _jsxs("div", { className: "ai-typing", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }) })] })), _jsx("div", { ref: endRef })] }));
}
