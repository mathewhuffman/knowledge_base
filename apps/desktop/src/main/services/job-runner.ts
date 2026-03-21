import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  JobState,
  type JobInput,
  type JobStatus,
  type JobEvent,
  type JobPayload,
  type JobRunContext
} from '@kb-vault/shared-types';

type JobExecutor = (payload: JobRunContext, emit: (event: JobEvent) => void) => Promise<void>;

export class JobRegistry {
  private emitter = new EventEmitter();
  private runners = new Map<string, JobExecutor>();
  private state = new Map<string, JobStatus>();

  setEmitter(fn: (event: JobEvent) => void) {
    this.emitter.on('job-event', fn);
  }

  registerRunner(name: string, runner: JobExecutor) {
    this.runners.set(name, runner);
  }

  async start(command: string, input: JobInput): Promise<JobPayload> {
    const id = randomUUID();
    const status: JobStatus = { id, command, state: JobState.QUEUED, progress: 0, startedAt: new Date().toISOString() };
    this.state.set(id, status);
    this.emit({ ...status, message: 'queued' });

    const runner = this.runners.get(command);
    if (!runner) {
      const failed: JobStatus = { ...status, state: JobState.FAILED, endedAt: new Date().toISOString(), message: 'missing_runner' };
      this.state.set(id, failed);
      this.emit({ ...failed });
      return { jobId: id, state: failed.state };
    }

    status.state = JobState.RUNNING;
    status.startedAt = new Date().toISOString();
    this.state.set(id, status);
    this.emit({ ...status, message: 'running' });

    await runner({ jobId: id, command, input }, (event) => this.emit(event));

    const finished: JobStatus = {
      ...status,
      state: JobState.SUCCEEDED,
      progress: 100,
      endedAt: new Date().toISOString(),
      message: 'completed'
    };
    this.state.set(id, finished);
    this.emit({ ...finished });

    return { jobId: id, state: finished.state };
  }

  private emit(event: JobEvent) {
    this.emitter.emit('job-event', event);
  }

  list(): JobStatus[] {
    return Array.from(this.state.values());
  }
}
