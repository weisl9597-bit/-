import { describe, expect, it } from 'vitest';
import type { MetricSnapshotRepository } from '@designbao/metrics/snapshots';
import { runCalculateMetricsJob } from '../src/jobs/calculate-metrics';

describe('metric worker job', () => {
  it('builds snapshots for the source batch and reports the inserted count', async () => {
    const repository: MetricSnapshotRepository = {
      loadRows: async () => [{
        assignmentId: 'P1::M1', sourceProjectId: 'P1', organizationIds: ['city-1'],
        merchantId: 'M1', dataDate: '2026-08-21', followWithin30m: true,
        businessSource: 'DESIGNBAO',
        needsAnalyzed: true, hardInvite: false, coached: null, raw: { T: '是', U: '是' },
      }],
      syncDefinitions: async () => undefined,
      deleteSnapshots: async () => undefined,
      insertSnapshots: async (snapshots) => snapshots.length,
    };

    await expect(runCalculateMetricsJob({
      batchId: 'batch-1', dataDate: '2026-08-21', repository,
    })).resolves.toEqual({ snapshotCount: 82 });
  });
});

