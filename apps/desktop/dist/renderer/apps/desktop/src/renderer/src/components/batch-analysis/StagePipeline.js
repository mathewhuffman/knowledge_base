import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef } from 'react';
import { getVisibleStage, getVisibleStageLabel, PIPELINE_STAGES, TERMINAL_STAGES, STAGE_LABELS, } from './helpers';
function resolveNodeState(stage, currentStage, completedStages, skippedStages, failedStage) {
    if (failedStage === stage)
        return 'failed';
    if (stage === currentStage)
        return 'active';
    if (skippedStages.has(stage))
        return 'skipped';
    if (completedStages.has(stage))
        return 'done';
    if (stage === 'queued' && currentStage && currentStage !== 'queued')
        return 'done';
    return 'pending';
}
export function StagePipeline({ currentStage, iteration, completedStages, skippedStages, failedStage, isRunning, }) {
    const containerRef = useRef(null);
    const stepRefs = useRef(new Map());
    const visibleCurrentStage = getVisibleStage(currentStage);
    const visibleFailedStage = getVisibleStage(failedStage);
    const isTerminal = currentStage && TERMINAL_STAGES.has(currentStage);
    const scrollTargetStage = useMemo(() => (isTerminal ? currentStage : visibleCurrentStage), [currentStage, isTerminal, visibleCurrentStage]);
    useEffect(() => {
        const container = containerRef.current;
        const targetStage = scrollTargetStage;
        if (!container || !targetStage)
            return;
        const targetNode = stepRefs.current.get(targetStage);
        if (!targetNode)
            return;
        const nextLeft = Math.max(0, targetNode.offsetLeft - (container.clientWidth / 2) + (targetNode.clientWidth / 2));
        container.scrollTo({
            left: nextLeft,
            behavior: 'smooth',
        });
    }, [scrollTargetStage]);
    const setStepRef = (stage) => (node) => {
        if (node) {
            stepRefs.current.set(stage, node);
            return;
        }
        stepRefs.current.delete(stage);
    };
    return (_jsxs("div", { ref: containerRef, className: "ba-pipeline", role: "group", "aria-label": "Batch analysis stage pipeline", children: [PIPELINE_STAGES.map((stage, idx) => {
                const state = resolveNodeState(stage, visibleCurrentStage, completedStages, skippedStages, visibleFailedStage);
                const isLast = idx === PIPELINE_STAGES.length - 1;
                const showIter = state === 'active' && iteration != null && iteration > 1;
                const showSkipped = state === 'skipped';
                const queuedEmphasis = stage === 'queued' && state !== 'pending';
                const pulseClass = state === 'active' && isRunning
                    ? queuedEmphasis
                        ? ' ba-pipeline-circle--pulse-success'
                        : ' ba-pipeline-circle--pulse'
                    : '';
                return (_jsxs("div", { ref: setStepRef(stage), className: "ba-pipeline-step", children: [_jsxs("div", { className: `ba-pipeline-node ba-pipeline-node--${state}${queuedEmphasis ? ' ba-pipeline-node--queued-emphasis' : ''}`, children: [_jsx("div", { className: `ba-pipeline-circle${pulseClass}`, "aria-current": state === 'active' ? 'step' : undefined }), showIter && (_jsxs("span", { className: "ba-pipeline-iter-badge", children: ["Iter ", iteration] }))] }), _jsx("span", { className: `ba-pipeline-label${showSkipped ? ' ba-pipeline-label--skipped' : ''}`, children: getVisibleStageLabel(stage) }), showSkipped && (_jsx("span", { className: "ba-pipeline-status", children: "Skipped" })), !isLast && (_jsx("div", { className: `ba-pipeline-connector ba-pipeline-connector--${state === 'done' ? 'done' : 'pending'}` }))] }, stage));
            }), isTerminal && currentStage && (_jsxs("div", { ref: setStepRef(currentStage), className: "ba-pipeline-step", children: [_jsx("div", { className: `ba-pipeline-node ba-pipeline-node--terminal ba-pipeline-node--${currentStage === 'approved' ? 'done' : currentStage === 'failed' || currentStage === 'canceled' ? 'failed' : 'active'}`, children: _jsx("div", { className: "ba-pipeline-circle ba-pipeline-circle--terminal" }) }), _jsx("span", { className: "ba-pipeline-label ba-pipeline-label--terminal", children: STAGE_LABELS[currentStage] })] }))] }));
}
