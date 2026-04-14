import { contextBridge, ipcRenderer } from 'electron';
import type { AiAssistantStreamEvent } from '@kb-vault/shared-types';

interface RpcRequest {
  method: string;
  payload?: unknown;
  requestId?: string;
}

interface RpcResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  requestId?: string;
  timestamp?: string;
}

type JobState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'PAUSED';

interface JobEvent {
  id: string;
  command: string;
  state: JobState;
  progress: number;
  message?: string;
  startedAt?: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
}

interface AppWorkingStatePatchAppliedEvent {
  workspaceId: string;
  route: string;
  entityType: string;
  entityId: string;
  appliedPatch: Record<string, unknown>;
  nextVersionToken: string;
}

const IPC_CHANNELS = {
  INVOKE: 'kbv:invoke',
  JOB_INVOKE: 'kbv:job:invoke',
  JOB_CANCEL: 'kbv:job:cancel',
  JOB_EVENT: 'kbv:job:event',
  APP_WORKING_STATE_EVENT: 'kbv:app-working-state:event',
  AI_ASSISTANT_EVENT: 'kbv:ai-assistant:event'
} as const;

const invoke = async <T>(method: string, payload?: unknown): Promise<RpcResponse<T>> => {
  const request: RpcRequest = {
    method,
    payload,
    requestId: crypto.randomUUID()
  };
  return ipcRenderer.invoke(IPC_CHANNELS.INVOKE, request);
};

const emitJobEvents = (cb: (event: JobEvent) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: JobEvent) => cb(data);
  ipcRenderer.on(IPC_CHANNELS.JOB_EVENT, listener);
  return () => {
    ipcRenderer.removeListener(IPC_CHANNELS.JOB_EVENT, listener);
  };
};

const emitAppWorkingStateEvents = (cb: (event: AppWorkingStatePatchAppliedEvent) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: AppWorkingStatePatchAppliedEvent) => cb(data);
  ipcRenderer.on(IPC_CHANNELS.APP_WORKING_STATE_EVENT, listener);
  return () => {
    ipcRenderer.removeListener(IPC_CHANNELS.APP_WORKING_STATE_EVENT, listener);
  };
};

const emitAiAssistantEvents = (cb: (event: AiAssistantStreamEvent) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: AiAssistantStreamEvent) => cb(data);
  ipcRenderer.on(IPC_CHANNELS.AI_ASSISTANT_EVENT, listener);
  return () => {
    ipcRenderer.removeListener(IPC_CHANNELS.AI_ASSISTANT_EVENT, listener);
  };
};

contextBridge.exposeInMainWorld('kbv', {
  invoke,
  emitJobEvents,
  emitAppWorkingStateEvents,
  emitAiAssistantEvents,
  startJob: (command: string, input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.JOB_INVOKE, { command, input }),
  cancelJob: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOB_CANCEL, { jobId })
});
