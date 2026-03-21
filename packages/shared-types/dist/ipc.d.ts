import { AppError, AppErrorCode } from './errors';
export declare const IPC_CHANNELS: {
    INVOKE: string;
    JOB_INVOKE: string;
    JOB_EVENT: string;
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
export declare enum JobState {
    QUEUED = "QUEUED",
    RUNNING = "RUNNING",
    SUCCEEDED = "SUCCEEDED",
    FAILED = "FAILED",
    CANCELED = "CANCELED",
    PAUSED = "PAUSED"
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
}
export interface JobEvent extends JobStatus, JobRecord {
}
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
export declare const createErrorResult: (code: AppErrorCode, message: string, requestId?: string) => RpcResponse;
