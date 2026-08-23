import type { CanonicalProjectRow } from '@designbao/importer/validate-batch';
import { describe, expect, it } from 'vitest';

import { buildBulkImportPlan, chunkRows } from '../src/jobs/bulk-import-plan';

function record(
  overrides: Partial<CanonicalProjectRow> = {},
): CanonicalProjectRow {
  return {
    sourceSheet: '项目明细2',
    sourceRow: 2,
    city: '苏州市',
    cityType: null,
    region: '华东',
    merchantId: 'merchant-1',
    merchantName: '旧商家名称',
    assignmentId: 'project-1::merchant-1',
    projectId: 'project-1',
    category: null,
    assignedAt: '2026-08-22',
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

describe('bulk import write plan', () => {
  it('deduplicates organizations, merchants and projects with the last row winning', () => {
    const plan = buildBulkImportPlan([
      record(),
      record({
        sourceRow: 3,
        merchantName: '新商家名称',
        assignedAt: '2026-08-23',
        needsCoaching: true,
      }),
    ]);

    expect(plan.organizations.map(({ name, level, path }) => ({ name, level, path }))).toEqual([
      { name: '全国', level: 'NATIONAL', path: '/china' },
      { name: '华东', level: 'REGION', path: '/china/%E5%8D%8E%E4%B8%9C' },
      {
        name: '苏州市',
        level: 'CITY',
        path: '/china/%E5%8D%8E%E4%B8%9C/%E8%8B%8F%E5%B7%9E%E5%B8%82',
      },
    ]);
    expect(plan.merchants).toHaveLength(1);
    expect(plan.merchants[0]).toMatchObject({
      id: 'merchant-1',
      name: '新商家名称',
    });
    expect(plan.projects).toHaveLength(1);
    expect(plan.projects[0]).toMatchObject({
      id: 'project-1::merchant-1',
      assignedAt: new Date('2026-08-23T00:00:00.000Z'),
      needsCoaching: true,
    });
  });

  it('keeps cities with the same name separate when they belong to different regions', () => {
    const plan = buildBulkImportPlan([
      record(),
      record({
        sourceRow: 3,
        region: '华南',
        merchantId: 'merchant-2',
        merchantName: '商家二',
        assignmentId: 'project-2::merchant-2',
        projectId: 'project-2',
      }),
    ]);

    expect(plan.organizations.filter((item) => item.level === 'CITY')).toHaveLength(2);
    expect(new Set(plan.projects.map((item) => item.organizationId)).size).toBe(2);
  });

  it('splits rows into database-safe chunks without dropping the tail', () => {
    const chunks = chunkRows(Array.from({ length: 501 }, (_, index) => index));

    expect(chunks.map((chunk) => chunk.length)).toEqual([250, 250, 1]);
    expect(chunks.flat()).toEqual(Array.from({ length: 501 }, (_, index) => index));
  });
});

