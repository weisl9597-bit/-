import { describe, expect, it } from 'vitest';
import type { MetricRow } from '../src/calculate';
import * as queryModule from '../src/query';

const rows: MetricRow[] = [
  {
    rowId: 'r1', assignmentId: 'P1::M1', sourceProjectId: 'P1',
    organizationIds: ['national', 'region-1', 'city-1'], merchantId: 'M1',
    dataDate: '2026-08-01', projectDate: '2026-08-01', assignmentDate: '2026-08-01',
    assignmentCount: 2, businessSource: 'DESIGNBAO', followWithin30m: true,
    needsAnalyzed: true, hardInvite: false, coached: null, raw: { T: '是', U: '是' },
  },
  {
    rowId: 'r2', assignmentId: 'P2::M2', sourceProjectId: 'P2',
    organizationIds: ['national', 'region-1', 'city-1'], merchantId: 'M2',
    dataDate: '2026-08-02', projectDate: '2026-08-02', assignmentDate: '2026-08-02',
    assignmentCount: 3, businessSource: 'DESIGNBAO', followWithin30m: false,
    needsAnalyzed: false, hardInvite: true, coached: null, raw: { T: '否', U: '否' },
  },
  {
    rowId: 'r3', assignmentId: 'P3::M3', sourceProjectId: 'P3',
    organizationIds: ['national', 'region-2', 'city-2'], merchantId: 'M3',
    dataDate: '2026-08-01', projectDate: '2026-08-01', assignmentDate: '2026-08-01',
    assignmentCount: 4, businessSource: 'XIAOHONGSHU', followWithin30m: true,
    needsAnalyzed: true, hardInvite: false, coached: null, raw: { T: '是', U: '是' },
  },
];

describe('latest-upload metric query', () => {
  it('calculates daily facts from the latest uploaded rows with source and organization filters', async () => {
    const createLatestUploadMetricQueryRepository = (
      queryModule as typeof queryModule & {
        createLatestUploadMetricQueryRepository?: (
          source: { loadLatestRows(): Promise<MetricRow[]> },
        ) => queryModule.MetricQueryRepository;
      }
    ).createLatestUploadMetricQueryRepository;

    expect(createLatestUploadMetricQueryRepository).toBeTypeOf('function');
    if (!createLatestUploadMetricQueryRepository) return;

    const repository = createLatestUploadMetricQueryRepository({
      async loadLatestRows() { return rows; },
    });
    const facts = await repository.listDaily({
      metricIds: ['dispatch_project_count', 'dispatch_assignment_count', 'open_project_count'],
      grain: 'DAY', source: 'DESIGNBAO', organizationIds: ['city-1'],
      start: new Date('2026-08-01T00:00:00.000Z'), end: new Date('2026-08-02T23:59:59.999Z'),
    });

    expect(facts.map((fact) => [
      fact.metricId, fact.periodStart.toISOString().slice(0, 10),
      fact.numerator, fact.denominator,
    ])).toEqual([
      ['dispatch_project_count', '2026-08-01', 1, null],
      ['dispatch_assignment_count', '2026-08-01', 2, null],
      ['open_project_count', '2026-08-01', 1, null],
      ['dispatch_project_count', '2026-08-02', 1, null],
      ['dispatch_assignment_count', '2026-08-02', 3, null],
      ['open_project_count', '2026-08-02', 0, null],
    ]);
  });
});

