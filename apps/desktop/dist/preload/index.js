"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const IPC_CHANNELS = {
    INVOKE: 'kbv:invoke',
    JOB_INVOKE: 'kbv:job:invoke',
    JOB_CANCEL: 'kbv:job:cancel',
    JOB_EVENT: 'kbv:job:event'
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
    electron_1.ipcRenderer.on(IPC_CHANNELS.JOB_EVENT, (_event, data) => cb(data));
};
electron_1.contextBridge.exposeInMainWorld('kbv', {
    invoke,
    emitJobEvents,
    startJob: (command, input) => electron_1.ipcRenderer.invoke(IPC_CHANNELS.JOB_INVOKE, { command, input }),
    cancelJob: (jobId) => electron_1.ipcRenderer.invoke(IPC_CHANNELS.JOB_CANCEL, { jobId })
});
