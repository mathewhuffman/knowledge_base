import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useRef, useState } from 'react';
import { IconZap, IconX } from '../icons';
const DRAG_THRESHOLD_PX = 4;
export function AssistantLauncher({ open, loading, hasUnread, onToggle, positionStyle, position, onPositionChange }) {
    const [dragging, setDragging] = useState(false);
    const suppressClickRef = useRef(false);
    const dragStateRef = useRef(null);
    const handlePointerDown = useCallback((event) => {
        if (event.pointerType === 'mouse' && event.button !== 0)
            return;
        suppressClickRef.current = false;
        dragStateRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - event.currentTarget.getBoundingClientRect().left,
            offsetY: event.clientY - event.currentTarget.getBoundingClientRect().top,
            moved: false
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }, []);
    const handlePointerMove = useCallback((event) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId || !onPositionChange)
            return;
        const nextLeft = event.clientX - dragState.offsetX;
        const nextTop = event.clientY - dragState.offsetY;
        if (!dragState.moved) {
            const deltaX = Math.abs(nextLeft - (position?.left ?? nextLeft));
            const deltaY = Math.abs(nextTop - (position?.top ?? nextTop));
            if (deltaX >= DRAG_THRESHOLD_PX || deltaY >= DRAG_THRESHOLD_PX) {
                dragState.moved = true;
                suppressClickRef.current = true;
                setDragging(true);
            }
        }
        if (dragState.moved) {
            onPositionChange({ left: nextLeft, top: nextTop });
        }
    }, [onPositionChange, position?.left, position?.top]);
    const endDrag = useCallback((pointerId) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== pointerId)
            return;
        dragStateRef.current = null;
        if (dragState.moved) {
            setDragging(false);
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 0);
        }
    }, []);
    const handlePointerUp = useCallback((event) => {
        endDrag(event.pointerId);
    }, [endDrag]);
    const handlePointerCancel = useCallback((event) => {
        endDrag(event.pointerId);
    }, [endDrag]);
    const handleClick = useCallback(() => {
        if (suppressClickRef.current)
            return;
        onToggle();
    }, [onToggle]);
    return (_jsxs("button", { type: "button", className: [
            'ai-launcher',
            open && 'ai-launcher--open',
            loading && 'ai-launcher--busy',
            dragging && 'ai-launcher--dragging',
            hasUnread && !open && 'ai-launcher--unread'
        ]
            .filter(Boolean)
            .join(' '), onClick: handleClick, onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, onPointerCancel: handlePointerCancel, title: open ? 'Close AI assistant' : 'Open AI assistant', "aria-label": open ? 'Close AI assistant' : 'Open AI assistant', "aria-expanded": open, style: positionStyle, children: [loading && _jsx("span", { className: "ai-launcher__pulse", "aria-hidden": "true" }), hasUnread && !open && _jsx("span", { className: "ai-launcher__badge", "aria-label": "New assistant response" }), _jsx("span", { className: "ai-launcher__icon", children: open ? _jsx(IconX, { size: 18 }) : _jsx(IconZap, { size: 18 }) })] }));
}
