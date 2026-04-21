"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobRegistry = void 0;
const node_events_1 = require("node:events");
const node_crypto_1 = require("node:crypto");
const shared_types_1 = require("@kb-vault/shared-types");
class JobRegistry {
    emitter = new node_events_1.EventEmitter();
    runners = new Map();
    state = new Map();
    controls = new Map();
    cancel(jobId) {
        const status = this.state.get(jobId);
        if (!status) {
            return null;
        }
        if (status.state === shared_types_1.JobState.SUCCEEDED || status.state === shared_types_1.JobState.FAILED || status.state === shared_types_1.JobState.CANCELED) {
            return status;
        }
        const control = this.controls.get(jobId);
        if (control) {
            control.cancelled = true;
        }
        const canceled = {
            ...status,
            state: shared_types_1.JobState.CANCELED,
            endedAt: new Date().toISOString(),
            message: status.state === shared_types_1.JobState.RUNNING || status.state === shared_types_1.JobState.QUEUED ? 'canceled' : status.message
        };
        this.state.set(jobId, canceled);
        this.emit(canceled);
        return canceled;
    }
    setEmitter(fn) {
        this.emitter.on('job-event', fn);
    }
    registerRunner(name, runner) {
        this.runners.set(name, runner);
    }
    async start(command, input) {
        const id = (0, node_crypto_1.randomUUID)();
        const control = { cancelled: false };
        const status = { id, command, state: shared_types_1.JobState.QUEUED, progress: 0, startedAt: new Date().toISOString() };
        this.state.set(id, status);
        this.controls.set(id, control);
        this.emit({ ...status, message: 'queued' });
        const runner = this.runners.get(command);
        if (!runner) {
            const failed = { ...status, state: shared_types_1.JobState.FAILED, endedAt: new Date().toISOString(), message: 'missing_runner' };
            this.state.set(id, failed);
            this.emit({ ...failed });
            return { jobId: id, state: failed.state };
        }
        status.state = shared_types_1.JobState.RUNNING;
        status.startedAt = new Date().toISOString();
        this.state.set(id, status);
        this.emit({ ...status, message: 'running' });
        try {
            await runner({ jobId: id, command, input }, (event) => this.emit(event), () => control.cancelled || status.state === shared_types_1.JobState.CANCELED);
        }
        catch (error) {
            const current = this.state.get(id);
            if (current?.state !== shared_types_1.JobState.CANCELED) {
                const failed = {
                    ...status,
                    state: shared_types_1.JobState.FAILED,
                    progress: Math.max(status.progress, 100),
                    endedAt: new Date().toISOString(),
                    message: error instanceof Error ? error.message : String(error ?? 'job failed')
                };
                this.state.set(id, failed);
                this.emit({ ...failed });
            }
        }
        finally {
            this.controls.delete(id);
        }
        const finalState = this.state.get(id);
        if (finalState?.state === shared_types_1.JobState.CANCELED) {
            return { jobId: id, state: finalState.state };
        }
        if (finalState?.state === shared_types_1.JobState.FAILED) {
            return { jobId: id, state: finalState.state };
        }
        const finished = {
            ...status,
            state: shared_types_1.JobState.SUCCEEDED,
            progress: 100,
            endedAt: new Date().toISOString(),
            message: 'completed'
        };
        this.state.set(id, finished);
        this.emit({ ...finished });
        return { jobId: id, state: finished.state };
    }
    emit(event) {
        const previous = this.state.get(event.id);
        const next = {
            ...(previous ?? {}),
            ...event,
            startedAt: event.startedAt ?? previous?.startedAt,
            endedAt: event.endedAt ?? previous?.endedAt
        };
        this.state.set(event.id, next);
        this.emitter.emit('job-event', next);
    }
    list() {
        return Array.from(this.state.values());
    }
}
exports.JobRegistry = JobRegistry;
