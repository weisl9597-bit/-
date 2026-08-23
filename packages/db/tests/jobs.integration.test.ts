import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  claimNextJobWithDatabase,
  failJobWithDatabase,
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

