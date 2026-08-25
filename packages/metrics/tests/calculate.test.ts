import { describe, expect, it } from 'vitest';
import { managementMetricCatalog, metricCatalog } from '../src/catalog';
import * as calculateModule from '../src/calculate';
import { calculateMetric, rate, type MetricRow } from '../src/calculate';

function definition(id: string) {
  const match = [...metricCatalog, ...managementMetricCatalog].find((item) => item.id === id);
  if (!match) throw new Error(`Missing test metric ${id}`);
  return match;
}

const rows: MetricRow[] = [
  {
    rowId: 'upload-row-1',
    assignmentId: 'P1::M1', sourceProjectId: 'P1', organizationIds: ['city-1'],
    merchantId: 'M1', dataDate: '2026-08-21', businessSource: 'DESIGNBAO', followWithin30m: true,
    needsAnalyzed: true, hardInvite: false, coached: true,
    raw: { S: '是', T: '是', R: '有详细需求有户型图', U: '还不错', AG: '是', AH: '是', AJ: '2026/08/21' },
  },
  {
    rowId: 'upload-row-2',
    assignmentId: 'P1::M2', sourceProjectId: 'P1', organizationIds: ['city-1'],
    merchantId: 'M2', dataDate: '2026-08-21', businessSource: 'DESIGNBAO', followWithin30m: true,
    needsAnalyzed: false, hardInvite: true, coached: null,
    raw: { S: '否', T: '是', R: null, U: '差', AG: '是', AH: '是', AJ: '2026/08/21' },
  },
  {
    rowId: 'upload-row-3',
    assignmentId: 'P2::M1', sourceProjectId: 'P2', organizationIds: ['city-1'],
    merchantId: 'M1', dataDate: '2026-08-21', businessSource: 'DESIGNBAO', followWithin30m: false,
    needsAnalyzed: true, hardInvite: false, coached: null,
    raw: { S: '是', T: '是', R: '无详细需求无户型图', U: '一般', AG: '否', AH: '否' },
  },
];

describe('metric calculation', () => {
  it('reconstructs every metric input from the stored Excel column facts', () => {
    const buildMetricRowsFromUpload = (
      calculateModule as typeof calculateModule & {
        buildMetricRowsFromUpload?: (input: unknown) => MetricRow[];
      }
    ).buildMetricRowsFromUpload;

    expect(buildMetricRowsFromUpload).toBeTypeOf('function');
    if (!buildMetricRowsFromUpload) return;

    const result = buildMetricRowsFromUpload({
      dataDate: '2026-08-23',
      uploadRows: [{
        id: 'upload-row-1', sourceRow: 2,
        raw: {
          A: '北京市', B: 'M1', D: 'P1', F: '设计宝', G: '2026/08/01',
          H: '2026/08/02', I: 2, M: '是', N: '是', O: '否', S: '是', T: '是',
          AI: '已收定', AK: '2026/08/03',
        },
        canonical: {
          city: '北京市', merchantId: 'M1', projectId: 'P1', assignmentId: 'P1::M1',
          businessSource: '设计宝', assignedAt: '2026/08/02',
        },
      }],
      organizations: [
        { id: 'national', name: '全国', level: 'NATIONAL', parent: null },
        { id: 'region-1', name: '北京大区', level: 'REGION', parent: { id: 'national', parent: null } },
        {
          id: 'city-1', name: '北京市', level: 'CITY',
          parent: { id: 'region-1', parent: { id: 'national' } },
        },
      ],
      merchantIds: ['M1'],
    });

    expect(result).toEqual([expect.objectContaining({
      rowId: 'upload-row-1', assignmentId: 'P1::M1', sourceProjectId: 'P1',
      organizationIds: ['national', 'region-1', 'city-1'], merchantId: 'M1',
      businessSource: 'DESIGNBAO', projectDate: '2026-08-01', assignmentDate: '2026-08-02',
      signedDate: '2026-08-03', assignmentCount: 2,
      followWithin30m: true, needsAnalyzed: true, hardInvite: false,
      raw: expect.objectContaining({ S: '是', T: '是' }),
    })]);
  });

  it('excludes upload rows that did not pass validation', () => {
    const result = calculateModule.buildMetricRowsFromUpload({
      dataDate: '2026-08-23',
      uploadRows: [{
        id: 'rejected-row',
        sourceRow: 3,
        raw: {
          A: '北京市', B: 'M1', D: 'REJECTED', F: '设计宝', G: '2026/08/01',
          H: '2026/08/02', I: 1, S: '是', T: '是',
        },
        canonical: {},
      }],
      organizations: [
        { id: 'national', name: '全国', level: 'NATIONAL' },
        { id: 'region-1', name: '北京大区', level: 'REGION', parent: { id: 'national' } },
        { id: 'city-1', name: '北京市', level: 'CITY', parent: { id: 'region-1', parent: { id: 'national' } } },
      ],
      merchantIds: ['M1'],
    });

    expect(result).toEqual([]);
  });

  it('keeps originally blank merged date cells out of Excel COUNTIFS metrics', () => {
    const result = calculateModule.buildMetricRowsFromUpload({
      dataDate: '2026-08-23',
      uploadRows: [{
        id: 'merged-child-row', sourceRow: 5,
        raw: { A: '北京市', B: 'M1', D: 'P1', F: '设计宝', H: '2026/08/02', I: 0, S: '是' },
        canonical: {
          city: '北京市', merchantId: 'M1', projectId: 'P1', assignmentId: 'P1::M1',
          businessSource: '设计宝', assignedAt: '2026/08/01',
        },
      }],
      organizations: [
        { id: 'national', name: '全国', level: 'NATIONAL' },
        { id: 'region-1', name: '北京大区', level: 'REGION', parent: { id: 'national' } },
        { id: 'city-1', name: '北京市', level: 'CITY', parent: { id: 'region-1', parent: { id: 'national' } } },
      ],
      merchantIds: ['M1'],
    });

    expect(result[0]).toMatchObject({ projectDate: null, assignmentDate: '2026-08-02' });
    expect(calculateMetric(definition('dispatch_project_count'), result, '2026-08-01').value).toBe(0);
    expect(calculateMetric(definition('group_open_count'), result, '2026-08-02').value).toBe(1);
  });

  it('returns null rather than 0 percent when the denominator is empty', () => {
    expect(rate(0, 0)).toEqual({ value: null, numerator: 0, denominator: 0 });
  });

  it('matches workbook COUNTIFS row counts instead of deduplicating project IDs', () => {
    expect(calculateMetric(definition('dispatch_project_count'), rows)).toMatchObject({ value: 3 });
    expect(calculateMetric(definition('dispatch_assignment_count'), rows)).toMatchObject({ value: 3 });
    expect(calculateMetric(definition('open_project_count'), rows)).toMatchObject({ value: 3 });
    expect(calculateMetric(definition('group_open_count'), rows)).toMatchObject({ value: 2 });
  });

  it('keeps repeated project rows because every matching Excel row contributes to COUNTIFS', () => {
    expect(rows[0]?.rowId).not.toBe(rows[1]?.rowId);
    expect(rows[0]?.sourceProjectId).toBe(rows[1]?.sourceProjectId);
    expect(calculateMetric(definition('dispatch_project_count'), rows)).toMatchObject({ value: 3 });
    expect(calculateMetric(definition('online_pk_project_count'), rows)).toMatchObject({ value: 2 });
    expect(calculateMetric(definition('handshake_project_count'), rows)).toMatchObject({ value: 2 });
  });

  it('uses project date G for project metrics and assignment date H for group metrics', () => {
    const datedRows = [{
      ...rows[0]!, projectDate: '2026-08-01', assignmentDate: '2026-08-02',
      raw: { ...rows[0]!.raw, G: '2026/08/01', H: '2026/08/02' },
    }];

    expect(calculateMetric(definition('dispatch_project_count'), datedRows, '2026-08-01').value).toBe(1);
    expect(calculateMetric(definition('dispatch_project_count'), datedRows, '2026-08-02').value).toBe(0);
    expect(calculateMetric(definition('group_open_count'), datedRows, '2026-08-01').value).toBe(0);
    expect(calculateMetric(definition('group_open_count'), datedRows, '2026-08-02').value).toBe(1);
  });

  it('matches workbook signing columns AI and AK', () => {
    const signedRows = [{
      ...rows[0]!, signedDate: '2026-08-03', raw: { ...rows[0]!.raw, AI: '已收定', AK: '2026/08/03' },
    }, {
      ...rows[2]!, assignmentId: 'P2::M2', signedDate: '2026-08-03',
      raw: { ...rows[2]!.raw, AI: '否', AK: '2026/08/03' },
    }];

    expect(calculateMetric(definition('signed_project_count'), signedRows, '2026-08-03').value).toBe(1);
  });

  it('counts group sync rows on project date G without project deduplication', () => {
    expect(calculateMetric(definition('sync_detail_with_plan_count'), rows).value).toBe(1);
    expect(calculateMetric(definition('sync_no_detail_without_plan_count'), rows).value).toBe(1);
    expect(calculateMetric(definition('sync_detail_with_plan_rate'), rows)).toEqual({
      value: 33.3333, numerator: 1, denominator: 3,
    });
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
      raw: { S: '是', T: '是', AA: '是', AG: '是', AH: '是', AI: '已收定', AK: '2026/08/03', U: '还不错', X: '已辅导' },
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

