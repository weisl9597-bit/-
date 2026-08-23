import { db } from '@designbao/db/client';
import type { SelectableBusinessSource } from '@designbao/domain/business-source';
import type { OrganizationScope } from '../auth/scope';
import type { BusinessSourceRebuildStatus } from './rebuild-status';

export type OperationsFilter = {
  source: SelectableBusinessSource;
  regionId?: string;
  cityId?: string;
  merchantId?: string;
};

export type OperationsFilterOptions = {
  enabled: boolean;
  regions: Array<{ id: string; name: string }>;
  cities: Array<{ id: string; name: string; parentId: string }>;
  merchants: Array<{ id: string; name: string; organizationId: string }>;
  rebuildStatus: BusinessSourceRebuildStatus;
};

export function parseOperationsFilter(url: URL): OperationsFilter {
  const requestedSource = url.searchParams.get('source') ?? 'DESIGNBAO';
  if (!['DESIGNBAO', 'XIAOHONGSHU', 'ALL'].includes(requestedSource)) {
    throw new Error('INVALID_BUSINESS_SOURCE');
  }
  const optional = (name: string) => url.searchParams.get(name)?.trim() || undefined;
  return {
    source: requestedSource as SelectableBusinessSource,
    regionId: optional('regionId'),
    cityId: optional('cityId'),
    merchantId: optional('merchantId'),
  };
}

export type OperationsFilterRepository = {
  load(source: SelectableBusinessSource): Promise<{
    organizations: Array<{
      id: string; name: string; level: 'REGION' | 'CITY'; parentId: string | null;
    }>;
    merchants: Array<{ id: string; name: string; organizationId: string }>;
  }>;
};

export const prismaOperationsFilterRepository: OperationsFilterRepository = {
  async load(source) {
    const batch = await db.uploadBatch.findFirst({
      where: { status: 'SUCCEEDED' },
      orderBy: [{ dataDate: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });
    if (!batch) return { organizations: [], merchants: [] };
    const snapshots = await db.projectSnapshot.findMany({
      where: {
        uploadBatchId: batch.id,
        businessSource: source === 'ALL'
          ? { in: ['DESIGNBAO', 'XIAOHONGSHU'] }
          : source,
      },
      select: { organizationId: true, merchantId: true },
    });
    const cityIds = [...new Set(snapshots.map((row) => row.organizationId))];
    const cities = await db.organization.findMany({
      where: { id: { in: cityIds }, level: 'CITY' },
      select: { id: true, name: true, level: true, parentId: true },
    });
    const regionIds = [...new Set(cities.map((city) => city.parentId).filter((id): id is string => Boolean(id)))];
    const regions = await db.organization.findMany({
      where: { id: { in: regionIds }, level: 'REGION' },
      select: { id: true, name: true, level: true, parentId: true },
    });
    const merchants = await db.merchant.findMany({
      where: { id: { in: [...new Set(snapshots.map((row) => row.merchantId))] }, active: true },
      select: { id: true, name: true, organizationId: true },
    });
    return {
      organizations: [...regions, ...cities] as Array<{
        id: string; name: string; level: 'REGION' | 'CITY'; parentId: string | null;
      }>,
      merchants,
    };
  },
};

function byName<T extends { name: string }>(left: T, right: T) {
  return left.name.localeCompare(right.name, 'zh-CN');
}

export async function getOperationsFilterOptions(
  source: SelectableBusinessSource,
  scope: OrganizationScope,
  repository: OperationsFilterRepository = prismaOperationsFilterRepository,
) {
  const loaded = await repository.load(source);
  const scopeIds = new Set(scope.organizationIds);
  const cities = loaded.organizations.filter((organization) => (
    organization.level === 'CITY' && (scope.unrestricted || scopeIds.has(organization.id))
  ));
  const cityIds = new Set(cities.map((city) => city.id));
  const parentRegionIds = new Set(cities.map((city) => city.parentId).filter(Boolean));
  const regions = loaded.organizations.filter((organization) => (
    organization.level === 'REGION'
      && (scope.unrestricted || scopeIds.has(organization.id) || parentRegionIds.has(organization.id))
  ));
  return {
    regions: regions.map(({ id, name }) => ({ id, name })).sort(byName),
    cities: cities.map(({ id, name, parentId }) => ({ id, name, parentId: parentId! })).sort(byName),
    merchants: loaded.merchants
      .filter((merchant) => cityIds.has(merchant.organizationId))
      .sort(byName),
  };
}

