import { describe, expect, it } from 'vitest';
import { getBusinessSourceRebuildStatus } from '../lib/queries/rebuild-status';

describe('business source rebuild status', () => {
  it('counts a batch complete only after its newer rules job succeeds', async () => {
    const tagged = (batchId: string, dataDate: string, type: 'METRICS' | 'RULES',
      status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED', updatedAt: string) => ({
      batchId, dataDate, type, status, attempts: 1, maxAttempts: 3,
      updatedAt: new Date(updatedAt), rebuildVersion: 'business-source-v2',
    });
    const status = await getBusinessSourceRebuildStatus({
      listTaggedJobs: async () => [
        tagged('batch-1', '2026-08-01', 'METRICS', 'SUCCEEDED', '2026-08-24T00:00:01Z'),
        tagged('batch-1', '2026-08-01', 'RULES', 'SUCCEEDED', '2026-08-24T00:00:02Z'),
        tagged('batch-2', '2026-08-02', 'METRICS', 'RUNNING', '2026-08-24T00:00:03Z'),
        tagged('batch-2', '2026-08-02', 'RULES', 'SUCCEEDED', '2026-08-23T00:00:00Z'),
        tagged('batch-3', '2026-08-03', 'METRICS', 'QUEUED', '2026-08-24T00:00:04Z'),
        tagged('batch-3', '2026-08-03', 'RULES', 'SUCCEEDED', '2026-08-23T00:00:00Z'),
      ],
    });

    expect(status).toEqual({
      state: 'RUNNING', total: 3, completed: 1, failed: 0,
      lastSuccessfulDate: '2026-08-01',
    });
  });
});

