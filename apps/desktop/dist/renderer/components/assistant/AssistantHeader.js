import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useRef, useState } from 'react';
import { AppRoute } from '@kb-vault/shared-types';
import { IconGlobe, IconFileText, IconGitBranch, IconEye, IconTool, IconClock, IconPlus, IconX } from '../icons';
const DRAG_THRESHOLD_PX = 4;
const ROUTE_ICONS = {
    [AppRoute.ARTICLE_EXPLORER]: _jsx(IconFileText, { size: 14 }),
    [AppRoute.DRAFTS]: _jsx(IconGitBranch, { size: 14 }),
    [AppRoute.PROPOSAL_REVIEW]: _jsx(IconEye, { size: 14 }),
    [AppRoute.TEMPLATES_AND_PROMPTS]: _jsx(IconTool, { size: 14 }),
};
function capabilityTags(ctx) {
    const tags = [];
    if (ctx.capabilities.canCreateProposal)
        tags.push('Can propose');
    if (ctx.capabilities.canPatchDraft)
        tags.push('Can edit draft');
    if (ctx.capabilities.canPatchProposal)
        tags.push('Can refine');
    if (ctx.capabilities.canPatchTemplate)
        tags.push('Can edit template');
    return tags;
}
function statusLabel(session, artifact) {
    if (artifact?.status === 'pending')
        return 'Pending review';
    if (session?.status === 'running')
        return 'Generating...';
    if (session?.status === 'error')
        return 'Error';
    return null;
}
export function AssistantHeader({ context, session, artifact, loading, historyOpen, sessionCount, onCreateSession, onToggleHistory, onClose, launcherPosition, onLauncherPositionChange }) {
    const routeIcon = context ? ROUTE_ICONS[context.route] ?? _jsx(IconGlobe, { size: 14 }) : _jsx(IconGlobe, { size: 14 });
    const status = statusLabel(session, artifact);
    const caps = context ? capabilityTags(context) : [];
    const [dragging, setDragging] = useState(false);
    const dragStateRef = useRef(null);
    const handlePointerDown = useCallback((event) => {
        if (event.pointerType === 'mouse' && event.button !== 0)
            return;
        if (event.target.closest('button, a, input, textarea, select'))
            return;
        dragStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: launcherPosition.left,
            startTop: launcherPosition.top,
            moved: false
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }, [launcherPosition.left, launcherPosition.top]);
    const handlePointerMove = useCallback((event) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId)
            return;
        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;
        if (!dragState.moved && (Math.abs(deltaX) >= DRAG_THRESHOLD_PX || Math.abs(deltaY) >= DRAG_THRESHOLD_PX)) {
            dragState.moved = true;
            setDragging(true);
        }
        if (dragState.moved) {
            onLauncherPositionChange({
                left: dragState.startLeft + deltaX,
                top: dragState.startTop + deltaY
            });
        }
    }, [onLauncherPositionChange]);
    const endDrag = useCallback((pointerId) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== pointerId)
            return;
        dragStateRef.current = null;
        if (dragState.moved) {
            setDragging(false);
        }
    }, []);
    const handlePointerUp = useCallback((event) => {
        endDrag(event.pointerId);
    }, [endDrag]);
    const handlePointerCancel = useCallback((event) => {
        endDrag(event.pointerId);
    }, [endDrag]);
    return (_jsxs("div", { className: `ai-header${dragging ? ' ai-header--dragging' : ''}`, onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: handlePointerCancel, children: [_jsxs("div", { className: "ai-header__top", children: [_jsxs("div", { className: "ai-header__actions", children: [_jsxs("button", { type: "button", className: `ai-header__history${historyOpen ? ' active' : ''}`, onClick: onToggleHistory, disabled: loading, title: historyOpen ? 'Close chat history' : 'Open chat history', "aria-label": historyOpen ? 'Close chat history' : 'Open chat history', children: [_jsx(IconClock, { size: 12 }), _jsx("span", { children: sessionCount })] }), _jsx("button", { type: "button", className: "ai-header__new", onClick: onCreateSession, disabled: loading, title: "Start a new chat", "aria-label": "Start a new chat", children: _jsx(IconPlus, { size: 12 }) })] }), _jsxs("div", { className: "ai-header__context", children: [_jsxs("span", { className: "ai-header__route-badge", children: [routeIcon, _jsx("span", { children: context?.routeLabel ?? 'No context' })] }), _jsx("button", { type: "button", className: "ai-header__close", onClick: onClose, title: "Close AI assistant", "aria-label": "Close AI assistant", children: _jsx(IconX, { size: 12 }) })] })] }), (session?.title || context?.subject?.title) && (_jsx("div", { className: "ai-header__subject", title: session?.title || context?.subject?.title || undefined, children: session?.title || context?.subject?.title })), _jsxs("div", { className: "ai-header__meta", children: [caps.map((tag) => (_jsx("span", { className: "ai-header__cap-tag", children: tag }, tag))), status && (_jsx("span", { className: `ai-header__status ai-header__status--${artifact?.status === 'pending' ? 'pending' : session?.status ?? 'idle'}`, children: status }))] })] }));
}
