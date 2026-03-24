import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useMemo } from 'react';
import { IconClock, IconPlus, IconX, IconSearch, IconMessageSquare } from '../icons';
function formatSessionTime(value) {
    if (!value)
        return 'No messages yet';
    try {
        return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    catch {
        return value;
    }
}
function dateGroupLabel(value) {
    if (!value)
        return 'Unknown';
    try {
        const d = new Date(value);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays === 0)
            return 'Today';
        if (diffDays === 1)
            return 'Yesterday';
        if (diffDays < 7)
            return 'This week';
        if (diffDays < 30)
            return 'This month';
        return d.toLocaleString([], { month: 'long', year: 'numeric' });
    }
    catch {
        return 'Unknown';
    }
}
function groupByDate(sessions) {
    const groups = new Map();
    for (const s of sessions) {
        const label = dateGroupLabel(s.lastMessageAtUtc ?? s.createdAtUtc);
        const list = groups.get(label) ?? [];
        list.push(s);
        groups.set(label, list);
    }
    return Array.from(groups, ([label, items]) => ({ label, sessions: items }));
}
export function AssistantHistoryList({ sessions, activeSessionId, loading, onOpen, onDelete, onNewChat, onClose }) {
    const [search, setSearch] = useState('');
    const filtered = useMemo(() => {
        if (!search.trim())
            return sessions;
        const q = search.toLowerCase();
        return sessions.filter((s) => (s.title && s.title.toLowerCase().includes(q)) ||
            (s.entityTitle && s.entityTitle.toLowerCase().includes(q)));
    }, [sessions, search]);
    const groups = useMemo(() => groupByDate(filtered), [filtered]);
    return (_jsxs("div", { className: "ai-history", "aria-label": "Chat history", children: [_jsxs("div", { className: "ai-history__header", children: [_jsx("span", { className: "ai-history__heading", children: "Chat History" }), _jsx("button", { type: "button", className: "ai-history__close", onClick: onClose, title: "Close history", "aria-label": "Close history", children: _jsx(IconX, { size: 14 }) })] }), _jsxs("div", { className: "ai-history__toolbar", children: [_jsxs("button", { type: "button", className: "ai-history__new-chat", onClick: onNewChat, disabled: loading, children: [_jsx(IconPlus, { size: 12 }), _jsx("span", { children: "New Chat" })] }), _jsxs("div", { className: "ai-history__search", children: [_jsx(IconSearch, { size: 12 }), _jsx("input", { type: "text", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search chats...", className: "ai-history__search-input", "aria-label": "Search chat history" })] })] }), _jsx("div", { className: "ai-history__list", children: groups.length === 0 ? (_jsxs("div", { className: "ai-history__empty", children: [_jsx(IconMessageSquare, { size: 20 }), _jsx("span", { children: search ? 'No matching chats.' : 'No saved chats yet.' })] })) : (groups.map((group) => (_jsxs("div", { className: "ai-history__group", children: [_jsx("div", { className: "ai-history__group-label", children: group.label }), group.sessions.map((session) => (_jsxs("div", { className: `ai-history__item${session.id === activeSessionId ? ' active' : ''}`, children: [_jsxs("button", { type: "button", className: "ai-history__item-main", onClick: () => onOpen(session.id), disabled: loading, children: [_jsxs("div", { className: "ai-history__item-top", children: [_jsx("span", { className: "ai-history__title", children: session.title || 'Untitled chat' }), session.id === activeSessionId && _jsx("span", { className: "ai-history__badge", children: "Current" })] }), _jsxs("div", { className: "ai-history__time", children: [_jsx(IconClock, { size: 11 }), _jsx("span", { children: formatSessionTime(session.lastMessageAtUtc ?? session.createdAtUtc) })] })] }), _jsx("button", { type: "button", className: "ai-history__delete", onClick: (event) => {
                                        event.stopPropagation();
                                        void onDelete(session.id);
                                    }, disabled: loading, title: "Delete conversation", "aria-label": "Delete conversation", children: _jsx(IconX, { size: 12 }) })] }, session.id)))] }, group.label)))) })] }));
}
