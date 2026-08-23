import { db } from '@designbao/db/client';
import type { OrganizationScope } from '../auth/scope';

export type MetricFilterOrganization = {
  id: string;
  name: string;
  level: 'REGION' | 'CITY';
  parentId: string | null;
  path: string;
};

export type MetricFilterMerchant = {
  id: string;
  name: string;
  organizationId: string;
};

export type MetricFilterRepository = {
  load(): Promise<{
    organizations: MetricFilterOrganization[];
    merchants: MetricFilterMerchant[];
  }>;
};

export const prismaMetricFilterRepository: MetricFilterRepository = {
  async load() {
    const [organizations, merchants] = await Promise.all([
      db.organization.findMany({
        where: { level: { in: ['REGION', 'CITY'] } },
        select: { id: true, name: true, level: true, parentId: true, path: true },
        orderBy: { path: 'asc' },
      }),
      db.merchant.findMany({
        where: { active: true },
        select: { id: true, name: true, organizationId: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      organizations: organizations as MetricFilterOrganization[],
      merchants,
    };
  },
};

function byName<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name, 'zh-CN');
}

export async function getMetricFilterOptions(
  scope: OrganizationScope,
  repository: MetricFilterRepository = prismaMetricFilterRepository,
) {
  const source = await repository.load();
  const scopeIds = new Set(scope.organizationIds);
  const cities = source.organizations.filter((organization) =>
    organization.level === 'CITY'
    && (scope.unrestricted || scopeIds.has(organization.id)),
  );
  const cityIds = new Set(cities.map(({ id }) => id));
  const regionIdsForCities = new Set(cities.map(({ parentId }) => parentId).filter(Boolean));
  const regions = source.organizations.filter((organization) =>
    organization.level === 'REGION'
    && (scope.unrestricted || scopeIds.has(organization.id) || regionIdsForCities.has(organization.id)),
  );

  return {
    regions: regions.map(({ id, name }) => ({ id, name })).sort(byName),
    cities: cities.map(({ id, name, parentId }) => ({ id, name, parentId: parentId! })).sort(byName),
    merchants: source.merchants
      .filter((merchant) => scope.unrestricted || cityIds.has(merchant.organizationId))
      .map(({ id, name, organizationId }) => ({ id, name, organizationId }))
      .sort(byName),
  };
}
