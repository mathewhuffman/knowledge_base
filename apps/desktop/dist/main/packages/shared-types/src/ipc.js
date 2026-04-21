"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createErrorResult = exports.JobState = exports.IPC_CHANNELS = void 0;
exports.IPC_CHANNELS = {
    INVOKE: 'kbv:invoke',
    JOB_INVOKE: 'kbv:job:invoke',
    JOB_CANCEL: 'kbv:job:cancel',
    JOB_EVENT: 'kbv:job:event',
    APP_WORKING_STATE_EVENT: 'kbv:app-working-state:event',
    AI_ASSISTANT_EVENT: 'kbv:ai-assistant:event',
    AI_ASSISTANT_PRESENTATION_EVENT: 'kbv:ai-assistant:presentation:event',
    AI_ASSISTANT_CONTEXT_EVENT: 'kbv:ai-assistant:context:event',
    AI_ASSISTANT_WINDOW_MOVE: 'kbv:ai-assistant:window:move',
    AI_ASSISTANT_WINDOW_RESIZE: 'kbv:ai-assistant:window:resize',
    AI_ASSISTANT_WINDOW_DRAG_END: 'kbv:ai-assistant:window:drag-end',
    APP_NAVIGATION_EVENT: 'kbv:app:navigation:event'
};
var JobState;
(function (JobState) {
    JobState["QUEUED"] = "QUEUED";
    JobState["RUNNING"] = "RUNNING";
    JobState["SUCCEEDED"] = "SUCCEEDED";
    JobState["FAILED"] = "FAILED";
    JobState["CANCELED"] = "CANCELED";
    JobState["PAUSED"] = "PAUSED";
})(JobState || (exports.JobState = JobState = {}));
const createErrorResult = (code, message, requestId) => ({
    ok: false,
    error: { code, message },
    requestId,
    timestamp: new Date().toISOString()
});
exports.createErrorResult = createErrorResult;
