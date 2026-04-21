import { expect, test } from '@playwright/test';
import { JobState } from '@kb-vault/shared-types';
import { JobRegistry } from '../src/main/services/job-runner';

test.describe('job runner', () => {
  test('returns failed when a runner emits a terminal failed event without throwing', async () => {
    const jobs = new JobRegistry();

    jobs.registerRunner('demo.fail', async (payload, emit) => {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: 'runner reported failure'
      });
    });

    const result = await jobs.start('demo.fail', {});

    expect(result.state).toBe(JobState.FAILED);
    expect(jobs.list().find((job) => job.id === result.jobId)?.message).toBe('runner reported failure');
  });
});
