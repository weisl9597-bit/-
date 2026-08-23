import type { CanonicalProjectRow } from '@designbao/importer/validate-batch';
import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { createPrismaImportRepository } from '../src/jobs/prisma-import-repository';

function record(overrides: Partial<CanonicalProjectRow> = {}): CanonicalProjectRow {
  return {
    sourceSheet: '项目明细2',
    sourceRow: 2,
    city: '同名市',
    cityType: null,
    region: '华东',
    merchantId: 'merchant-1',
    merchantName: '商家一',
    assignmentId: 'project-1::merchant-1',
    projectId: 'project-1',
    businessSource: 'DESIGNBAO',
    category: null,
    assignedAt: '2026-08-23',
    followWithin30m: true,
    needsAnalyzed: true,
    hardInvite: false,
    needsCoaching: false,
    coached: null,
    improved: null,
    raw: {},
    ...overrides,
  };
}

describe('Prisma import repository', () => {
  it('uses three bulk writes and assigns snapshots to the correct regional city', async () => {
    const rawQueries: Prisma.Sql[] = [];
    let snapshots: Array<{
      projectId: string;
      organizationId: string;
      businessSource: string;
      assignedAt: Date;
    }> = [];
    let snapshotsDeleted = false;
    let batchStatus: string | undefined;
    const transaction = {
      uploadRow: {
        async deleteMany() {},
        async createMany() {},
      },
      uploadError: {
        async deleteMany() {},
        async createMany() {},
      },
      async $executeRaw(query: Prisma.Sql) {
        rawQueries.push(query);
        return 1;
      },
      projectSnapshot: {
        async deleteMany() {
          snapshotsDeleted = true;
        },
        async createMany(input: { data: typeof snapshots }) {
          snapshots = input.data;
        },
      },
      job: { async createMany() {} },
      uploadBatch: {
        async update(input: { data: { status: string } }) {
          batchStatus = input.data.status;
        },
      },
    };
    const database = {
      async $transaction(operation: (value: typeof transaction) => Promise<void>) {
        await operation(transaction);
      },
    };
    const repository = createPrismaImportRepository(database as never);

    await repository.persistSuccessful({
      batchId: 'batch-1',
      dataDate: '2026-08-23',
      totalRows: 2,
      rawRows: [],
      warnings: [],
      records: [
        record(),
        record({
          sourceRow: 3,
          region: '华南',
          merchantId: 'merchant-2',
          merchantName: '商家二',
          assignmentId: 'project-2::merchant-2',
          projectId: 'project-2',
        }),
      ],
    });

    expect(rawQueries).toHaveLength(3);
    expect(snapshotsDeleted).toBe(true);
    expect(snapshots).toHaveLength(2);
    expect(new Set(snapshots.map((item) => item.organizationId)).size).toBe(2);
    expect(snapshots[0]).toMatchObject({
      businessSource: 'DESIGNBAO',
      assignedAt: new Date('2026-08-23T00:00:00.000Z'),
    });
    expect(batchStatus).toBe('SUCCEEDED');
  });

  it('replaces an earlier same-day snapshot with the newest accepted batch facts', async () => {
    type StoredSnapshot = {
      dataDate: Date;
      projectId: string;
      uploadBatchId: string;
      businessSource: string;
      assignedAt: Date;
    };
    const stored = new Map<string, StoredSnapshot>();
    const transaction = {
      uploadRow: { async deleteMany() {}, async createMany() {} },
      uploadError: { async deleteMany() {}, async createMany() {} },
      async $executeRaw() { return 1; },
      projectSnapshot: {
        async deleteMany(input: {
          where: {
            uploadBatchId?: string;
            dataDate?: Date;
            projectId?: { in: string[] };
          };
        }) {
          for (const [key, snapshot] of stored) {
            const matchesBatch = input.where.uploadBatchId === snapshot.uploadBatchId;
            const matchesProjectDate =
              input.where.dataDate?.getTime() === snapshot.dataDate.getTime() &&
              input.where.projectId?.in.includes(snapshot.projectId);
            if (matchesBatch || matchesProjectDate) stored.delete(key);
          }
        },
        async createMany(input: { data: StoredSnapshot[]; skipDuplicates?: boolean }) {
          for (const snapshot of input.data) {
            const key = `${snapshot.dataDate.toISOString()}:${snapshot.projectId}`;
            if (input.skipDuplicates && stored.has(key)) continue;
            stored.set(key, snapshot);
          }
        },
      },
      job: { async createMany() {} },
      uploadBatch: { async update() {} },
    };
    const database = {
      async $transaction(operation: (value: typeof transaction) => Promise<void>) {
        await operation(transaction);
      },
    };
    const repository = createPrismaImportRepository(database as never);
    const input = {
      dataDate: '2026-08-23',
      totalRows: 1,
      rawRows: [],
      warnings: [],
      records: [record()],
    };

    await repository.persistSuccessful({ ...input, batchId: 'batch-1' });
    await repository.persistSuccessful({
      ...input,
      batchId: 'batch-2',
      records: [
        record({
          businessSource: 'XIAOHONGSHU',
          assignedAt: '2026-08-24',
        }),
      ],
    });

    expect(stored.size).toBe(1);
    expect([...stored.values()][0]).toMatchObject({
      uploadBatchId: 'batch-2',
      businessSource: 'XIAOHONGSHU',
      assignedAt: new Date('2026-08-24T00:00:00.000Z'),
    });
  });
});

