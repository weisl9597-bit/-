import { describe, expect, it, vi } from 'vitest';

describe('recoverable duplicate uploads', () => {
  it('requeues a processing batch whose import job exhausted its retries', async () => {
    const module = await import('../lib/uploads/retry-upload').catch(() => ({}));
    expect(module).toHaveProperty('retryRecoverableUpload');
    if (!('retryRecoverableUpload' in module)) return;
    const reset = vi.fn(async () => undefined);

    const result = await (module as {
      retryRecoverableUpload(
        batch: { id: string; status: string },
        store: {
          findImportJob(batchId: string): Promise<{ id: string; status: string } | null>;
          reset(batchId: string, jobId: string): Promise<void>;
        },
      ): Promise<{ id: string; status: string }>;
    }).retryRecoverableUpload(
      { id: 'batch-1', status: 'PROCESSING' },
      {
        async findImportJob() { return { id: 'job-1', status: 'FAILED' }; },
        reset,
      },
    );

    expect(result).toEqual({ id: 'batch-1', status: 'QUEUED' });
    expect(reset).toHaveBeenCalledWith('batch-1', 'job-1');
  });

  it('does not disturb a batch while its import job is still active', async () => {
    const module = await import('../lib/uploads/retry-upload').catch(() => ({}));
    expect(module).toHaveProperty('retryRecoverableUpload');
    if (!('retryRecoverableUpload' in module)) return;
    const reset = vi.fn(async () => undefined);

    const result = await (module as {
      retryRecoverableUpload(
        batch: { id: string; status: string },
        store: {
          findImportJob(batchId: string): Promise<{
            id: string;
            status: string;
            lockedAt: Date | null;
          } | null>;
          reset(batchId: string, jobId: string): Promise<void>;
        },
        now?: Date,
      ): Promise<{ id: string; status: string }>;
    }).retryRecoverableUpload(
      { id: 'batch-1', status: 'PROCESSING' },
      {
        async findImportJob() {
          return {
            id: 'job-1',
            status: 'RUNNING',
            lockedAt: new Date('2026-08-23T06:58:00.000Z'),
          };
        },
        reset,
      },
      new Date('2026-08-23T07:00:00.000Z'),
    );

    expect(result).toEqual({ id: 'batch-1', status: 'PROCESSING' });
    expect(reset).not.toHaveBeenCalled();
  });

  it('requeues a processing batch whose running import job lost its worker lock', async () => {
    const module = await import('../lib/uploads/retry-upload').catch(() => ({}));
    expect(module).toHaveProperty('retryRecoverableUpload');
    if (!('retryRecoverableUpload' in module)) return;
    const reset = vi.fn(async () => undefined);

    const result = await (module as {
      retryRecoverableUpload(
        batch: { id: string; status: string },
        store: {
          findImportJob(batchId: string): Promise<{
            id: string;
            status: string;
            lockedAt: Date | null;
          } | null>;
          reset(batchId: string, jobId: string): Promise<void>;
        },
        now?: Date,
      ): Promise<{ id: string; status: string }>;
    }).retryRecoverableUpload(
      { id: 'batch-1', status: 'PROCESSING' },
      {
        async findImportJob() {
          return {
            id: 'job-1',
            status: 'RUNNING',
            lockedAt: new Date('2026-08-23T06:30:00.000Z'),
          };
        },
        reset,
      },
      new Date('2026-08-23T07:00:00.000Z'),
    );

    expect(result).toEqual({ id: 'batch-1', status: 'QUEUED' });
    expect(reset).toHaveBeenCalledWith('batch-1', 'job-1');
  });
});
