"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const shared_types_1 = require("@kb-vault/shared-types");
const invoke = async (method, payload) => {
    console.log('[renderer] ipc invoke', { method, hasPayload: payload !== undefined });
    const request = {
        method,
        payload,
        requestId: crypto.randomUUID()
    };
    return electron_1.ipcRenderer.invoke(shared_types_1.IPC_CHANNELS.INVOKE, request);
};
const emitJobEvents = (cb) => {
    electron_1.ipcRenderer.on(shared_types_1.IPC_CHANNELS.JOB_EVENT, (_event, data) => cb(data));
};
electron_1.contextBridge.exposeInMainWorld('kbv', {
    invoke,
    emitJobEvents,
    startJob: (command, input) => electron_1.ipcRenderer.invoke(shared_types_1.IPC_CHANNELS.JOB_INVOKE, { command, input })
});
