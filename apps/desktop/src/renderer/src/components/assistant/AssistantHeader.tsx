import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AiViewContext, AiSessionRecord, AiArtifactRecord } from '@kb-vault/shared-types';
import { AppRoute } from '@kb-vault/shared-types';
import { IconGlobe, IconFileText, IconGitBranch, IconEye, IconTool, IconClock, IconPlus, IconX } from '../icons';

const DRAG_THRESHOLD_PX = 4;

const ROUTE_ICONS: Partial<Record<AppRoute, React.ReactNode>> = {
  [AppRoute.ARTICLE_EXPLORER]: <IconFileText size={14} />,
  [AppRoute.DRAFTS]: <IconGitBranch size={14} />,
  [AppRoute.PROPOSAL_REVIEW]: <IconEye size={14} />,
  [AppRoute.TEMPLATES_AND_PROMPTS]: <IconTool size={14} />,
};

function capabilityTags(ctx: AiViewContext): string[] {
  const tags: string[] = [];
  if (ctx.capabilities.canCreateProposal) tags.push('Can propose');
  if (ctx.capabilities.canPatchDraft) tags.push('Can edit draft');
  if (ctx.capabilities.canPatchProposal) tags.push('Can refine');
  if (ctx.capabilities.canPatchTemplate) tags.push('Can edit template');
  return tags;
}

function statusLabel(session: AiSessionRecord | null, artifact: AiArtifactRecord | null): string | null {
  if (artifact?.status === 'pending') return 'Pending review';
  if (session?.status === 'running') return 'Generating...';
  if (session?.status === 'error') return 'Error';
  return null;
}

interface AssistantHeaderProps {
  context: AiViewContext | null;
  session: AiSessionRecord | null;
  artifact: AiArtifactRecord | null;
  loading: boolean;
  historyOpen: boolean;
  sessionCount: number;
  onCreateSession: () => void;
  onToggleHistory: () => void;
  onClose: () => void;
  launcherPosition: { left: number; top: number };
  onLauncherPositionChange: (position: { left: number; top: number }) => void;
}

export function AssistantHeader({
  context,
  session,
  artifact,
  loading,
  historyOpen,
  sessionCount,
  onCreateSession,
  onToggleHistory,
  onClose,
  launcherPosition,
  onLauncherPositionChange
}: AssistantHeaderProps) {
  const routeIcon = context ? ROUTE_ICONS[context.route] ?? <IconGlobe size={14} /> : <IconGlobe size={14} />;
  const status = statusLabel(session, artifact);
  const caps = context ? capabilityTags(context) : [];
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    moved: boolean;
  } | null>(null);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return;
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

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

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

  const endDrag = useCallback((pointerId: number) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== pointerId) return;
    dragStateRef.current = null;
    if (dragState.moved) {
      setDragging(false);
    }
  }, []);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    endDrag(event.pointerId);
  }, [endDrag]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    endDrag(event.pointerId);
  }, [endDrag]);

  return (
    <div
      className={`ai-header${dragging ? ' ai-header--dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className="ai-header__top">
        <div className="ai-header__actions">
          <button
            type="button"
            className={`ai-header__history${historyOpen ? ' active' : ''}`}
            onClick={onToggleHistory}
            disabled={loading}
            title={historyOpen ? 'Close chat history' : 'Open chat history'}
            aria-label={historyOpen ? 'Close chat history' : 'Open chat history'}
          >
            <IconClock size={12} />
            <span>{sessionCount}</span>
          </button>
          <button
            type="button"
            className="ai-header__new"
            onClick={onCreateSession}
            disabled={loading}
            title="Start a new chat"
            aria-label="Start a new chat"
          >
            <IconPlus size={12} />
          </button>
        </div>
        <div className="ai-header__context">
          <span className="ai-header__route-badge">
            {routeIcon}
            <span>{context?.routeLabel ?? 'No context'}</span>
          </span>
          <button
            type="button"
            className="ai-header__close"
            onClick={onClose}
            title="Close AI assistant"
            aria-label="Close AI assistant"
          >
            <IconX size={12} />
          </button>
        </div>
      </div>

      {(session?.title || context?.subject?.title) && (
        <div className="ai-header__subject" title={session?.title || context?.subject?.title || undefined}>
          {session?.title || context?.subject?.title}
        </div>
      )}
      <div className="ai-header__meta">
        {caps.map((tag) => (
          <span key={tag} className="ai-header__cap-tag">{tag}</span>
        ))}
        {status && (
          <span className={`ai-header__status ai-header__status--${artifact?.status === 'pending' ? 'pending' : session?.status ?? 'idle'}`}>
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
