import { describe, expect, it } from 'vitest';
import { managementMetricCatalog, metricCatalog } from '../src/catalog';
import { calculateMetric, rate, type MetricRow } from '../src/calculate';

function definition(id: string) {
  const match = [...metricCatalog, ...managementMetricCatalog].find((item) => item.id === id);
  if (!match) throw new Error(`Missing test metric ${id}`);
  return match;
}

const rows: MetricRow[] = [
  {
    assignmentId: 'P1::M1', sourceProjectId: 'P1', organizationIds: ['city-1'],
    merchantId: 'M1', dataDate: '2026-08-21', businessSource: 'DESIGNBAO', followWithin30m: true,
    needsAnalyzed: true, hardInvite: false, coached: true,
    raw: { T: '是', U: '是', S: '有详细需求有户型图', X: '还不错', AH: '是', AI: '是', AJ: 1 },
  },
  {
    assignmentId: 'P1::M2', sourceProjectId: 'P1', organizationIds: ['city-1'],
    merchantId: 'M2', dataDate: '2026-08-21', businessSource: 'DESIGNBAO', followWithin30m: true,
    needsAnalyzed: false, hardInvite: true, coached: null,
    raw: { T: '否', U: '是', S: null, X: '差', AH: '是', AI: '是', AJ: 1 },
  },
  {
    assignmentId: 'P2::M1', sourceProjectId: 'P2', organizationIds: ['city-1'],
    merchantId: 'M1', dataDate: '2026-08-21', businessSource: 'DESIGNBAO', followWithin30m: false,
    needsAnalyzed: true, hardInvite: false, coached: null,
    raw: { T: '是', U: '是', S: '无详细需求无户型图', X: '一般', AH: '否', AI: '否', AJ: 0 },
  },
];

describe('metric calculation', () => {
  it('returns null rather than 0 percent when the denominator is empty', () => {
    expect(rate(0, 0)).toEqual({ value: null, numerator: 0, denominator: 0 });
  });

  it('distinguishes source projects from merchant assignment rows', () => {
    expect(calculateMetric(definition('dispatch_project_count'), rows)).toMatchObject({ value: 2 });
    expect(calculateMetric(definition('dispatch_assignment_count'), rows)).toMatchObject({ value: 3 });
    expect(calculateMetric(definition('open_project_count'), rows)).toMatchObject({ value: 2 });
    expect(calculateMetric(definition('group_open_count'), rows)).toMatchObject({ value: 2 });
  });

  it('calculates SOP counts and strict yes-yes-no compliance from assignment facts', () => {
    expect(calculateMetric(definition('follow_30m_execution_rate'), rows)).toEqual({
      value: 66.6667, numerator: 2, denominator: 3,
    });
    expect(calculateMetric(definition('merchant_sop_compliance_rate'), rows)).toEqual({
      value: 33.3333, numerator: 1, denominator: 3,
    });
  });

  it('matches the workbook date axes, count columns, and exact business fields', () => {
    const workbookRows = [{
      assignmentId: 'P10::M1', sourceProjectId: 'P10', organizationIds: ['city-1'],
      merchantId: 'M1', dataDate: '2026-08-01', projectDate: '2026-08-01',
      assignmentDate: '2026-08-02', signedDate: '2026-08-03', assignmentCount: 2,
      businessSource: 'DESIGNBAO', followWithin30m: true, needsAnalyzed: true,
      hardInvite: false, coached: true,
      raw: { U: '是', T: '是', AB: '是', AH: '是', AI: '是', AJ: '已收定', V: '还不错', Y: '已辅导' },
    }] as MetricRow[];

    expect(calculateMetric(definition('dispatch_project_count'), workbookRows, '2026-08-01').value).toBe(1);
    expect(calculateMetric(definition('dispatch_assignment_count'), workbookRows, '2026-08-01').value).toBe(2);
    expect(calculateMetric(definition('group_open_count'), workbookRows, '2026-08-01').value).toBe(0);
    expect(calculateMetric(definition('group_open_count'), workbookRows, '2026-08-02').value).toBe(1);
    expect(calculateMetric(definition('signed_project_count'), workbookRows, '2026-08-03').value).toBe(1);
    expect(calculateMetric(definition('exit_group_project_count'), workbookRows, '2026-08-01').value).toBe(1);
    expect(calculateMetric(definition('quality_good_count'), workbookRows, '2026-08-02').value).toBe(1);
  });
});

