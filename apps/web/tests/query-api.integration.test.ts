import { describe, expect, it } from 'vitest';
import type { OrganizationScope } from '../lib/auth/scope';
import { getDashboard, type DashboardRepository } from '../lib/queries/dashboard';
import { getMetricCenterData } from '../lib/queries/metrics';
import { listMerchants, type MerchantListRepository } from '../lib/queries/merchants';
import { listProjects, type ProjectListRepository } from '../lib/queries/projects';
import { parseMerchantRequest, parseMetricRequest, parseProjectRequest } from '../lib/queries/request';

const cityScope: OrganizationScope = {
  role: 'CITY_MANAGER', organizationIds: ['city-1'], unrestricted: false,
};

describe('organization-scoped query contracts', () => {
  it('returns the dashboard contract and applies the server-side scope', async () => {
    let receivedScope: OrganizationScope | undefined;
    const repository: DashboardRepository = {
      async load(scope) {
        receivedScope = scope;
        return {
          dataDate: '2026-08-21', merchantTotal: 3,
          classifications: [
            { merchantId: 'M1', classification: 'A' },
            { merchantId: 'M2', classification: 'B' },
            { merchantId: 'M3', classification: 'C_CANDIDATE' },
          ],
          projects: [
            { projectId: 'P1::M2', merchantId: 'M2', needsCoaching: true, coached: null, improved: false },
          ],
        };
      },
    };

    await expect(getDashboard(cityScope, repository)).resolves.toMatchObject({
      dataDate: '2026-08-21',
      summary: { merchantTotal: 3, abnormalProjects: 1, coachingDue: 1, unimproved: 1 },
      merchantStructure: { A: 1, B: 1, C_CANDIDATE: 1 },
      alerts: { coaching: [expect.any(Object)], improvement: [expect.any(Object)], projects: [expect.any(Object)] },
    });
    expect(receivedScope).toEqual(cityScope);
  });

  it('returns numerator and denominator and rejects unknown metric IDs', async () => {
    const repository = {
      async listDaily() {
        return [{
          metricId: 'project_open_rate', periodStart: new Date('2026-08-21T00:00:00Z'),
          organizationId: 'city-1', merchantId: null, value: 50, numerator: 1, denominator: 2,
        }];
      },
    };
    await expect(getMetricCenterData({
      metricIds: ['project_open_rate'], grain: 'DAY',
      start: new Date('2026-08-21T00:00:00Z'), end: new Date('2026-08-21T23:59:59Z'),
      source: 'DESIGNBAO', organizationId: 'city-1',
    }, cityScope, repository)).resolves.toMatchObject({
      selectedCount: 1,
      series: [{ metricId: 'project_open_rate', points: [{ value: 50, numerator: 1, denominator: 2 }] }],
    });
    await expect(getMetricCenterData({
      metricIds: ['not-a-metric'], grain: 'DAY', start: new Date(), end: new Date(),
    }, cityScope, repository)).rejects.toThrow('UNKNOWN_METRIC:not-a-metric');
    await expect(getMetricCenterData({
      metricIds: ['project_open_rate'], grain: 'DAY', start: new Date(), end: new Date(),
      organizationId: 'city-2', source: 'DESIGNBAO',
    }, cityScope, repository)).rejects.toThrow('ORGANIZATION_OUT_OF_SCOPE');
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
      'https://example.test/api/metrics?metricIds=project_open_rate,dispatch_project_count&grain=WEEK&start=2026-08-01&end=2026-08-21&source=XIAOHONGSHU&organizationId=city-1',
    ))).toMatchObject({
      metricIds: ['project_open_rate', 'dispatch_project_count'], grain: 'WEEK',
      source: 'XIAOHONGSHU', organizationId: 'city-1',
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
