import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  processImportBatch,
  type ImportBatchRecord,
  type ImportBatchRepository,
  type ImportObjectStore,
  type PersistFailedBatchInput,
  type PersistSuccessfulBatchInput,
} from '../src/jobs/import-batch';

class MemoryRepository implements ImportBatchRepository {
  readonly batches = new Map<string, ImportBatchRecord>();
  readonly snapshots = new Map<string, unknown>();
  readonly downstreamJobs = new Set<string>();
  latestSuccessfulDataDate: string | null = '2026-08-20';

  async getBatch(batchId: string) {
    return this.batches.get(batchId) ?? null;
  }

  async markProcessing(batchId: string) {
    const batch = this.batches.get(batchId);
    if (batch) batch.status = 'PROCESSING';
  }

  async persistFailed(input: PersistFailedBatchInput) {
    const batch = this.batches.get(input.batchId)!;
    batch.status = 'FAILED';
    batch.totalRows = input.totalRows;
    batch.acceptedRows = 0;
    batch.errorCount = input.errors.length;
    batch.warningCount = input.warnings.length;
  }

  async persistSuccessful(input: PersistSuccessfulBatchInput) {
    const batch = this.batches.get(input.batchId)!;
    for (const record of input.records) {
      this.snapshots.set(`${input.dataDate}:${record.assignmentId}`, record);
    }
    this.downstreamJobs.add(`METRICS:${input.batchId}`);
    this.downstreamJobs.add(`RULES:${input.batchId}`);
    batch.status = 'SUCCEEDED';
    batch.totalRows = input.totalRows;
    batch.acceptedRows = input.records.length;
    batch.errorCount = 0;
    batch.warningCount = input.warnings.length;
    this.latestSuccessfulDataDate = input.dataDate;
  }
}

async function fixture(name: string) {
  return readFile(resolve('packages/test-fixtures/excel', name));
}

describe('import batch worker', () => {
  it('persists valid snapshots and remains idempotent when the same batch is retried', async () => {
    const repository = new MemoryRepository();
    repository.batches.set('batch-valid', {
      id: 'batch-valid',
      status: 'QUEUED',
      objectKey: 'uploads/valid.xlsx',
      dataDate: '2026-08-21',
      totalRows: 0,
      acceptedRows: 0,
      errorCount: 0,
      warningCount: 0,
    });
    const objects = new Map([['uploads/valid.xlsx', await fixture('designbao-valid.xlsx')]]);
    const storage: ImportObjectStore = {
      async getObject(key) {
        return objects.get(key) ?? null;
      },
    };

    await processImportBatch('batch-valid', { repository, storage });
    await processImportBatch('batch-valid', { repository, storage });

    expect(repository.batches.get('batch-valid')).toMatchObject({
      status: 'SUCCEEDED',
      acceptedRows: 2,
      errorCount: 0,
    });
    expect(repository.snapshots.size).toBe(2);
    expect(repository.downstreamJobs).toEqual(
      new Set(['METRICS:batch-valid', 'RULES:batch-valid']),
    );
    expect(repository.latestSuccessfulDataDate).toBe('2026-08-21');
  });

  it('records an invalid batch without changing the latest successful data date', async () => {
    const repository = new MemoryRepository();
    repository.batches.set('batch-invalid', {
      id: 'batch-invalid',
      status: 'QUEUED',
      objectKey: 'uploads/invalid.xlsx',
      dataDate: '2026-08-21',
      totalRows: 0,
      acceptedRows: 0,
      errorCount: 0,
      warningCount: 0,
    });
    const objects = new Map([['uploads/invalid.xlsx', await fixture('designbao-invalid.xlsx')]]);

    await processImportBatch('batch-invalid', {
      repository,
      storage: { async getObject(key) { return objects.get(key) ?? null; } },
    });

    expect(repository.batches.get('batch-invalid')).toMatchObject({
      status: 'FAILED',
      acceptedRows: 0,
      errorCount: expect.any(Number),
    });
    expect(repository.batches.get('batch-invalid')!.errorCount).toBeGreaterThan(0);
    expect(repository.snapshots.size).toBe(0);
    expect(repository.latestSuccessfulDataDate).toBe('2026-08-20');
  });
});
