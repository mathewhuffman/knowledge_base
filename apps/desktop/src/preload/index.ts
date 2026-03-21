import { contextBridge, ipcRenderer } from 'electron';

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
}

const IPC_CHANNELS = {
  INVOKE: 'kbv:invoke',
  JOB_INVOKE: 'kbv:job:invoke',
  JOB_CANCEL: 'kbv:job:cancel',
  JOB_EVENT: 'kbv:job:event'
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
  ipcRenderer.on(IPC_CHANNELS.JOB_EVENT, (_event, data: JobEvent) => cb(data));
};

contextBridge.exposeInMainWorld('kbv', {
  invoke,
  emitJobEvents,
  startJob: (command: string, input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.JOB_INVOKE, { command, input }),
  cancelJob: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOB_CANCEL, { jobId })
});
