import { db } from '@designbao/db/client';
import { metricCatalog } from '@designbao/metrics/catalog';
import {
  queryMetricSeries,
  type MetricQueryRepository,
  type StoredDailyMetric,
} from '@designbao/metrics/query';
import type { OrganizationScope } from '../auth/scope';
import type { OperationsFilter } from './operations-filters';
import {
  resolveOperationsSelection,
  type OperationsSelection,
} from './operations-scope';

export type MetricCenterQuery = {
  metricIds: string[];
  grain: 'DAY' | 'WEEK' | 'MONTH';
  start: Date;
  end: Date;
  merchantId?: string;
  regionId?: string;
  cityId?: string;
  source?: 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL';
};

export type ResolveMetricSelection = (
  filter: OperationsFilter,
  scope: OrganizationScope,
) => Promise<OperationsSelection>;

type LegacyMetricRow = {
  metricId: string;
  periodStart: Date;
  organizationId: string;
  merchantId: string | null;
  dimensionKey: string;
  businessSource: 'ALL' | 'OTHER' | 'DESIGNBAO' | 'XIAOHONGSHU';
  sourceBatchId: string;
  createdAt: Date;
  sourceBatch: { createdAt: Date };
};

export function selectLatestMetricFacts<T extends LegacyMetricRow>(
  rows: readonly T[],
  source: 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL',
): Array<{ row: T; businessSource: 'DESIGNBAO' | 'XIAOHONGSHU' }> {
  const candidates = rows.flatMap((row) => {
    if (row.businessSource === 'ALL') return [];
    const encoded = row.dimensionKey.match(/^source:(DESIGNBAO|XIAOHONGSHU)\|(.*)$/);
    const encodedSource = encoded?.[1];
    const businessSource: 'DESIGNBAO' | 'XIAOHONGSHU' = encodedSource === 'XIAOHONGSHU'
      ? 'XIAOHONGSHU'
      : encodedSource === 'DESIGNBAO'
        ? 'DESIGNBAO'
        : row.businessSource === 'XIAOHONGSHU' ? 'XIAOHONGSHU' : 'DESIGNBAO';
    if (source !== 'ALL' && businessSource !== source) return [];
    return [{
      row,
      businessSource,
      canonicalDimensionKey: encoded?.[2] ?? row.dimensionKey,
    }];
  }).sort((left, right) => (
    right.row.sourceBatch.createdAt.getTime() - left.row.sourceBatch.createdAt.getTime()
    || right.row.createdAt.getTime() - left.row.createdAt.getTime()
  ));

  const latest = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const key = [
      candidate.row.metricId,
      candidate.row.periodStart.toISOString(),
      candidate.row.organizationId,
      candidate.row.merchantId ?? '',
      candidate.businessSource,
      candidate.canonicalDimensionKey,
    ].join(':');
    if (!latest.has(key)) latest.set(key, candidate);
  }
  return [...latest.values()].map(({ row, businessSource }) => ({ row, businessSource }));
}

export function selectLegacyMetricFacts<T extends LegacyMetricRow>(
  rows: readonly T[],
  source: 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL',
): Array<{ row: T; businessSource: 'DESIGNBAO' | 'XIAOHONGSHU' }> {
  return selectLatestMetricFacts(rows, source);
}

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
        businessSource: { in: ['OTHER', 'DESIGNBAO', 'XIAOHONGSHU'] },
        sourceBatch: { status: 'SUCCEEDED' },
      },
      include: { sourceBatch: { select: { createdAt: true } } },
      orderBy: [{ sourceBatch: { createdAt: 'desc' } }, { createdAt: 'desc' }],
    });
    return selectLatestMetricFacts(rows, query.source).map(({ row, businessSource }) => ({
        metricId: row.metricId,
        businessSource,
        periodStart: row.periodStart,
        organizationId: row.organizationId,
        merchantId: row.merchantId,
        value: decimal(row.value),
        numerator: decimal(row.numerator),
        denominator: decimal(row.denominator),
    }));
  },
};

export const prismaLegacyMetricQueryRepository: MetricQueryRepository = {
  async listDaily(query): Promise<StoredDailyMetric[]> {
    let organizationIds = query.organizationIds;
    if (!query.merchantId && organizationIds.length > 0) {
      const scoped = await db.organization.findMany({
        where: { id: { in: organizationIds } },
        select: { id: true, level: true },
      });
      const aggregateLevel = scoped.some(({ level }) => level === 'REGION') ? 'REGION' : 'CITY';
      organizationIds = scoped.filter(({ level }) => level === aggregateLevel).map(({ id }) => id);
    } else if (!query.merchantId && organizationIds.length === 0) {
      const national = await db.organization.findMany({
        where: { level: 'NATIONAL' }, select: { id: true },
      });
      organizationIds = national.map(({ id }) => id);
      if (organizationIds.length === 0) {
        const regions = await db.organization.findMany({
          where: { level: 'REGION' }, select: { id: true },
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
        businessSource: { in: ['OTHER', 'DESIGNBAO', 'XIAOHONGSHU'] },
        sourceBatch: { status: 'SUCCEEDED' },
      },
      include: { sourceBatch: { select: { createdAt: true } } },
      orderBy: [{ sourceBatch: { createdAt: 'desc' } }, { createdAt: 'desc' }],
    });

    return selectLegacyMetricFacts(rows, query.source).map(({ row, businessSource }) => ({
          metricId: row.metricId,
          businessSource,
          periodStart: row.periodStart,
          organizationId: row.organizationId,
          merchantId: row.merchantId,
          value: decimal(row.value),
          numerator: decimal(row.numerator),
          denominator: decimal(row.denominator),
    }));
  },
};

export async function getMetricCenterData(
  query: MetricCenterQuery,
  scope: OrganizationScope,
  repository: MetricQueryRepository = prismaMetricQueryRepository,
  resolveSelection: ResolveMetricSelection = resolveOperationsSelection,
) {
  const selection = await resolveSelection({
    source: query.source ?? 'DESIGNBAO',
    ...(query.regionId ? { regionId: query.regionId } : {}),
    ...(query.cityId ? { cityId: query.cityId } : {}),
    ...(query.merchantId ? { merchantId: query.merchantId } : {}),
  }, scope);
  const series = await queryMetricSeries({
    ...query,
    source: selection.source,
    organizationIds: selection.organizationIds,
    merchantId: selection.merchantId,
  }, repository);
  return {
    catalog: metricCatalog,
    selectedCount: query.metricIds.length,
    displayMode: query.metricIds.length >= 9 ? 'MATRIX' as const : 'TREND' as const,
    series,
  };
}

export async function getMetricCenterDataForRollout(
  enabled: boolean,
  query: MetricCenterQuery,
  scope: OrganizationScope,
  dependencies: {
    repository?: MetricQueryRepository;
    legacyRepository?: MetricQueryRepository;
    resolveSelection?: ResolveMetricSelection;
  } = {},
) {
  return getMetricCenterData(
    query,
    scope,
    enabled
      ? dependencies.repository ?? prismaMetricQueryRepository
      : dependencies.legacyRepository ?? prismaLegacyMetricQueryRepository,
    dependencies.resolveSelection,
  );
}
