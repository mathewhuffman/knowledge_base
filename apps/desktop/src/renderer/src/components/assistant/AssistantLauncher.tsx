import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { IconZap, IconX } from '../icons';

const DRAG_THRESHOLD_PX = 8;

interface AssistantLauncherProps {
  open: boolean;
  loading: boolean;
  hasUnread: boolean;
  onToggle: () => void;
  positionStyle?: CSSProperties;
  position?: { left: number; top: number };
  onPositionChange?: (position: { left: number; top: number }) => void;
  onWindowDrag?: (position: { x: number; y: number }) => void;
  onWindowDragEnd?: () => void;
}

export function AssistantLauncher({
  open,
  loading,
  hasUnread,
  onToggle,
  positionStyle,
  position,
  onPositionChange,
  onWindowDrag,
  onWindowDragEnd
}: AssistantLauncherProps) {
  const [dragging, setDragging] = useState(false);
  const suppressClickRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startScreenX: number;
      startScreenY: number;
      windowStartX: number;
      windowStartY: number;
      moved: boolean;
  } | null>(null);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
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

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

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
      } else if (onWindowDrag) {
        onWindowDrag({ x: nextWindowX, y: nextWindowY });
      }
    }
  }, [onPositionChange, onWindowDrag, position?.left, position?.top]);

  const endDrag = useCallback((pointerId: number) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== pointerId) return;
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

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    endDrag(event.pointerId);
  }, [endDrag]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    endDrag(event.pointerId);
  }, [endDrag]);

  const handleClick = useCallback(() => {
    if (suppressClickRef.current) return;
    onToggle();
  }, [onToggle]);

  return (
    <button
      type="button"
      className={[
        'ai-launcher',
        open && 'ai-launcher--open',
        loading && 'ai-launcher--busy',
        dragging && 'ai-launcher--dragging',
        hasUnread && !open && 'ai-launcher--unread'
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      title={open ? 'Close AI assistant' : 'Open AI assistant'}
      aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
      aria-expanded={open}
      style={positionStyle}
    >
      {loading && <span className="ai-launcher__pulse" aria-hidden="true" />}
      {hasUnread && !open && <span className="ai-launcher__badge" aria-label="New assistant response" />}
      <span className="ai-launcher__icon">
        {open ? <IconX size={18} /> : <IconZap size={18} />}
      </span>
    </button>
  );
}
