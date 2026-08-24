import { describe, expect, it } from 'vitest';
import type { OrganizationScope } from '../lib/auth/scope';
import {
  getDashboard,
  getDashboardForRollout,
  type DashboardRepository,
  type LegacyDashboardRepository,
} from '../lib/queries/dashboard';
import type { OperationsSelection } from '../lib/queries/operations-scope';
import type { OperationsFilter } from '../lib/queries/operations-filters';
import {
  getMetricCenterData,
  getMetricCenterDataForRollout,
  selectLegacyMetricFacts,
} from '../lib/queries/metrics';
import {
  aggregateLatestSopRates,
  listMerchants,
  listMerchantsForRollout,
  type LegacyMerchantListRepository,
  type MerchantListRepository,
} from '../lib/queries/merchants';
import {
  listProjects,
  listProjectsForRollout,
  type LegacyProjectListRepository,
  type ProjectListRepository,
} from '../lib/queries/projects';
import { parseMerchantRequest, parseMetricRequest, parseProjectRequest } from '../lib/queries/request';

const cityScope: OrganizationScope = {
  role: 'CITY_MANAGER', organizationIds: ['city-1'], unrestricted: false,
};

async function resolveMetricSelection(filter: OperationsFilter): Promise<OperationsSelection> {
  if (filter.cityId && filter.cityId !== 'city-1') throw new Error('ORGANIZATION_OUT_OF_SCOPE');
  if (filter.merchantId && filter.merchantId !== 'M1') throw new Error('MERCHANT_OUT_OF_SCOPE');
  return {
    ...filter,
    organizationIds: ['city-1'],
  };
}

describe('organization-scoped query contracts', () => {
  it('returns the dashboard contract and applies the server-side scope', async () => {
    let receivedSelection: OperationsSelection | undefined;
    const repository: DashboardRepository = {
      async load(selection) {
        receivedSelection = selection;
        return {
          dataDate: '2026-08-21', merchantTotal: 2,
          classifications: [
            { merchantId: 'M2', classification: 'B' },
            { merchantId: 'M3', classification: 'C_CANDIDATE' },
          ],
          projects: [
            { projectId: 'P1::M2', merchantId: 'M2', needsCoaching: true, coached: null, improved: false },
          ],
        };
      },
    };

    await expect(getDashboard(
      { source: 'XIAOHONGSHU', cityId: 'city-1' },
      cityScope,
      repository,
      async () => ({
        source: 'XIAOHONGSHU', cityId: 'city-1', organizationIds: ['city-1'],
      }),
    )).resolves.toMatchObject({
      dataDate: '2026-08-21',
      source: 'XIAOHONGSHU',
      summary: { merchantTotal: 2, abnormalProjects: 1, coachingDue: 1, unimproved: 1 },
      merchantStructure: { A: 0, B: 1, C_CANDIDATE: 1 },
      alerts: { coaching: [expect.any(Object)], improvement: [expect.any(Object)], projects: [expect.any(Object)] },
    });
    expect(receivedSelection).toMatchObject({
      source: 'XIAOHONGSHU', organizationIds: ['city-1'],
    });
  });

  it('keeps the legacy dashboard path until the source-aware rollout is enabled', async () => {
    let legacyLoads = 0;
    let sourceAwareLoads = 0;
    const facts = {
      dataDate: '2026-08-21', merchantTotal: 0, classifications: [], projects: [],
    };
    const legacyRepository: LegacyDashboardRepository = {
      load: async () => { legacyLoads += 1; return facts; },
    };
    const repository: DashboardRepository = {
      load: async () => { sourceAwareLoads += 1; return facts; },
    };
    const resolveSelection = async (): Promise<OperationsSelection> => ({
      source: 'XIAOHONGSHU', organizationIds: ['city-1'],
    });

    await getDashboardForRollout(
      false, { source: 'XIAOHONGSHU' }, cityScope,
      { repository, legacyRepository, resolveSelection },
    );
    expect(legacyLoads).toBe(1);
    expect(sourceAwareLoads).toBe(0);

    await getDashboardForRollout(
      true, { source: 'XIAOHONGSHU' }, cityScope,
      { repository, legacyRepository, resolveSelection },
    );
    expect(sourceAwareLoads).toBe(1);
  });

  it('lists merchants from the selected source and organization snapshot only', async () => {
    let receivedSelection: OperationsSelection | undefined;
    const repository: MerchantListRepository = {
      async list(query) {
        receivedSelection = query.selection;
        return {
          items: [{
            id: 'M1', name: '示例装饰', organizationId: 'city-1',
            classification: 'B', dataAvailable: true, sopRate: 55,
            projectCount: 3, lastAssignedAt: '2026-08-20T00:00:00.000Z',
          }],
          nextCursor: null,
        };
      },
    };
    const result = await listMerchants(
      { source: 'XIAOHONGSHU', cityId: 'city-1' },
      cityScope,
      repository,
      async () => ({ source: 'XIAOHONGSHU', cityId: 'city-1', organizationIds: ['city-1'] }),
    );
    expect(receivedSelection).toMatchObject({ source: 'XIAOHONGSHU', organizationIds: ['city-1'] });
    expect(result.items[0]).toMatchObject({
      id: 'M1', classification: 'B', dataAvailable: true,
      projectCount: 3, sopRate: 55,
      lastAssignedAt: '2026-08-20T00:00:00.000Z',
    });
    expect(result.items.map((item) => item.id)).not.toContain('M-DESIGNBAO-ONLY');
  });

  it('combines merchant ALL-source SOP rates from numerator and denominator facts', () => {
    const rates = aggregateLatestSopRates([
      {
        merchantId: 'M1', businessSource: 'DESIGNBAO', periodStart: new Date('2026-08-21'),
        value: 50, numerator: 1, denominator: 2,
      },
      {
        merchantId: 'M1', businessSource: 'XIAOHONGSHU', periodStart: new Date('2026-08-21'),
        value: 100, numerator: 8, denominator: 8,
      },
      {
        merchantId: 'M1', businessSource: 'DESIGNBAO', periodStart: new Date('2026-08-20'),
        value: 0, numerator: 0, denominator: 10,
      },
    ]);
    expect(rates.get('M1')).toBe(90);
  });

  it('uses legacy merchant data only while source-aware rollout is disabled', async () => {
    let legacyLoads = 0;
    let sourceAwareLoads = 0;
    const empty = { items: [], nextCursor: null };
    const legacyRepository: LegacyMerchantListRepository = {
      list: async () => { legacyLoads += 1; return empty; },
    };
    const repository: MerchantListRepository = {
      list: async () => { sourceAwareLoads += 1; return empty; },
    };
    const resolveSelection = async (): Promise<OperationsSelection> => ({
      source: 'XIAOHONGSHU', organizationIds: ['city-1'],
    });
    await listMerchantsForRollout(false, { source: 'XIAOHONGSHU' }, cityScope, {
      repository, legacyRepository, resolveSelection,
    });
    expect(legacyLoads).toBe(1);
    expect(sourceAwareLoads).toBe(0);
    await listMerchantsForRollout(true, { source: 'XIAOHONGSHU' }, cityScope, {
      repository, legacyRepository, resolveSelection,
    });
    expect(sourceAwareLoads).toBe(1);
  });

  it('lists latest project snapshots with merchant names and actual sources', async () => {
    let receivedSelection: OperationsSelection | undefined;
    const repository: ProjectListRepository = {
      list: async (query) => {
        receivedSelection = query.selection;
        return {
          items: [{
            id: 'P1::M1', sourceProjectId: 'P1', merchantId: 'M1',
            merchantName: '示例装饰', organizationId: 'city-1',
            businessSource: 'DESIGNBAO', dataDate: '2026-08-20',
            assignedAt: '2026-08-20T00:00:00.000Z',
            needsCoaching: true, coached: null, improved: false,
          }],
          nextCursor: null,
        };
      },
    };
    const result = await listProjects(
      { source: 'DESIGNBAO', cityId: 'city-1' }, cityScope, repository,
      async () => ({ source: 'DESIGNBAO', cityId: 'city-1', organizationIds: ['city-1'] }),
    );
    expect(receivedSelection).toMatchObject({ source: 'DESIGNBAO', organizationIds: ['city-1'] });
    expect(result.items[0]).toMatchObject({
      id: 'P1::M1', merchantId: 'M1', merchantName: '示例装饰',
      businessSource: 'DESIGNBAO', assignedAt: '2026-08-20T00:00:00.000Z',
    });
  });

  it('uses legacy project data only while source-aware rollout is disabled', async () => {
    let legacyLoads = 0;
    let sourceAwareLoads = 0;
    const empty = { items: [], nextCursor: null };
    const legacyRepository: LegacyProjectListRepository = {
      list: async () => { legacyLoads += 1; return empty; },
    };
    const repository: ProjectListRepository = {
      list: async () => { sourceAwareLoads += 1; return empty; },
    };
    const resolveSelection = async (): Promise<OperationsSelection> => ({
      source: 'XIAOHONGSHU', organizationIds: ['city-1'],
    });
    await listProjectsForRollout(false, { source: 'XIAOHONGSHU' }, cityScope, {
      repository, legacyRepository, resolveSelection,
    });
    expect(legacyLoads).toBe(1);
    expect(sourceAwareLoads).toBe(0);
    await listProjectsForRollout(true, { source: 'XIAOHONGSHU' }, cityScope, {
      repository, legacyRepository, resolveSelection,
    });
    expect(sourceAwareLoads).toBe(1);
  });

  it('returns numerator and denominator and rejects unknown metric IDs', async () => {
    const repository = {
      async listDaily() {
        return [{
          metricId: 'project_open_rate', periodStart: new Date('2026-08-21T00:00:00Z'),
          organizationId: 'city-1', merchantId: null, businessSource: 'DESIGNBAO' as const,
          value: 50, numerator: 1, denominator: 2,
        }];
      },
    };
    await expect(getMetricCenterData({
      metricIds: ['project_open_rate'], grain: 'DAY',
      start: new Date('2026-08-21T00:00:00Z'), end: new Date('2026-08-21T23:59:59Z'),
      source: 'DESIGNBAO', cityId: 'city-1',
    }, cityScope, repository, resolveMetricSelection)).resolves.toMatchObject({
      selectedCount: 1,
      series: [{ metricId: 'project_open_rate', points: [{ value: 50, numerator: 1, denominator: 2 }] }],
    });
    await expect(getMetricCenterData({
      metricIds: ['not-a-metric'], grain: 'DAY', start: new Date(), end: new Date(),
    }, cityScope, repository, resolveMetricSelection)).rejects.toThrow('UNKNOWN_METRIC:not-a-metric');
    await expect(getMetricCenterData({
      metricIds: ['project_open_rate'], grain: 'DAY', start: new Date(), end: new Date(),
      cityId: 'city-2', source: 'DESIGNBAO',
    }, cityScope, repository, resolveMetricSelection)).rejects.toThrow('ORGANIZATION_OUT_OF_SCOPE');
  });

  it('resolves metric region, city and merchant filters through the shared scope boundary', async () => {
    let receivedFilter: unknown;
    let receivedQuery: unknown;
    const repository = {
      async listDaily(query: unknown) { receivedQuery = query; return []; },
    };
    await getMetricCenterData({
      metricIds: ['dispatch_project_count'], grain: 'DAY',
      start: new Date('2026-08-21'), end: new Date('2026-08-21'),
      source: 'XIAOHONGSHU', regionId: 'region-1', cityId: 'city-1', merchantId: 'M1',
    }, cityScope, repository, async (filter) => {
      receivedFilter = filter;
      return {
        source: 'XIAOHONGSHU', regionId: 'region-1', cityId: 'city-1', merchantId: 'M1',
        organizationIds: ['city-1'],
      };
    });
    expect(receivedFilter).toEqual({
      source: 'XIAOHONGSHU', regionId: 'region-1', cityId: 'city-1', merchantId: 'M1',
    });
    expect(receivedQuery).toMatchObject({
      source: 'XIAOHONGSHU', organizationIds: ['city-1'], merchantId: 'M1',
    });
  });

  it('combines ALL-source rates from facts rather than averaging displayed percentages', async () => {
    const repository = {
      async listDaily() {
        const periodStart = new Date('2026-08-21T00:00:00Z');
        return [
          { metricId: 'project_open_rate', periodStart, organizationId: 'city-1', merchantId: null,
            businessSource: 'DESIGNBAO' as const, value: 50, numerator: 1, denominator: 2 },
          { metricId: 'project_open_rate', periodStart, organizationId: 'city-1', merchantId: null,
            businessSource: 'XIAOHONGSHU' as const, value: 100, numerator: 8, denominator: 8 },
        ];
      },
    };

    await expect(getMetricCenterData({
      metricIds: ['project_open_rate'], grain: 'DAY',
      start: new Date('2026-08-21T00:00:00Z'), end: new Date('2026-08-21T23:59:59Z'),
      source: 'ALL', cityId: 'city-1',
    }, cityScope, repository, resolveMetricSelection)).resolves.toMatchObject({
      series: [{ points: [{ value: 90, numerator: 9, denominator: 10 }] }],
    });
  });

  it('keeps metric reads on the legacy repository until source-aware rollout is enabled', async () => {
    let legacyLoads = 0;
    let sourceAwareLoads = 0;
    let legacySource: string | undefined;
    const point = {
      metricId: 'dispatch_project_count', periodStart: new Date('2026-08-21T00:00:00Z'),
      organizationId: 'city-1', merchantId: null, businessSource: 'DESIGNBAO' as const,
      value: 1, numerator: 1, denominator: null,
    };
    const legacyRepository = {
      listDaily: async (received: { source: string }) => {
        legacyLoads += 1;
        legacySource = received.source;
        return [point];
      },
    };
    const repository = {
      listDaily: async () => { sourceAwareLoads += 1; return [point]; },
    };
    const query = {
      metricIds: ['dispatch_project_count'], grain: 'DAY' as const,
      start: new Date('2026-08-21T00:00:00Z'), end: new Date('2026-08-21T23:59:59Z'),
      source: 'XIAOHONGSHU' as const, cityId: 'city-1',
    };

    await getMetricCenterDataForRollout(false, query, cityScope, {
      repository, legacyRepository, resolveSelection: resolveMetricSelection,
    });
    expect(legacyLoads).toBe(1);
    expect(sourceAwareLoads).toBe(0);
    expect(legacySource).toBe('XIAOHONGSHU');

    await getMetricCenterDataForRollout(true, query, cityScope, {
      repository, legacyRepository, resolveSelection: resolveMetricSelection,
    });
    expect(sourceAwareLoads).toBe(1);
  });

  it('canonicalizes legacy source dimensions and chooses one newest row per logical source', () => {
    const common = {
      metricId: 'dispatch_project_count', periodStart: new Date('2026-08-21'),
      organizationId: 'city-1', merchantId: null, createdAt: new Date('2026-08-21T12:00:00Z'),
    };
    const facts = selectLegacyMetricFacts([
      {
        ...common, dimensionKey: 'source:DESIGNBAO|organization', businessSource: 'DESIGNBAO' as const,
        sourceBatchId: 'old', sourceBatch: { createdAt: new Date('2026-08-21T12:00:00Z') }, value: 561,
      },
      {
        ...common, dimensionKey: 'organization', businessSource: 'DESIGNBAO' as const,
        sourceBatchId: 'new', sourceBatch: { createdAt: new Date('2026-08-21T13:00:00Z') }, value: 587,
      },
      {
        ...common, dimensionKey: 'source:XIAOHONGSHU|organization', businessSource: 'OTHER' as const,
        sourceBatchId: 'xhs', sourceBatch: { createdAt: new Date('2026-08-21T12:30:00Z') }, value: 26,
      },
    ], 'ALL');

    expect(facts).toHaveLength(2);
    expect(facts.map(({ row, businessSource }) => [businessSource, row.value])).toEqual([
      ['DESIGNBAO', 587], ['XIAOHONGSHU', 26],
    ]);
  });

  it('uses cursor pagination and caps the page size at 200', async () => {
    let merchantLimit = 0;
    let projectLimit = 0;
    const merchantRepository: MerchantListRepository = {
      list: async (query) => { merchantLimit = query.limit; return { items: [], nextCursor: null }; },
    };
    const projectRepository: ProjectListRepository = {
      list: async (query) => { projectLimit = query.limit; return { items: [], nextCursor: null }; },
    };

    await listMerchants({ limit: 999, cursor: 'M10' }, cityScope, merchantRepository);
    await listProjects({ limit: 999, cursor: 'P10' }, cityScope, projectRepository);
    expect(merchantLimit).toBe(200);
    expect(projectLimit).toBe(200);
  });

  it('validates URL filters before they reach a database query', () => {
    expect(parseMetricRequest(new URL(
      'https://example.test/api/metrics?metricIds=project_open_rate,dispatch_project_count&grain=WEEK&start=2026-08-01&end=2026-08-21&source=XIAOHONGSHU&regionId=region-1&cityId=city-1&merchantId=M1',
    ))).toMatchObject({
      metricIds: ['project_open_rate', 'dispatch_project_count'], grain: 'WEEK',
      source: 'XIAOHONGSHU', regionId: 'region-1', cityId: 'city-1', merchantId: 'M1',
    });
    expect(parseMetricRequest(new URL(
      'https://example.test/api/metrics?metricIds=project_open_rate',
    ))).toMatchObject({ source: 'DESIGNBAO' });
    expect(() => parseMetricRequest(new URL(
      'https://example.test/api/metrics?metricIds=project_open_rate&grain=YEAR',
    ))).toThrow();
    expect(parseMerchantRequest(new URL('https://example.test/api/merchants?limit=25&classification=B')))
      .toMatchObject({ limit: 25, classification: 'B' });
    expect(parseProjectRequest(new URL('https://example.test/api/projects?abnormal=true&coached=blank')))
      .toMatchObject({ abnormal: true, coached: null });
  });
});
