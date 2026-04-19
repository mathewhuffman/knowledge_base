import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useRef, useState } from 'react';
import { IconZap, IconX } from '../icons';
const DRAG_THRESHOLD_PX = 8;
export function AssistantLauncher({ open, loading, hasUnread, onToggle, positionStyle, position, onPositionChange, onWindowDrag, onWindowDragEnd }) {
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
            startScreenX: event.screenX,
            startScreenY: event.screenY,
            windowStartX: window.screenX,
            windowStartY: window.screenY,
            moved: false
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }, []);
    const handlePointerMove = useCallback((event) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId)
            return;
        const nextLeft = event.clientX - dragState.offsetX;
        const nextTop = event.clientY - dragState.offsetY;
        const nextWindowX = dragState.windowStartX + (event.screenX - dragState.startScreenX);
        const nextWindowY = dragState.windowStartY + (event.screenY - dragState.startScreenY);
        if (!dragState.moved) {
            const deltaX = onPositionChange
                ? Math.abs(nextLeft - (position?.left ?? nextLeft))
                : Math.abs(event.screenX - dragState.startScreenX);
            const deltaY = onPositionChange
                ? Math.abs(nextTop - (position?.top ?? nextTop))
                : Math.abs(event.screenY - dragState.startScreenY);
            if (deltaX >= DRAG_THRESHOLD_PX || deltaY >= DRAG_THRESHOLD_PX) {
                dragState.moved = true;
                suppressClickRef.current = true;
                setDragging(true);
            }
        }
        if (dragState.moved) {
            if (onPositionChange) {
                onPositionChange({ left: nextLeft, top: nextTop });
            }
            else if (onWindowDrag) {
                onWindowDrag({ x: nextWindowX, y: nextWindowY });
            }
        }
    }, [onPositionChange, onWindowDrag, position?.left, position?.top]);
    const endDrag = useCallback((pointerId) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== pointerId)
            return;
        dragStateRef.current = null;
        if (dragState.moved && !onPositionChange && onWindowDragEnd) {
            onWindowDragEnd();
        }
        if (dragState.moved) {
            setDragging(false);
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 0);
        }
    }, [onPositionChange, onWindowDragEnd]);
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
