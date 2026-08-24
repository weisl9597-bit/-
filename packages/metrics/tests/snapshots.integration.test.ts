import { describe, expect, it } from 'vitest';
import type { MetricRow } from '../src/calculate';
import { allMetricDefinitions } from '../src/catalog';
import { queryMetricSeries } from '../src/query';
import { buildMetricSnapshots, type MetricSnapshotRepository } from '../src/snapshots';

describe('metric snapshots', () => {
  it('stores immutable day snapshots for organization and merchant scopes', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const rows: MetricRow[] = [{
      assignmentId: 'P1::M1', sourceProjectId: 'P1', organizationIds: ['national', 'region-1', 'city-1'],
      merchantId: 'M1', dataDate: '2026-08-21', followWithin30m: true,
      businessSource: 'DESIGNBAO', projectDate: '2026-08-21', assignmentDate: '2026-08-21',
      signedDate: null, assignmentCount: 1,
      needsAnalyzed: true, hardInvite: false, coached: null,
      raw: { T: '是', U: '是', X: '还不错' },
    }, {
      assignmentId: 'OLD::M1', sourceProjectId: 'OLD', organizationIds: ['national', 'region-1', 'city-1'],
      merchantId: 'M1', dataDate: '2026-08-20', followWithin30m: true,
      businessSource: 'XIAOHONGSHU', projectDate: '2026-08-20', assignmentDate: '2026-08-20',
      signedDate: null, assignmentCount: 1,
      needsAnalyzed: true, hardInvite: false, coached: null,
      raw: { T: '是', U: '是', X: '还不错' },
    }];
    const repository: MetricSnapshotRepository = {
      loadRows: async () => rows,
      syncDefinitions: async () => undefined,
      deleteSnapshots: async () => undefined,
      insertSnapshots: async (snapshots) => { saved.push(...snapshots); return snapshots.length; },
    };

    const count = await buildMetricSnapshots('2026-08-21', 'batch-1', repository);

    expect(count).toBe(saved.length);
    expect(saved).toContainEqual(expect.objectContaining({
      metricId: 'merchant_sop_compliance_rate', grain: 'DAY', periodStart: '2026-08-21',
      organizationId: 'city-1', merchantId: 'M1', numerator: 1, denominator: 1, value: 100,
      sourceBatchId: 'batch-1', formulaVersion: 'v2',
      businessSource: 'DESIGNBAO', dimensionKey: 'merchant:M1',
    }));
    expect(saved).toContainEqual(expect.objectContaining({
      metricId: 'dispatch_project_count', organizationId: 'national', merchantId: null,
      businessSource: 'DESIGNBAO', value: 1, dimensionKey: 'organization',
    }));
    expect(saved).toContainEqual(expect.objectContaining({
      metricId: 'dispatch_project_count', organizationId: 'national',
      businessSource: 'XIAOHONGSHU', value: 1, dimensionKey: 'organization',
    }));
  });

  it('combines source rates from summed numerators and denominators', async () => {
    const series = await queryMetricSeries({
      metricIds: ['project_open_rate'],
      grain: 'DAY',
      start: new Date('2026-08-21T00:00:00Z'),
      end: new Date('2026-08-21T23:59:59Z'),
      organizationIds: ['city-1'],
      source: 'ALL',
    }, {
      async listDaily() {
        return [{
          metricId: 'project_open_rate',
          periodStart: new Date('2026-08-21T00:00:00Z'),
          organizationId: 'city-1', merchantId: null,
          businessSource: 'DESIGNBAO' as const,
          value: 50, numerator: 1, denominator: 2,
        }, {
          metricId: 'project_open_rate',
          periodStart: new Date('2026-08-21T00:00:00Z'),
          organizationId: 'city-1', merchantId: null,
          businessSource: 'XIAOHONGSHU' as const,
          value: 100, numerator: 8, denominator: 8,
        }];
      },
    });

    expect(series[0]?.points[0]).toMatchObject({
      value: 90,
      numerator: 9,
      denominator: 10,
    });
  });

  it('keeps source-prefixed dimensions during the expand-only rollout phase', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const repository: MetricSnapshotRepository = {
      loadRows: async () => [{
        assignmentId: 'P1::M1', sourceProjectId: 'P1', organizationIds: ['city-1'],
        merchantId: 'M1', dataDate: '2026-08-21', businessSource: 'XIAOHONGSHU',
        followWithin30m: true, needsAnalyzed: true, hardInvite: false, coached: null,
        raw: { T: '是' },
      }],
      syncDefinitions: async () => undefined,
      deleteSnapshots: async () => undefined,
      insertSnapshots: async (snapshots) => { saved.push(...snapshots); return snapshots.length; },
    };

    await buildMetricSnapshots('2026-08-21', 'batch-expand', repository, { sourceAware: false });

    expect(saved).toContainEqual(expect.objectContaining({
      businessSource: 'XIAOHONGSHU', dimensionKey: 'source:XIAOHONGSHU|organization',
    }));
    expect(saved).toContainEqual(expect.objectContaining({
      businessSource: 'XIAOHONGSHU', dimensionKey: 'source:XIAOHONGSHU|merchant:M1',
    }));
  });

  it('writes large metric results in bounded batches', async () => {
    const batchSizes: number[] = [];
    const rows: MetricRow[] = Array.from({ length: 4 }, (_, index) => ({
      assignmentId: `P${index}::M${index}`,
      sourceProjectId: `P${index}`,
      organizationIds: ['national', 'region-1', 'city-1'],
      merchantId: `M${index}`,
      dataDate: `2026-08-${String(18 + index).padStart(2, '0')}`,
      businessSource: 'DESIGNBAO' as const,
      projectDate: `2026-08-${String(18 + index).padStart(2, '0')}`,
      assignmentDate: `2026-08-${String(18 + index).padStart(2, '0')}`,
      signedDate: null,
      assignmentCount: 1,
      followWithin30m: true,
      needsAnalyzed: true,
      hardInvite: false,
      coached: null,
      raw: { T: '是', U: '是', X: '还不错' },
    }));
    const repository: MetricSnapshotRepository = {
      loadRows: async () => rows,
      syncDefinitions: async () => undefined,
      deleteSnapshots: async () => undefined,
      insertSnapshots: async (snapshots) => {
        batchSizes.push(snapshots.length);
        return snapshots.length;
      },
    };

    const count = await buildMetricSnapshots('2026-08-21', 'batch-large', repository);

    expect(count).toBe(16 * allMetricDefinitions.length);
    expect(batchSizes.length).toBeGreaterThan(1);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(500);
  });
});
