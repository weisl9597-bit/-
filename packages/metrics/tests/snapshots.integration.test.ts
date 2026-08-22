import { describe, expect, it } from 'vitest';
import type { MetricRow } from '../src/calculate';
import { buildMetricSnapshots, type MetricSnapshotRepository } from '../src/snapshots';

describe('metric snapshots', () => {
  it('stores immutable day snapshots for organization and merchant scopes', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const rows: MetricRow[] = [{
      assignmentId: 'P1::M1', sourceProjectId: 'P1', organizationIds: ['national', 'region-1', 'city-1'],
      merchantId: 'M1', dataDate: '2026-08-21', followWithin30m: true,
      needsAnalyzed: true, hardInvite: false, coached: null,
      raw: { T: '是', U: '是', X: '还不错' },
    }, {
      assignmentId: 'OLD::M1', sourceProjectId: 'OLD', organizationIds: ['national', 'region-1', 'city-1'],
      merchantId: 'M1', dataDate: '2026-08-20', followWithin30m: true,
      needsAnalyzed: true, hardInvite: false, coached: null,
      raw: { T: '是', U: '是', X: '还不错' },
    }];
    const repository: MetricSnapshotRepository = {
      loadRows: async () => rows,
      syncDefinitions: async () => undefined,
      insertSnapshots: async (snapshots) => { saved.push(...snapshots); return snapshots.length; },
    };

    const count = await buildMetricSnapshots('2026-08-21', 'batch-1', repository);

    expect(count).toBe(saved.length);
    expect(saved).toContainEqual(expect.objectContaining({
      metricId: 'merchant_sop_compliance_rate', grain: 'DAY', periodStart: '2026-08-21',
      organizationId: 'city-1', merchantId: 'M1', numerator: 1, denominator: 1, value: 100,
      sourceBatchId: 'batch-1', formulaVersion: 'v1',
    }));
    expect(saved).toContainEqual(expect.objectContaining({
      metricId: 'dispatch_project_count', organizationId: 'national', merchantId: null,
      value: 1,
    }));
  });
});
