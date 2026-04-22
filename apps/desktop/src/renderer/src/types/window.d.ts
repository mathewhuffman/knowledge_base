import {
  type AppUpdateStateChangedEvent,
  type AiAssistantContextChangedEvent,
  type AiAssistantDetachedWindowMoveRequest,
  type AiAssistantDetachedWindowResizeRequest,
  type AiAssistantPresentationChangedEvent,
  JobEvent,
  type AiAssistantStreamEvent,
  type AppNavigationEvent,
  type AppWorkingStatePatchAppliedEvent,
  type RpcResponse,
  type JobPayload
} from '@kb-vault/shared-types';

export interface KbvApi {
  invoke: <T>(method: string, payload?: unknown) => Promise<RpcResponse<T>>;
  startJob: (command: string, input: unknown) => Promise<JobPayload>;
  cancelJob: (jobId: string) => Promise<JobPayload>;
  emitJobEvents: (handler: (event: JobEvent) => void) => () => void;
  emitAppWorkingStateEvents: (handler: (event: AppWorkingStatePatchAppliedEvent) => void) => () => void;
  emitAppUpdateEvents: (handler: (event: AppUpdateStateChangedEvent) => void) => () => void;
  emitAiAssistantEvents: (handler: (event: AiAssistantStreamEvent) => void) => () => void;
  emitAiAssistantPresentationEvents: (handler: (event: AiAssistantPresentationChangedEvent) => void) => () => void;
  emitAiAssistantContextEvents: (handler: (event: AiAssistantContextChangedEvent) => void) => () => void;
  emitAppNavigationEvents: (handler: (event: AppNavigationEvent) => void) => () => void;
  moveAssistantWindow: (payload: AiAssistantDetachedWindowMoveRequest) => void;
  resizeAssistantWindow: (payload: AiAssistantDetachedWindowResizeRequest) => void;
  finishAssistantWindowDrag: () => void;
}

declare global {
  interface Window {
    kbv: KbvApi;
  }
}

export {};
