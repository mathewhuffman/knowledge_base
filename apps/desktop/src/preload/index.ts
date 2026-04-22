import { contextBridge, ipcRenderer } from 'electron';
import {
  type AppUpdateStateChangedEvent,
  type AiAssistantDetachedWindowMoveRequest,
  type AiAssistantDetachedWindowResizeRequest,
  type AppWorkingStatePatchAppliedEvent,
  type JobEvent,
  type RpcRequest,
  type RpcResponse,
  type AiAssistantContextChangedEvent,
  type AiAssistantPresentationChangedEvent,
  type AiAssistantStreamEvent,
  type AppNavigationEvent
} from '@kb-vault/shared-types';

// Sandboxed preload can require Electron builtins, but not arbitrary workspace packages.
// Keep the channel map local so the preload stays self-contained at runtime.
const IPC_CHANNELS = {
  INVOKE: 'kbv:invoke',
  JOB_INVOKE: 'kbv:job:invoke',
  JOB_CANCEL: 'kbv:job:cancel',
  JOB_EVENT: 'kbv:job:event',
  APP_WORKING_STATE_EVENT: 'kbv:app-working-state:event',
  APP_UPDATE_EVENT: 'kbv:app-update:event',
  AI_ASSISTANT_EVENT: 'kbv:ai-assistant:event',
  AI_ASSISTANT_PRESENTATION_EVENT: 'kbv:ai-assistant:presentation:event',
  AI_ASSISTANT_CONTEXT_EVENT: 'kbv:ai-assistant:context:event',
  AI_ASSISTANT_WINDOW_MOVE: 'kbv:ai-assistant:window:move',
  AI_ASSISTANT_WINDOW_RESIZE: 'kbv:ai-assistant:window:resize',
  AI_ASSISTANT_WINDOW_DRAG_END: 'kbv:ai-assistant:window:drag-end',
  APP_NAVIGATION_EVENT: 'kbv:app:navigation:event'
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

const emitAppUpdateEvents = (cb: (event: AppUpdateStateChangedEvent) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: AppUpdateStateChangedEvent) => cb(data);
  ipcRenderer.on(IPC_CHANNELS.APP_UPDATE_EVENT, listener);
  return () => {
    ipcRenderer.removeListener(IPC_CHANNELS.APP_UPDATE_EVENT, listener);
  };
};

const emitAiAssistantEvents = (cb: (event: AiAssistantStreamEvent) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: AiAssistantStreamEvent) => cb(data);
  ipcRenderer.on(IPC_CHANNELS.AI_ASSISTANT_EVENT, listener);
  return () => {
    ipcRenderer.removeListener(IPC_CHANNELS.AI_ASSISTANT_EVENT, listener);
  };
};

const emitAiAssistantPresentationEvents = (cb: (event: AiAssistantPresentationChangedEvent) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: AiAssistantPresentationChangedEvent) => cb(data);
  ipcRenderer.on(IPC_CHANNELS.AI_ASSISTANT_PRESENTATION_EVENT, listener);
  return () => {
    ipcRenderer.removeListener(IPC_CHANNELS.AI_ASSISTANT_PRESENTATION_EVENT, listener);
  };
};

const emitAiAssistantContextEvents = (cb: (event: AiAssistantContextChangedEvent) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: AiAssistantContextChangedEvent) => cb(data);
  ipcRenderer.on(IPC_CHANNELS.AI_ASSISTANT_CONTEXT_EVENT, listener);
  return () => {
    ipcRenderer.removeListener(IPC_CHANNELS.AI_ASSISTANT_CONTEXT_EVENT, listener);
  };
};

const emitAppNavigationEvents = (cb: (event: AppNavigationEvent) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: AppNavigationEvent) => cb(data);
  ipcRenderer.on(IPC_CHANNELS.APP_NAVIGATION_EVENT, listener);
  return () => {
    ipcRenderer.removeListener(IPC_CHANNELS.APP_NAVIGATION_EVENT, listener);
  };
};

const moveAssistantWindow = (payload: AiAssistantDetachedWindowMoveRequest) => {
  ipcRenderer.send(IPC_CHANNELS.AI_ASSISTANT_WINDOW_MOVE, payload);
};

const resizeAssistantWindow = (payload: AiAssistantDetachedWindowResizeRequest) => {
  ipcRenderer.send(IPC_CHANNELS.AI_ASSISTANT_WINDOW_RESIZE, payload);
};

const finishAssistantWindowDrag = () => {
  ipcRenderer.send(IPC_CHANNELS.AI_ASSISTANT_WINDOW_DRAG_END);
};

contextBridge.exposeInMainWorld('kbv', {
  invoke,
  emitJobEvents,
  emitAppWorkingStateEvents,
  emitAppUpdateEvents,
  emitAiAssistantEvents,
  emitAiAssistantPresentationEvents,
  emitAiAssistantContextEvents,
  emitAppNavigationEvents,
  moveAssistantWindow,
  resizeAssistantWindow,
  finishAssistantWindowDrag,
  startJob: (command: string, input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.JOB_INVOKE, { command, input }),
  cancelJob: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.JOB_CANCEL, { jobId })
});
