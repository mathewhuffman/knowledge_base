import {
  JobEvent,
  type AiAssistantStreamEvent,
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
  emitAiAssistantEvents: (handler: (event: AiAssistantStreamEvent) => void) => () => void;
}

declare global {
  interface Window {
    kbv: KbvApi;
  }
}

export {};
