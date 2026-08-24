import type { ActualBusinessSource, SelectableBusinessSource } from '@designbao/domain/business-source';
import { getPeriodBounds } from '@designbao/domain/period';
import { allMetricDefinitions } from './catalog';
import { calculateMetric, rate, type MetricRow } from './calculate';

export type MetricQuery = {
  metricIds: string[];
  grain: 'DAY' | 'WEEK' | 'MONTH';
  start: Date;
  end: Date;
  organizationIds: string[];
  merchantId?: string;
  source: SelectableBusinessSource;
};

export type StoredDailyMetric = {
  metricId: string;
  businessSource: ActualBusinessSource;
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

export type LatestUploadMetricRowsSource = {
  loadLatestRows(): Promise<MetricRow[]>;
};

function datesBetween(start: Date, end: Date): Date[] {
  const current = new Date(Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
  ));
  const last = new Date(Date.UTC(
    end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(),
  ));
  const dates: Date[] = [];
  while (current <= last) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function createLatestUploadMetricQueryRepository(
  source: LatestUploadMetricRowsSource,
): MetricQueryRepository {
  return {
    async listDaily(query): Promise<StoredDailyMetric[]> {
      const rows = await source.loadLatestRows();
      const definitions = new Map(allMetricDefinitions.map((definition) => [definition.id, definition]));
      const sources: ActualBusinessSource[] = query.source === 'ALL'
        ? ['DESIGNBAO', 'XIAOHONGSHU']
        : [query.source];
      const organizationId = query.organizationIds.at(-1) ?? 'latest-upload';
      const facts: StoredDailyMetric[] = [];

      for (const periodStart of datesBetween(query.start, query.end)) {
        const periodDate = periodStart.toISOString().slice(0, 10);
        for (const businessSource of sources) {
          const scopedRows = rows.filter((row) => (
            row.businessSource === businessSource
            && (query.organizationIds.length === 0
              || query.organizationIds.some((id) => row.organizationIds.includes(id)))
            && (!query.merchantId || row.merchantId === query.merchantId)
          ));
          for (const metricId of query.metricIds) {
            const definition = definitions.get(metricId);
            if (!definition) continue;
            const result = calculateMetric(definition, scopedRows, periodDate);
            facts.push({
              metricId,
              businessSource,
              periodStart,
              organizationId,
              merchantId: query.merchantId ?? null,
              ...result,
            });
          }
        }
      }
      return facts;
    },
  };
}

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

