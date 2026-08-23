import { describe, expect, it } from 'vitest';
import type { OrganizationScope } from '../lib/auth/scope';
import {
  getMetricFilterOptions,
  type MetricFilterRepository,
} from '../lib/queries/metric-filters';

const organizations = [
  { id: 'region-1', name: '华南大区', level: 'REGION' as const, parentId: null, path: '/china/south' },
  { id: 'city-1', name: '广州市', level: 'CITY' as const, parentId: 'region-1', path: '/china/south/guangzhou' },
  { id: 'region-2', name: '华东大区', level: 'REGION' as const, parentId: null, path: '/china/east' },
  { id: 'city-2', name: '杭州市', level: 'CITY' as const, parentId: 'region-2', path: '/china/east/hangzhou' },
];

const repository: MetricFilterRepository = {
  load: async () => ({
    organizations,
    merchants: [
      { id: 'M1', name: '广州一号装饰', organizationId: 'city-1' },
      { id: 'M2', name: '杭州一号装饰', organizationId: 'city-2' },
    ],
  }),
};

describe('metric organization filters', () => {
  it('returns all cascading options to an administrator', async () => {
    const scope: OrganizationScope = { role: 'ADMIN', organizationIds: [], unrestricted: true };
    await expect(getMetricFilterOptions(scope, repository)).resolves.toMatchObject({
      regions: expect.arrayContaining([
        expect.objectContaining({ id: 'region-2' }),
        expect.objectContaining({ id: 'region-1' }),
      ]),
      cities: expect.arrayContaining([
        expect.objectContaining({ id: 'city-1', parentId: 'region-1' }),
        expect.objectContaining({ id: 'city-2', parentId: 'region-2' }),
      ]),
      merchants: expect.arrayContaining([
        expect.objectContaining({ id: 'M1', organizationId: 'city-1' }),
        expect.objectContaining({ id: 'M2', organizationId: 'city-2' }),
      ]),
    });
  });

  it('does not expose organizations or merchants outside a city manager scope', async () => {
    const scope: OrganizationScope = { role: 'CITY_MANAGER', organizationIds: ['city-1'], unrestricted: false };
    await expect(getMetricFilterOptions(scope, repository)).resolves.toEqual({
      regions: [{ id: 'region-1', name: '华南大区' }],
      cities: [{ id: 'city-1', name: '广州市', parentId: 'region-1' }],
      merchants: [{ id: 'M1', name: '广州一号装饰', organizationId: 'city-1' }],
    });
  });
});
