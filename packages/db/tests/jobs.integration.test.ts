import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  claimNextJobWithDatabase,
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
