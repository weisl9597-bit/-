import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  claimNextJobWithDatabase,
  completeJobWithDatabase,
  failJobWithDatabase,
  requeueOutdatedImportJobsWithDatabase,
  type JobDatabase,
  type JobTransaction,
} from '../src/jobs';

const migrationSql = await readFile(
  fileURLToPath(
    new URL('../prisma/migrations/20260821_initial_domain/migration.sql', import.meta.url),
  ),
  'utf8',
);

describe('job claiming', () => {
  it('passes the availability cutoff as a Date for PostgreSQL timestamptz comparison', async () => {
    const now = new Date('2026-08-21T12:00:00Z');
    let receivedParameters: unknown[] | undefined;
    const database: JobDatabase = {
      transaction(operation) {
        return operation({
          async query<T>(_sql: string, parameters: unknown[]): Promise<T[]> {
            receivedParameters = parameters;
            return [];
          },
          async execute(): Promise<void> {},
        });
      },
    };

    await claimNextJobWithDatabase('worker-1', database, now);

    expect(receivedParameters?.[0]).toBe(now);
  });

  it('claims one available job and marks it running for the worker', async () => {
    const database = new PGlite();
    await database.exec(migrationSql);
    await database.exec(`
      INSERT INTO "Job"
        ("id", "type", "status", "payload", "availableAt", "updatedAt")
      VALUES
        ('job-1', 'IMPORT', 'QUEUED', '{"batchId":"batch-1"}'::jsonb, TIMESTAMPTZ '2026-08-21 11:59:00+00', NOW()),
        ('job-future', 'IMPORT', 'QUEUED', '{"batchId":"batch-2"}'::jsonb, TIMESTAMPTZ '2026-08-22 12:00:00+00', NOW());
    `);
    const adapter: JobDatabase = {
      transaction(operation) {
        return database.transaction(async (tx) => {
          const transaction: JobTransaction = {
            async query<T>(sql: string, parameters: unknown[]): Promise<T[]> {
              const result = await tx.query<T>(sql, parameters);
              return result.rows;
            },
            async execute(sql: string, parameters: unknown[]): Promise<void> {
              await tx.query(sql, parameters);
            },
          };
          return operation(transaction);
        });
      },
    };

    const claimed = await claimNextJobWithDatabase(
      'worker-1',
      adapter,
      new Date('2026-08-21T12:00:00Z'),
    );

    expect(claimed).toMatchObject({
      id: 'job-1',
      type: 'IMPORT',
      status: 'RUNNING',
      lockedBy: 'worker-1',
      attempts: 1,
    });
    const stored = await database.query<{
      status: string;
      lockedBy: string;
      attempts: number;
    }>('SELECT "status", "lockedBy", "attempts" FROM "Job" WHERE "id" = $1', ['job-1']);
    expect(stored.rows[0]).toEqual({
      status: 'RUNNING',
      lockedBy: 'worker-1',
      attempts: 1,
    });
    await database.close();
  });

  it('reclaims a retryable job left running by a terminated worker', async () => {
    const database = new PGlite();
    await database.exec(migrationSql);
    await database.exec(`
      INSERT INTO "UploadBatch"
        ("id", "fileName", "fileHash", "dataDate", "status", "updatedAt")
      VALUES
        ('batch-stale', 'designbao.xlsx', 'hash-stale', DATE '2026-08-23', 'SUCCEEDED', NOW());
      INSERT INTO "Job"
        ("id", "type", "status", "sourceBatchId", "payload", "attempts", "maxAttempts", "lockedBy", "lockedAt", "availableAt", "updatedAt")
      VALUES
        ('job-stale', 'METRICS', 'RUNNING', 'batch-stale', '{"batchId":"batch-stale","dataDate":"2026-08-23"}'::jsonb, 1, 3, 'dead-worker', TIMESTAMPTZ '2026-08-23 11:30:00+00', TIMESTAMPTZ '2026-08-23 11:30:00+00', NOW());
    `);
    const adapter: JobDatabase = {
      transaction(operation) {
        return database.transaction(async (tx) => operation({
          async query<T>(sql: string, parameters: unknown[]): Promise<T[]> {
            const result = await tx.query<T>(sql, parameters);
            return result.rows;
          },
          async execute(sql: string, parameters: unknown[]): Promise<void> {
            await tx.query(sql, parameters);
          },
        }));
      },
    };

    const claimed = await claimNextJobWithDatabase(
      'replacement-worker',
      adapter,
      new Date('2026-08-23T12:00:00.000Z'),
    );

    expect(claimed).toMatchObject({
      id: 'job-stale',
      type: 'METRICS',
      attempts: 2,
      lockedBy: 'replacement-worker',
    });
    await database.close();
  });

  it('does not claim rules before metrics for the same batch succeed', async () => {
    const database = new PGlite();
    await database.exec(migrationSql);
    await database.exec(`
      INSERT INTO "UploadBatch"
        ("id", "fileName", "fileHash", "dataDate", "status", "updatedAt")
      VALUES
        ('batch-order', 'designbao.xlsx', 'hash-order', DATE '2026-08-23', 'SUCCEEDED', NOW());
      INSERT INTO "Job"
        ("id", "type", "status", "sourceBatchId", "payload", "availableAt", "createdAt", "updatedAt")
      VALUES
        ('metrics-order', 'METRICS', 'QUEUED', 'batch-order', '{"batchId":"batch-order","dataDate":"2026-08-23"}'::jsonb, TIMESTAMPTZ '2026-08-23 11:59:00+00', TIMESTAMPTZ '2026-08-23 11:59:00+00', NOW()),
        ('rules-order', 'RULES', 'QUEUED', 'batch-order', '{"batchId":"batch-order","dataDate":"2026-08-23"}'::jsonb, TIMESTAMPTZ '2026-08-23 11:59:00+00', TIMESTAMPTZ '2026-08-23 11:59:01+00', NOW());
    `);
    const adapter: JobDatabase = {
      transaction(operation) {
        return database.transaction(async (tx) => operation({
          async query<T>(sql: string, parameters: unknown[]): Promise<T[]> {
            const result = await tx.query<T>(sql, parameters);
            return result.rows;
          },
          async execute(sql: string, parameters: unknown[]): Promise<void> {
            await tx.query(sql, parameters);
          },
        }));
      },
    };
    const now = new Date('2026-08-23T12:00:00.000Z');

    const metrics = await claimNextJobWithDatabase('worker-1', adapter, now);
    const blockedRules = await claimNextJobWithDatabase('worker-2', adapter, now);

    expect(metrics?.type).toBe('METRICS');
    expect(blockedRules).toBeNull();
    await database.close();
  });
});

describe('job completion handling', () => {
  it('requeues the source import when the metric formula version changes', async () => {
    const database = new PGlite();
    await database.exec(migrationSql);
    await database.exec(`
      INSERT INTO "Organization" ("id", "name", "level", "path", "updatedAt")
      VALUES ('national', '全国', 'NATIONAL', '/china', NOW());
      INSERT INTO "UploadBatch"
        ("id", "fileName", "fileHash", "dataDate", "status", "updatedAt")
      VALUES
        ('batch-old-formula', 'designbao.xlsx', 'hash-old-formula', DATE '2026-08-23', 'SUCCEEDED', NOW());
      INSERT INTO "Job"
        ("id", "type", "status", "sourceBatchId", "payload", "attempts", "updatedAt")
      VALUES
        ('import-old-formula', 'IMPORT', 'SUCCEEDED', 'batch-old-formula', '{"batchId":"batch-old-formula","dataDate":"2026-08-23"}'::jsonb, 1, NOW()),
        ('metrics-old-formula', 'METRICS', 'SUCCEEDED', 'batch-old-formula', '{"batchId":"batch-old-formula","dataDate":"2026-08-23"}'::jsonb, 1, NOW());
    `);
    const adapter: JobDatabase = {
      transaction(operation) {
        return database.transaction(async (tx) => operation({
          async query<T>(sql: string, parameters: unknown[]): Promise<T[]> {
            const result = await tx.query<T>(sql, parameters);
            return result.rows;
          },
          async execute(sql: string, parameters: unknown[]): Promise<void> {
            await tx.query(sql, parameters);
          },
        }));
      },
    };

    await expect(requeueOutdatedImportJobsWithDatabase('v2', adapter)).resolves.toBe(1);
    const jobs = await database.query<{ status: string; attempts: number }>(
      'SELECT "status", "attempts" FROM "Job" WHERE "id" = $1',
      ['import-old-formula'],
    );
    expect(jobs.rows[0]).toEqual({ status: 'QUEUED', attempts: 0 });
    await database.close();
  });

  it('requeues metrics after a repaired import completes', async () => {
    const database = new PGlite();
    await database.exec(migrationSql);
    await database.exec(`
      INSERT INTO "UploadBatch"
        ("id", "fileName", "fileHash", "dataDate", "status", "updatedAt")
      VALUES ('batch-reimport', 'designbao.xlsx', 'hash-reimport', DATE '2026-08-23', 'SUCCEEDED', NOW());
      INSERT INTO "Job"
        ("id", "type", "status", "sourceBatchId", "payload", "attempts", "updatedAt")
      VALUES
        ('import-reimport', 'IMPORT', 'RUNNING', 'batch-reimport', '{"batchId":"batch-reimport"}'::jsonb, 2, NOW()),
        ('metrics-reimport', 'METRICS', 'SUCCEEDED', 'batch-reimport', '{"batchId":"batch-reimport","dataDate":"2026-08-23"}'::jsonb, 1, NOW());
    `);
    const adapter: JobDatabase = {
      transaction(operation) {
        return database.transaction(async (tx) => operation({
          async query<T>(sql: string, parameters: unknown[]): Promise<T[]> {
            const result = await tx.query<T>(sql, parameters);
            return result.rows;
          },
          async execute(sql: string, parameters: unknown[]): Promise<void> {
            await tx.query(sql, parameters);
          },
        }));
      },
    };

    await completeJobWithDatabase('import-reimport', adapter, new Date('2026-08-23T12:00:00Z'));
    const metrics = await database.query<{ status: string; attempts: number }>(
      'SELECT "status", "attempts" FROM "Job" WHERE "id" = $1',
      ['metrics-reimport'],
    );
    expect(metrics.rows[0]).toEqual({ status: 'QUEUED', attempts: 0 });
    await database.close();
  });

  it('requeues rules that ran before a recovered metrics job completed', async () => {
    const database = new PGlite();
    await database.exec(migrationSql);
    await database.exec(`
      INSERT INTO "UploadBatch"
        ("id", "fileName", "fileHash", "dataDate", "status", "updatedAt")
      VALUES
        ('batch-repair', 'designbao.xlsx', 'hash-repair', DATE '2026-08-23', 'SUCCEEDED', NOW());
      INSERT INTO "Job"
        ("id", "type", "status", "sourceBatchId", "payload", "attempts", "maxAttempts", "updatedAt")
      VALUES
        ('metrics-repair', 'METRICS', 'RUNNING', 'batch-repair', '{"batchId":"batch-repair","dataDate":"2026-08-23"}'::jsonb, 2, 3, NOW()),
        ('rules-repair', 'RULES', 'SUCCEEDED', 'batch-repair', '{"batchId":"batch-repair","dataDate":"2026-08-23"}'::jsonb, 1, 3, NOW());
    `);
    const adapter: JobDatabase = {
      transaction(operation) {
        return database.transaction(async (tx) => operation({
          async query<T>(sql: string, parameters: unknown[]): Promise<T[]> {
            const result = await tx.query<T>(sql, parameters);
            return result.rows;
          },
          async execute(sql: string, parameters: unknown[]): Promise<void> {
            await tx.query(sql, parameters);
          },
        }));
      },
    };

    await completeJobWithDatabase(
      'metrics-repair',
      adapter,
      new Date('2026-08-23T12:00:00.000Z'),
    );

    const jobs = await database.query<{ id: string; status: string; attempts: number }>(
      'SELECT "id", "status", "attempts" FROM "Job" ORDER BY "id"',
    );
    expect(jobs.rows).toEqual([
      { id: 'metrics-repair', status: 'SUCCEEDED', attempts: 2 },
      { id: 'rules-repair', status: 'QUEUED', attempts: 0 },
    ]);
    await database.close();
  });
});

describe('job failure handling', () => {
  it('marks an exhausted import and its upload batch failed with a safe message', async () => {
    const database = new PGlite();
    await database.exec(migrationSql);
    await database.exec(`
      INSERT INTO "UploadBatch"
        ("id", "fileName", "fileHash", "dataDate", "status", "updatedAt")
      VALUES
        ('batch-1', 'designbao.xlsx', 'hash-1', DATE '2026-08-23', 'PROCESSING', NOW());
      INSERT INTO "Job"
        ("id", "type", "status", "sourceBatchId", "payload", "attempts", "maxAttempts", "updatedAt")
      VALUES
        ('job-1', 'IMPORT', 'RUNNING', 'batch-1', '{"batchId":"batch-1"}'::jsonb, 3, 3, NOW());
    `);
    const adapter: JobDatabase = {
      transaction(operation) {
        return database.transaction(async (tx) => operation({
          async query<T>(sql: string, parameters: unknown[]): Promise<T[]> {
            const result = await tx.query<T>(sql, parameters);
            return result.rows;
          },
          async execute(sql: string, parameters: unknown[]): Promise<void> {
            await tx.query(sql, parameters);
          },
        }));
      },
    };

    const result = await failJobWithDatabase(
      'job-1',
      new Error('DATABASE_URL=postgresql://user:secret@db/internal\nimport timed out'),
      adapter,
      new Date('2026-08-23T08:00:00.000Z'),
    );

    const job = await database.query<{ status: string; lastError: string }>(
      'SELECT "status", "lastError" FROM "Job" WHERE "id" = $1',
      ['job-1'],
    );
    const batch = await database.query<{
      status: string;
      failureStage: string;
      failureMessage: string;
      finishedAt: Date;
    }>(
      'SELECT "status", "failureStage", "failureMessage", "finishedAt" FROM "UploadBatch" WHERE "id" = $1',
      ['batch-1'],
    );

    expect(result).toEqual({ exhausted: true, batchId: 'batch-1' });
    expect(job.rows[0]).toEqual({
      status: 'FAILED',
      lastError: 'DATABASE_URL=*** import timed out',
    });
    expect(batch.rows[0]).toMatchObject({
      status: 'FAILED',
      failureStage: 'IMPORT',
      failureMessage: 'DATABASE_URL=*** import timed out',
    });
    expect(batch.rows[0]?.finishedAt).toBeInstanceOf(Date);
    await database.close();
  });

  it('requeues a retryable import without failing its upload batch', async () => {
    const database = new PGlite();
    await database.exec(migrationSql);
    await database.exec(`
      INSERT INTO "UploadBatch"
        ("id", "fileName", "fileHash", "dataDate", "status", "updatedAt")
      VALUES
        ('batch-2', 'designbao.xlsx', 'hash-2', DATE '2026-08-23', 'PROCESSING', NOW());
      INSERT INTO "Job"
        ("id", "type", "status", "sourceBatchId", "payload", "attempts", "maxAttempts", "updatedAt")
      VALUES
        ('job-2', 'IMPORT', 'RUNNING', 'batch-2', '{"batchId":"batch-2"}'::jsonb, 1, 3, NOW());
    `);
    const adapter: JobDatabase = {
      transaction(operation) {
        return database.transaction(async (tx) => operation({
          async query<T>(sql: string, parameters: unknown[]): Promise<T[]> {
            const result = await tx.query<T>(sql, parameters);
            return result.rows;
          },
          async execute(sql: string, parameters: unknown[]): Promise<void> {
            await tx.query(sql, parameters);
          },
        }));
      },
    };

    const result = await failJobWithDatabase(
      'job-2',
      new Error('temporary failure'),
      adapter,
      new Date('2026-08-23T08:00:00.000Z'),
    );
    const job = await database.query<{ status: string }>(
      'SELECT "status" FROM "Job" WHERE "id" = $1',
      ['job-2'],
    );
    const batch = await database.query<{ status: string }>(
      'SELECT "status" FROM "UploadBatch" WHERE "id" = $1',
      ['batch-2'],
    );

    expect(result).toEqual({ exhausted: false, batchId: 'batch-2' });
    expect(job.rows[0]?.status).toBe('QUEUED');
    expect(batch.rows[0]?.status).toBe('PROCESSING');
    await database.close();
  });
});
