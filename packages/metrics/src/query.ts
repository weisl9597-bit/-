import { getPeriodBounds } from '@designbao/domain/period';
import { allMetricDefinitions } from './catalog';
import { rate } from './calculate';

export type MetricQuery = {
  metricIds: string[];
  grain: 'DAY' | 'WEEK' | 'MONTH';
  start: Date;
  end: Date;
  organizationIds: string[];
  merchantId?: string;
};

export type StoredDailyMetric = {
  metricId: string;
  periodStart: Date;
  organizationId: string;
  merchantId: string | null;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
};

export type MetricSeriesPoint = {
  periodStart: Date;
  periodEnd: Date;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
};

export type MetricSeries = { metricId: string; points: MetricSeriesPoint[] };

export type MetricQueryRepository = {
  listDaily(query: MetricQuery): Promise<StoredDailyMetric[]>;
};

export async function queryMetricSeries(
  query: MetricQuery,
  repository: MetricQueryRepository,
): Promise<MetricSeries[]> {
  const known = new Set(allMetricDefinitions.map((definition) => definition.id));
  const unknown = query.metricIds.find((id) => !known.has(id));
  if (unknown) throw new Error(`UNKNOWN_METRIC:${unknown}`);
  const definitions = new Map(allMetricDefinitions.map((definition) => [definition.id, definition]));
  const rows = await repository.listDaily(query);
  const buckets = new Map<string, StoredDailyMetric[]>();

  for (const row of rows) {
    const bounds = getPeriodBounds(row.periodStart, query.grain);
    const key = `${row.metricId}:${bounds.start.toISOString()}`;
    const values = buckets.get(key) ?? [];
    values.push(row);
    buckets.set(key, values);
  }

  return query.metricIds.map((metricId) => {
    const definition = definitions.get(metricId)!;
    const points = [...buckets]
      .filter(([key]) => key.startsWith(`${metricId}:`))
      .map(([, values]) => {
        const first = values[0]!;
        const bounds = getPeriodBounds(first.periodStart, query.grain);
        const numerator = values.reduce((sum, row) => sum + (row.numerator ?? 0), 0);
        const hasDenominator = values.some((row) => row.denominator !== null);
        const denominator = hasDenominator
          ? values.reduce((sum, row) => sum + (row.denominator ?? 0), 0)
          : null;
        const result = definition.unit === 'RATE'
          ? rate(numerator, denominator ?? 0)
          : { value: numerator, numerator, denominator: null };
        return { periodStart: bounds.start, periodEnd: bounds.end, ...result };
      })
      .sort((left, right) => left.periodStart.getTime() - right.periodStart.getTime());
    return { metricId, points };
  });
}
