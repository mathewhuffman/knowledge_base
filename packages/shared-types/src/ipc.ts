import { AppError, AppErrorCode } from './errors';

export const IPC_CHANNELS = {
  INVOKE: 'kbv:invoke',
  JOB_INVOKE: 'kbv:job:invoke',
  JOB_CANCEL: 'kbv:job:cancel',
  JOB_EVENT: 'kbv:job:event',
  APP_WORKING_STATE_EVENT: 'kbv:app-working-state:event',
  AI_ASSISTANT_EVENT: 'kbv:ai-assistant:event',
  AI_ASSISTANT_PRESENTATION_EVENT: 'kbv:ai-assistant:presentation:event',
  AI_ASSISTANT_CONTEXT_EVENT: 'kbv:ai-assistant:context:event',
  AI_ASSISTANT_WINDOW_MOVE: 'kbv:ai-assistant:window:move',
  AI_ASSISTANT_WINDOW_RESIZE: 'kbv:ai-assistant:window:resize',
  AI_ASSISTANT_WINDOW_DRAG_END: 'kbv:ai-assistant:window:drag-end',
  APP_NAVIGATION_EVENT: 'kbv:app:navigation:event'
};

export interface RpcRequest {
  method: string;
  payload?: unknown;
  requestId?: string;
}

export interface RpcResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: AppError;
  requestId?: string;
  timestamp?: string;
}

export enum JobState {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
  PAUSED = 'PAUSED'
}

export interface JobRecord {
  id: string;
}

export interface JobStatus {
  id: string;
  command: string;
  state: JobState;
  progress: number;
  message?: string;
  startedAt?: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface JobEvent extends JobStatus, JobRecord {}
export type JobInput = Record<string, unknown>;
export interface JobRunContext {
  jobId: string;
  command: string;
  input: JobInput;
}
export interface JobPayload {
  jobId: string;
  state: JobState;
}

export interface JobCancelPayload {
  jobId: string;
}

export const createErrorResult = (code: AppErrorCode, message: string, requestId?: string): RpcResponse => ({
  ok: false,
  error: { code, message },
  requestId,
  timestamp: new Date().toISOString()
});
