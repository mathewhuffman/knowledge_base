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

type JobExecutor = (
  payload: JobRunContext,
  emit: (event: JobEvent) => void,
  isCancelled: () => boolean
) => Promise<void>;

type JobControl = {
  cancelled: boolean;
};

export class JobRegistry {
  private emitter = new EventEmitter();
  private runners = new Map<string, JobExecutor>();
  private state = new Map<string, JobStatus>();
  private controls = new Map<string, JobControl>();

  cancel(jobId: string): JobStatus | null {
    const status = this.state.get(jobId);
    if (!status) {
      return null;
    }
    if (status.state === JobState.SUCCEEDED || status.state === JobState.FAILED || status.state === JobState.CANCELED) {
      return status;
    }

    const control = this.controls.get(jobId);
    if (control) {
      control.cancelled = true;
    }

    const canceled: JobStatus = {
      ...status,
      state: JobState.CANCELED,
      endedAt: new Date().toISOString(),
      message: status.state === JobState.RUNNING || status.state === JobState.QUEUED ? 'canceled' : status.message
    };
    this.state.set(jobId, canceled);
    this.emit(canceled);
    return canceled;
  }

  setEmitter(fn: (event: JobEvent) => void) {
    this.emitter.on('job-event', fn);
  }

  registerRunner(name: string, runner: JobExecutor) {
    this.runners.set(name, runner);
  }

  async start(command: string, input: JobInput): Promise<JobPayload> {
    const id = randomUUID();
    const control: JobControl = { cancelled: false };
    const status: JobStatus = { id, command, state: JobState.QUEUED, progress: 0, startedAt: new Date().toISOString() };
    this.state.set(id, status);
    this.controls.set(id, control);
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

    try {
      await runner(
        { jobId: id, command, input },
        (event) => this.emit(event),
        () => control.cancelled || status.state === JobState.CANCELED
      );
    } catch (error) {
      const current = this.state.get(id);
      if (current?.state !== JobState.CANCELED) {
        const failed: JobStatus = {
          ...status,
          state: JobState.FAILED,
          progress: Math.max(status.progress, 100),
          endedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error ?? 'job failed')
        };
        this.state.set(id, failed);
        this.emit({ ...failed });
      }
    } finally {
      this.controls.delete(id);
    }

    const finalState = this.state.get(id);
    if (finalState?.state === JobState.CANCELED) {
      return { jobId: id, state: finalState.state };
    }

    if (finalState?.state === JobState.FAILED) {
      return { jobId: id, state: finalState.state };
    }

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
