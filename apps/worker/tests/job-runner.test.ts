import { describe, expect, it, vi } from 'vitest';
import { runClaimedJob, type JobHandlers } from '../src/job-runner';

function handlers(): JobHandlers {
  return {
    importBatch: vi.fn(async () => undefined),
    calculateMetrics: vi.fn(async () => undefined),
    evaluateRules: vi.fn(async () => undefined),
  };
}

describe('worker job routing', () => {
  it.each(['IMPORT', 'METRICS', 'RULES'] as const)('routes %s without failing it as unsupported', async (type) => {
    const target = handlers();
    await runClaimedJob({
      id: 'job-1', type, status: 'RUNNING', sourceBatchId: 'batch-1',
      payload: { batchId: 'batch-1', dataDate: '2026-08-21' }, attempts: 1,
      maxAttempts: 3, lockedBy: 'worker-1', lockedAt: new Date(),
    }, target);
    const key = type === 'IMPORT' ? 'importBatch' : type === 'METRICS' ? 'calculateMetrics' : 'evaluateRules';
    expect(target[key]).toHaveBeenCalledOnce();
  });
});
