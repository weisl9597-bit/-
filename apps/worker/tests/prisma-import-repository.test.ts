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
    let snapshots: Array<{ projectId: string; organizationId: string }> = [];
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
        async createMany(input: { data: Array<{ projectId: string; organizationId: string }> }) {
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
    expect(snapshots).toHaveLength(2);
    expect(new Set(snapshots.map((item) => item.organizationId)).size).toBe(2);
    expect(batchStatus).toBe('SUCCEEDED');
  });
});

