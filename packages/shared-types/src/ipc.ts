import { AppError, AppErrorCode } from './errors';

export const IPC_CHANNELS = {
  INVOKE: 'kbv:invoke',
  JOB_INVOKE: 'kbv:job:invoke',
  JOB_CANCEL: 'kbv:job:cancel',
  JOB_EVENT: 'kbv:job:event'
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
