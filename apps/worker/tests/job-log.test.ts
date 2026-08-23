import type { ClaimedJob } from '@designbao/db/jobs';
import { describe, expect, it } from 'vitest';

import { formatJobLog } from '../src/job-log';

const job: ClaimedJob = {
  id: 'job-1',
  type: 'IMPORT',
  status: 'RUNNING',
  sourceBatchId: 'batch-1',
  payload: { batchId: 'batch-1' },
  attempts: 3,
  maxAttempts: 3,
  lockedBy: 'worker-1',
  lockedAt: new Date('2026-08-23T08:00:00.000Z'),
};

describe('worker job logs', () => {
  it('formats a searchable lifecycle event with job identity and attempt', () => {
    expect(JSON.parse(formatJobLog({ event: 'job_claimed', job }))).toEqual({
      event: 'job_claimed',
      jobId: 'job-1',
      jobType: 'IMPORT',
      batchId: 'batch-1',
      attempt: 3,
      maxAttempts: 3,
    });
  });

  it('redacts secrets from failed job logs and records whether retries are exhausted', () => {
    const output = formatJobLog({
      event: 'job_failed',
      job,
      error: new Error('DATABASE_URL=postgresql://user:secret@db/internal'),
      exhausted: true,
    });

    expect(JSON.parse(output)).toMatchObject({
      event: 'job_failed',
      jobId: 'job-1',
      batchId: 'batch-1',
      exhausted: true,
      error: 'DATABASE_URL=***',
    });
    expect(output).not.toContain('secret');
  });
});

