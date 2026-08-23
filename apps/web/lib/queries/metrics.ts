import { db } from '@designbao/db/client';
import { metricCatalog } from '@designbao/metrics/catalog';
import {
  queryMetricSeries,
  type MetricQueryRepository,
  type StoredDailyMetric,
} from '@designbao/metrics/query';
import type { OrganizationScope } from '../auth/scope';

export type MetricCenterQuery = {
  metricIds: string[];
  grain: 'DAY' | 'WEEK' | 'MONTH';
  start: Date;
  end: Date;
  merchantId?: string;
  organizationId?: string;
  source?: 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL';
};

function decimal(value: { toNumber(): number } | null): number | null {
  return value === null ? null : value.toNumber();
}

export const prismaMetricQueryRepository: MetricQueryRepository = {
  async listDaily(query): Promise<StoredDailyMetric[]> {
    let organizationIds = query.organizationIds;
    if (query.merchantId) {
      organizationIds = query.organizationIds;
    } else if (organizationIds.length > 0) {
      const scoped = await db.organization.findMany({
        where: { id: { in: organizationIds } },
        select: { id: true, level: true },
      });
      const aggregateLevel = scoped.some(({ level }) => level === 'REGION') ? 'REGION' : 'CITY';
      organizationIds = scoped.filter(({ level }) => level === aggregateLevel).map(({ id }) => id);
    } else {
      const national = await db.organization.findMany({
        where: { level: 'NATIONAL' },
        select: { id: true },
      });
      organizationIds = national.map(({ id }) => id);
      if (organizationIds.length === 0) {
        const regions = await db.organization.findMany({
          where: { level: 'REGION' },
          select: { id: true },
        });
        organizationIds = regions.map(({ id }) => id);
      }
    }
    const rows = await db.metricSnapshot.findMany({
      where: {
        metricId: { in: query.metricIds },
        grain: 'DAY',
        periodStart: { gte: query.start, lte: query.end },
        organizationId: organizationIds.length > 0 ? { in: organizationIds } : undefined,
        merchantId: query.merchantId,
        businessSource: query.source === 'ALL'
          ? { in: ['DESIGNBAO', 'XIAOHONGSHU'] }
          : query.source,
        sourceBatch: { status: 'SUCCEEDED' },
      },
      include: { sourceBatch: { select: { createdAt: true } } },
      orderBy: [{ sourceBatch: { createdAt: 'desc' } }, { createdAt: 'desc' }],
    });
    const latest = new Map<string, StoredDailyMetric>();
    for (const row of rows) {
      if (row.businessSource === 'ALL') continue;
      const key = [
        row.metricId,
        row.periodStart.toISOString(),
        row.organizationId,
        row.merchantId ?? '',
        row.businessSource,
        row.dimensionKey,
      ].join(':');
      if (latest.has(key)) continue;
      latest.set(key, {
        metricId: row.metricId,
        businessSource: row.businessSource,
        periodStart: row.periodStart,
        organizationId: row.organizationId,
        merchantId: row.merchantId,
        value: decimal(row.value),
        numerator: decimal(row.numerator),
        denominator: decimal(row.denominator),
      });
    }
    return [...latest.values()];
  },
};

export async function getMetricCenterData(
  query: MetricCenterQuery,
  scope: OrganizationScope,
  repository: MetricQueryRepository = prismaMetricQueryRepository,
) {
  if (
    query.organizationId
    && !scope.unrestricted
    && !scope.organizationIds.includes(query.organizationId)
  ) {
    throw new Error('ORGANIZATION_OUT_OF_SCOPE');
  }
  const series = await queryMetricSeries({
    ...query,
    source: query.source ?? 'DESIGNBAO',
    organizationIds: query.organizationId
      ? [query.organizationId]
      : scope.unrestricted ? [] : scope.organizationIds,
  }, repository);
  return {
    catalog: metricCatalog,
    selectedCount: query.metricIds.length,
    displayMode: query.metricIds.length >= 9 ? 'MATRIX' as const : 'TREND' as const,
    series,
  };
}

