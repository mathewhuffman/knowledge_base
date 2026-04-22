"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
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
};
const invoke = async (method, payload) => {
    const request = {
        method,
        payload,
        requestId: crypto.randomUUID()
    };
    return electron_1.ipcRenderer.invoke(IPC_CHANNELS.INVOKE, request);
};
const emitJobEvents = (cb) => {
    const listener = (_event, data) => cb(data);
    electron_1.ipcRenderer.on(IPC_CHANNELS.JOB_EVENT, listener);
    return () => {
        electron_1.ipcRenderer.removeListener(IPC_CHANNELS.JOB_EVENT, listener);
    };
};
const emitAppWorkingStateEvents = (cb) => {
    const listener = (_event, data) => cb(data);
    electron_1.ipcRenderer.on(IPC_CHANNELS.APP_WORKING_STATE_EVENT, listener);
    return () => {
        electron_1.ipcRenderer.removeListener(IPC_CHANNELS.APP_WORKING_STATE_EVENT, listener);
    };
};
const emitAppUpdateEvents = (cb) => {
    const listener = (_event, data) => cb(data);
    electron_1.ipcRenderer.on(IPC_CHANNELS.APP_UPDATE_EVENT, listener);
    return () => {
        electron_1.ipcRenderer.removeListener(IPC_CHANNELS.APP_UPDATE_EVENT, listener);
    };
};
const emitAiAssistantEvents = (cb) => {
    const listener = (_event, data) => cb(data);
    electron_1.ipcRenderer.on(IPC_CHANNELS.AI_ASSISTANT_EVENT, listener);
    return () => {
        electron_1.ipcRenderer.removeListener(IPC_CHANNELS.AI_ASSISTANT_EVENT, listener);
    };
};
const emitAiAssistantPresentationEvents = (cb) => {
    const listener = (_event, data) => cb(data);
    electron_1.ipcRenderer.on(IPC_CHANNELS.AI_ASSISTANT_PRESENTATION_EVENT, listener);
    return () => {
        electron_1.ipcRenderer.removeListener(IPC_CHANNELS.AI_ASSISTANT_PRESENTATION_EVENT, listener);
    };
};
const emitAiAssistantContextEvents = (cb) => {
    const listener = (_event, data) => cb(data);
    electron_1.ipcRenderer.on(IPC_CHANNELS.AI_ASSISTANT_CONTEXT_EVENT, listener);
    return () => {
        electron_1.ipcRenderer.removeListener(IPC_CHANNELS.AI_ASSISTANT_CONTEXT_EVENT, listener);
    };
};
const emitAppNavigationEvents = (cb) => {
    const listener = (_event, data) => cb(data);
    electron_1.ipcRenderer.on(IPC_CHANNELS.APP_NAVIGATION_EVENT, listener);
    return () => {
        electron_1.ipcRenderer.removeListener(IPC_CHANNELS.APP_NAVIGATION_EVENT, listener);
    };
};
const moveAssistantWindow = (payload) => {
    electron_1.ipcRenderer.send(IPC_CHANNELS.AI_ASSISTANT_WINDOW_MOVE, payload);
};
const resizeAssistantWindow = (payload) => {
    electron_1.ipcRenderer.send(IPC_CHANNELS.AI_ASSISTANT_WINDOW_RESIZE, payload);
};
const finishAssistantWindowDrag = () => {
    electron_1.ipcRenderer.send(IPC_CHANNELS.AI_ASSISTANT_WINDOW_DRAG_END);
};
electron_1.contextBridge.exposeInMainWorld('kbv', {
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
    startJob: (command, input) => electron_1.ipcRenderer.invoke(IPC_CHANNELS.JOB_INVOKE, { command, input }),
    cancelJob: (jobId) => electron_1.ipcRenderer.invoke(IPC_CHANNELS.JOB_CANCEL, { jobId })
});
