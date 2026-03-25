import { useEffect, useMemo, useRef } from 'react';
import type { BatchAnalysisStageStatus } from '@kb-vault/shared-types';
import {
  getVisibleStage,
  getVisibleStageLabel,
  PIPELINE_STAGES,
  TERMINAL_STAGES,
  STAGE_LABELS,
  type PipelineNodeState,
} from './helpers';

interface StagePipelineProps {
  currentStage: BatchAnalysisStageStatus | undefined;
  iteration: number | undefined;
  completedStages: Set<BatchAnalysisStageStatus>;
  failedStage?: BatchAnalysisStageStatus;
  isRunning: boolean;
}

function resolveNodeState(
  stage: BatchAnalysisStageStatus,
  currentStage: BatchAnalysisStageStatus | undefined,
  completedStages: Set<BatchAnalysisStageStatus>,
  failedStage: BatchAnalysisStageStatus | undefined,
): PipelineNodeState {
  if (failedStage === stage) return 'failed';
  if (completedStages.has(stage)) return 'done';
  if (stage === 'queued' && currentStage && currentStage !== 'queued') return 'done';
  if (stage === currentStage) return 'active';
  return 'pending';
}

export function StagePipeline({
  currentStage,
  iteration,
  completedStages,
  failedStage,
  isRunning,
}: StagePipelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stepRefs = useRef(new Map<BatchAnalysisStageStatus, HTMLDivElement>());
  const visibleCurrentStage = getVisibleStage(currentStage);
  const visibleFailedStage = getVisibleStage(failedStage);
  const isTerminal = currentStage && TERMINAL_STAGES.has(currentStage);
  const scrollTargetStage = useMemo(
    () => (isTerminal ? currentStage : visibleCurrentStage),
    [currentStage, isTerminal, visibleCurrentStage],
  );

  useEffect(() => {
    const container = containerRef.current;
    const targetStage = scrollTargetStage;
    if (!container || !targetStage) return;

    const targetNode = stepRefs.current.get(targetStage);
    if (!targetNode) return;

    const nextLeft = Math.max(
      0,
      targetNode.offsetLeft - (container.clientWidth / 2) + (targetNode.clientWidth / 2),
    );

    container.scrollTo({
      left: nextLeft,
      behavior: 'smooth',
    });
  }, [scrollTargetStage]);

  const setStepRef = (stage: BatchAnalysisStageStatus) => (node: HTMLDivElement | null) => {
    if (node) {
      stepRefs.current.set(stage, node);
      return;
    }
    stepRefs.current.delete(stage);
  };

  return (
    <div ref={containerRef} className="ba-pipeline" role="group" aria-label="Batch analysis stage pipeline">
      {PIPELINE_STAGES.map((stage, idx) => {
        const state = resolveNodeState(stage, visibleCurrentStage, completedStages, visibleFailedStage);
        const isLast = idx === PIPELINE_STAGES.length - 1;
        const showIter = state === 'active' && iteration != null && iteration > 1;
        const queuedEmphasis = stage === 'queued' && state !== 'pending';
        const pulseClass = state === 'active' && isRunning
          ? queuedEmphasis
            ? ' ba-pipeline-circle--pulse-success'
            : ' ba-pipeline-circle--pulse'
          : '';

        return (
          <div key={stage} ref={setStepRef(stage)} className="ba-pipeline-step">
            <div className={`ba-pipeline-node ba-pipeline-node--${state}${queuedEmphasis ? ' ba-pipeline-node--queued-emphasis' : ''}`}>
              <div
                className={`ba-pipeline-circle${pulseClass}`}
                aria-current={state === 'active' ? 'step' : undefined}
              />
              {showIter && (
                <span className="ba-pipeline-iter-badge">Iter {iteration}</span>
              )}
            </div>
            <span className="ba-pipeline-label">{getVisibleStageLabel(stage)}</span>
            {!isLast && (
              <div className={`ba-pipeline-connector ba-pipeline-connector--${state === 'done' ? 'done' : 'pending'}`} />
            )}
          </div>
        );
      })}

      {/* Terminal state node */}
      {isTerminal && currentStage && (
        <div ref={setStepRef(currentStage)} className="ba-pipeline-step">
          <div className={`ba-pipeline-node ba-pipeline-node--terminal ba-pipeline-node--${currentStage === 'approved' ? 'done' : currentStage === 'failed' || currentStage === 'canceled' ? 'failed' : 'active'}`}>
            <div className="ba-pipeline-circle ba-pipeline-circle--terminal" />
          </div>
          <span className="ba-pipeline-label ba-pipeline-label--terminal">
            {STAGE_LABELS[currentStage]}
          </span>
        </div>
      )}
    </div>
  );
}
