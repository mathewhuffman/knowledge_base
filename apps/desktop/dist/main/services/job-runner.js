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
    setEmitter(fn) {
        this.emitter.on('job-event', fn);
    }
    registerRunner(name, runner) {
        this.runners.set(name, runner);
    }
    async start(command, input) {
        const id = (0, node_crypto_1.randomUUID)();
        const status = { id, command, state: shared_types_1.JobState.QUEUED, progress: 0, startedAt: new Date().toISOString() };
        this.state.set(id, status);
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
        await runner({ jobId: id, command, input }, (event) => this.emit(event));
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
        this.emitter.emit('job-event', event);
    }
    list() {
        return Array.from(this.state.values());
    }
}
exports.JobRegistry = JobRegistry;
