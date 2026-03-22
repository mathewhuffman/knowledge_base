import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type RpcRequest, type RpcResponse, type JobEvent } from '@kb-vault/shared-types';

const invoke = async <T>(method: string, payload?: unknown): Promise<RpcResponse<T>> => {
  console.log('[renderer] ipc invoke', { method, hasPayload: payload !== undefined });
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

contextBridge.exposeInMainWorld('kbv', {
  invoke,
  emitJobEvents,
  startJob: (command: string, input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.JOB_INVOKE, { command, input }),
  cancelJob: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOB_CANCEL, { jobId })
});
