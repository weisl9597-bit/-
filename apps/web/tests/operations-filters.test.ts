import { describe, expect, it } from 'vitest';
import type { OrganizationScope } from '../lib/auth/scope';
import { parseOperationsFilter } from '../lib/queries/operations-filters';
import {
  resolveOperationsSelection,
  type OperationsScopeRepository,
} from '../lib/queries/operations-scope';

describe('shared operations filters', () => {
  it('parses source and cascading ids while defaulting source to Designbao', () => {
    expect(parseOperationsFilter(new URL('https://test/?source=ALL&regionId=r1&cityId=c1&merchantId=m1')))
      .toEqual({ source: 'ALL', regionId: 'r1', cityId: 'c1', merchantId: 'm1' });
    expect(parseOperationsFilter(new URL('https://test/'))).toEqual({ source: 'DESIGNBAO' });
    expect(() => parseOperationsFilter(new URL('https://test/?source=OTHER'))).toThrow('INVALID_BUSINESS_SOURCE');
  });

  it('rejects organizations and merchants outside the actor scope without widening', async () => {
    const repository: OperationsScopeRepository = {
      findOrganization: async (id) => ({
        id, level: id.startsWith('region') ? 'REGION' : 'CITY',
        parentId: id === 'city-1' ? 'region-1' : 'region-2',
      }),
      listCityIds: async (regionId) => regionId === 'region-1' ? ['city-1'] : ['city-outside'],
      findMerchant: async (id) => ({ id, organizationId: id === 'M1' ? 'city-1' : 'city-outside' }),
    };
    const cityScope: OrganizationScope = {
      role: 'CITY_MANAGER', organizationIds: ['city-1'], unrestricted: false,
    };
    await expect(resolveOperationsSelection(
      { source: 'DESIGNBAO', cityId: 'city-outside' }, cityScope, repository,
    )).rejects.toThrow('ORGANIZATION_OUT_OF_SCOPE');
    await expect(resolveOperationsSelection(
      { source: 'DESIGNBAO', cityId: 'city-1', merchantId: 'M2' }, cityScope, repository,
    )).rejects.toThrow('MERCHANT_OUT_OF_SCOPE');
    await expect(resolveOperationsSelection(
      { source: 'XIAOHONGSHU', regionId: 'region-1', cityId: 'city-1', merchantId: 'M1' },
      cityScope, repository,
    )).resolves.toEqual({
      source: 'XIAOHONGSHU', regionId: 'region-1', cityId: 'city-1', merchantId: 'M1',
      organizationIds: ['city-1'],
    });
  });
});

