import { useCallback, useEffect, useRef } from 'react';

const STORAGE_KEY = 'kb-textarea-heights';

function loadHeights(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveHeight(id: string, height: number): void {
  try {
    const existing = loadHeights();
    existing[id] = height;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // localStorage unavailable – silently ignore
  }
}

/**
 * Returns a callback ref + drag-handle event handlers for a custom
 * full-width bottom-edge resize handle.
 *
 * The textarea must NOT use native `resize` (set `resize: none` in CSS).
 * Instead, a sibling drag-handle div is rendered below the textarea and
 * this hook manages pointer-drag → height changes → localStorage persistence.
 *
 * @param id  Stable unique key for localStorage.
 * @param fallbackHeight  Default height (px) when nothing is persisted.
 */
export function usePersistedResize(id: string, fallbackHeight = 120) {
  const elRef = useRef<HTMLTextAreaElement | null>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHRef = useRef(0);

  // Restore height on mount / node change
  const textareaRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      elRef.current = node;
      if (!node) return;
      const saved = loadHeights()[id];
      node.style.height = `${saved ?? fallbackHeight}px`;
    },
    [id, fallbackHeight]
  );

  // Pointer handlers for the drag handle
  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = elRef.current;
      if (!el) return;
      draggingRef.current = true;
      startYRef.current = e.clientY;
      startHRef.current = el.offsetHeight;
      (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const el = elRef.current;
      if (!el) return;
      const delta = e.clientY - startYRef.current;
      const newH = Math.max(60, Math.min(600, startHRef.current + delta));
      el.style.height = `${newH}px`;
    },
    []
  );

  const onHandlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
      const el = elRef.current;
      if (el) {
        saveHeight(id, el.offsetHeight);
      }
    },
    [id]
  );

  // Cleanup (nothing async to clean, but keeps the API consistent)
  useEffect(() => {
    return () => {
      draggingRef.current = false;
    };
  }, []);

  return {
    textareaRef,
    handleProps: {
      onPointerDown: onHandlePointerDown,
      onPointerMove: onHandlePointerMove,
      onPointerUp: onHandlePointerUp,
    },
  };
}
