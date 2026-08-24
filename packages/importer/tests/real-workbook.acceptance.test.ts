import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { parseWorkbook } from '../src/parse-workbook';
import { validateBatch } from '../src/validate-batch';
import {
  normalizeBusinessSource,
  type SelectableBusinessSource,
} from '../../domain/src/business-source';
import { metricCatalog } from '../../metrics/src/catalog';
import { calculateMetric, rate, type MetricRow } from '../../metrics/src/calculate';

const sourceFile = process.env.DESIGNBAO_SOURCE_XLSX;

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function workbookDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000)).toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(value.trim());
  return match?.[1] && match[2] && match[3]
    ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
    : null;
}

function yes(value: unknown): boolean | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (['是', '有', '已完成', '完成', '1', 'true'].includes(normalized)) return true;
  if (['否', '无', '未完成', '0', 'false'].includes(normalized)) return false;
  return null;
}

function toMetricRows(
  projects: Awaited<ReturnType<typeof parseWorkbook>>['projects'],
): MetricRow[] {
  return projects.map((record) => {
    const sourceProjectId = String(record.projectId ?? '').trim() || `row:${record.sourceRow}`;
    const merchantId = String(record.merchantId ?? '').trim();
    return {
      rowId: `row:${record.sourceRow}`,
      assignmentId: `${sourceProjectId}::${merchantId || `row:${record.sourceRow}`}`,
      sourceProjectId,
      organizationIds: ['national'],
      merchantId,
      dataDate: workbookDate(record.raw.H) ?? '2026-08-23',
      projectDate: workbookDate(record.raw.H),
      assignmentDate: workbookDate(record.raw.I),
      signedDate: workbookDate(record.raw.AL),
      assignmentCount: Number(record.raw.J) || 0,
      businessSource: normalizeBusinessSource(
        record.businessSourceRaw ?? record.category ?? record.raw.F,
      ),
      followWithin30m: yes(record.raw.N),
      needsAnalyzed: yes(record.raw.O),
      hardInvite: yes(record.raw.P),
      needsCoaching: null,
      coached: null,
      improved: null,
      raw: record.raw,
    };
  });
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function metricValue(
  rows: MetricRow[],
  input: { metricId: string; source: SelectableBusinessSource; start: string; end: string },
): number | null {
  const definition = metricCatalog.find((item) => item.id === input.metricId);
  if (!definition) throw new Error(`Unknown metric: ${input.metricId}`);
  const scopedRows = rows.filter((row) => input.source === 'ALL'
    ? row.businessSource !== 'OTHER'
    : row.businessSource === input.source);
  return datesBetween(input.start, input.end).reduce(
    (sum, date) => sum + (calculateMetric(definition, scopedRows, date).value ?? 0),
    0,
  );
}

describe.skipIf(!sourceFile)('supplied Designbao workbook', () => {
  it('reads only the two confirmed sheets and reports aggregate quality results', async () => {
    const parsed = await parseWorkbook(await readFile(sourceFile!));
    const validation = validateBatch(parsed);

    expect(parsed.sourceSheets).toEqual(['项目明细2', '工作表3']);
    expect(parsed.projects.length).toBeGreaterThan(0);
    expect(parsed.organizations.length).toBeGreaterThan(0);
    expect(validation.errors).not.toContainEqual(
      expect.objectContaining({ code: 'MISSING_ID' }),
    );
    expect(validation.warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNKNOWN_ORGANIZATION',
        field: 'city',
        rawValue: '张家港市',
      }),
    );

    const errorCounts = countBy(validation.errors, (item) => item.code);
    const warningCounts = countBy(validation.warnings, (item) => item.code);
    const errorFieldCounts = countBy(
      validation.errors,
      (item) => `${item.code}:${item.field}`,
    );
    const unknownCityCounts = countBy(
      validation.warnings.filter((item) => item.code === 'UNKNOWN_ORGANIZATION'),
      (item) => String(item.rawValue ?? ''),
    );
    console.info(
      JSON.stringify({
        parsedProjects: parsed.projects.length,
        acceptedRecords: validation.records.length,
        errors: errorCounts,
        warnings: warningCounts,
        errorFields: errorFieldCounts,
        unknownCities: unknownCityCounts,
        parsedZhangjiagangRows: parsed.projects.filter(
          (item) => String(item.city).trim() === '张家港市',
        ).map((item) => item.sourceRow),
      }),
    );
  });

  it('matches the 40 cached August values in 总数据（设计宝）', async () => {
    const parsed = await parseWorkbook(await readFile(sourceFile!));
    const allRows = toMetricRows(parsed.projects);
    const rows = allRows.filter((row) => row.businessSource === 'DESIGNBAO');
    const dates = Array.from(
      { length: 31 },
      (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`,
    );
    const actual = metricCatalog.map((definition) => {
      const daily = dates.map((date) => calculateMetric(definition, rows, date));
      const numerator = daily.reduce((sum, item) => sum + (item.numerator ?? 0), 0);
      const denominator = daily.some((item) => item.denominator !== null)
        ? daily.reduce((sum, item) => sum + (item.denominator ?? 0), 0)
        : null;
      return definition.unit === 'RATE'
        ? rate(numerator, denominator ?? 0).value
        : numerator;
    });

    expect(actual).toEqual([
      561, 817, 319, 421, 56.8627, 51.53, 34, 6.0606,
      39, 12.2257, 27, 8.4639, 6, 15.3846, 21, 18.8088,
      77.7778, 0, 0, 0, 0, 0, 455, 220, 31, 55.6916,
      26.9278, 3.7944, 122, 97, 128, 140, 21.7469, 24.9554,
      164, 148, 96, 64, 0, 38.9549,
    ]);

    const range = { start: '2026-08-01', end: '2026-08-23' };
    expect(metricValue(allRows, {
      metricId: 'dispatch_project_count',
      source: 'DESIGNBAO',
      ...range,
    })).toBe(561);

    const inRange = (row: MetricRow) => Boolean(
      row.projectDate && row.projectDate >= range.start && row.projectDate <= range.end,
    );
    const expectedXiaohongshu = allRows.filter(
      (row) => row.businessSource === 'XIAOHONGSHU' && inRange(row),
    ).length;
    const expectedAll = allRows.filter(
      (row) => row.businessSource !== 'OTHER' && inRange(row),
    ).length;
    expect(metricValue(allRows, {
      metricId: 'dispatch_project_count',
      source: 'XIAOHONGSHU',
      ...range,
    })).toBe(expectedXiaohongshu);
    expect(metricValue(allRows, {
      metricId: 'dispatch_project_count',
      source: 'ALL',
      ...range,
    })).toBe(expectedAll);
  });
});
