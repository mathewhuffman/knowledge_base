"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const IPC_CHANNELS = {
    INVOKE: 'kbv:invoke',
    JOB_INVOKE: 'kbv:job:invoke',
    JOB_CANCEL: 'kbv:job:cancel',
    JOB_EVENT: 'kbv:job:event',
    APP_WORKING_STATE_EVENT: 'kbv:app-working-state:event',
    AI_ASSISTANT_EVENT: 'kbv:ai-assistant:event'
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
const emitAiAssistantEvents = (cb) => {
    const listener = (_event, data) => cb(data);
    electron_1.ipcRenderer.on(IPC_CHANNELS.AI_ASSISTANT_EVENT, listener);
    return () => {
        electron_1.ipcRenderer.removeListener(IPC_CHANNELS.AI_ASSISTANT_EVENT, listener);
    };
};
electron_1.contextBridge.exposeInMainWorld('kbv', {
    invoke,
    emitJobEvents,
    emitAppWorkingStateEvents,
    emitAiAssistantEvents,
    startJob: (command, input) => electron_1.ipcRenderer.invoke(IPC_CHANNELS.JOB_INVOKE, { command, input }),
    cancelJob: (jobId) => electron_1.ipcRenderer.invoke(IPC_CHANNELS.JOB_CANCEL, { jobId })
});
