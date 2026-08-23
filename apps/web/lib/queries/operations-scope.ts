import { db } from '@designbao/db/client';
import type { SelectableBusinessSource } from '@designbao/domain/business-source';
import type { OrganizationScope } from '../auth/scope';
import type { OperationsFilter } from './operations-filters';

type FilterOrganization = { id: string; level: 'REGION' | 'CITY'; parentId: string | null };
type FilterMerchant = { id: string; organizationId: string };

export type OperationsScopeRepository = {
  findOrganization(id: string): Promise<FilterOrganization | null>;
  listCityIds(regionId: string): Promise<string[]>;
  findMerchant(id: string): Promise<FilterMerchant | null>;
};

export type OperationsSelection = {
  source: SelectableBusinessSource;
  regionId?: string;
  cityId?: string;
  merchantId?: string;
  organizationIds: string[];
};

export const prismaOperationsScopeRepository: OperationsScopeRepository = {
  async findOrganization(id) {
    const row = await db.organization.findUnique({
      where: { id }, select: { id: true, level: true, parentId: true },
    });
    return row && (row.level === 'REGION' || row.level === 'CITY')
      ? { ...row, level: row.level }
      : null;
  },
  async listCityIds(regionId) {
    const rows = await db.organization.findMany({
      where: { parentId: regionId, level: 'CITY' }, select: { id: true },
    });
    return rows.map((row) => row.id);
  },
  async findMerchant(id) {
    return db.merchant.findUnique({ where: { id }, select: { id: true, organizationId: true } });
  },
};

export async function resolveOperationsSelection(
  filter: OperationsFilter,
  scope: OrganizationScope,
  repository: OperationsScopeRepository = prismaOperationsScopeRepository,
): Promise<OperationsSelection> {
  const [region, city, merchant] = await Promise.all([
    filter.regionId ? repository.findOrganization(filter.regionId) : null,
    filter.cityId ? repository.findOrganization(filter.cityId) : null,
    filter.merchantId ? repository.findMerchant(filter.merchantId) : null,
  ]);
  if (filter.regionId && (!region || region.level !== 'REGION')) {
    throw new Error('ORGANIZATION_OUT_OF_SCOPE');
  }
  if (filter.cityId && (!city || city.level !== 'CITY')) {
    throw new Error('ORGANIZATION_OUT_OF_SCOPE');
  }
  if (region && city && city.parentId !== region.id) {
    throw new Error('ORGANIZATION_OUT_OF_SCOPE');
  }
  const regionCityIds = region ? await repository.listCityIds(region.id) : [];
  let organizationIds = city ? [city.id] : region ? regionCityIds
    : scope.unrestricted ? [] : scope.organizationIds;
  if (!scope.unrestricted) {
    const allowed = new Set(scope.organizationIds);
    if (organizationIds.some((id) => !allowed.has(id))) {
      throw new Error('ORGANIZATION_OUT_OF_SCOPE');
    }
  }
  if (filter.merchantId && !merchant) throw new Error('MERCHANT_OUT_OF_SCOPE');
  if (merchant) {
    const validMembership = (!city || merchant.organizationId === city.id)
      && (!region || regionCityIds.includes(merchant.organizationId));
    const allowed = scope.unrestricted || scope.organizationIds.includes(merchant.organizationId);
    if (!validMembership || !allowed) throw new Error('MERCHANT_OUT_OF_SCOPE');
    organizationIds = [merchant.organizationId];
  }
  return {
    source: filter.source,
    ...(region ? { regionId: region.id } : {}),
    ...(city ? { cityId: city.id } : {}),
    ...(merchant ? { merchantId: merchant.id } : {}),
    organizationIds,
  };
}

