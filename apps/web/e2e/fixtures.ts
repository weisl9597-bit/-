import type { Page } from '@playwright/test';

export async function mockSession(page: Page, role: 'ADMIN' | 'REGION_MANAGER' | 'CITY_MANAGER' = 'ADMIN') {
  await page.route('**/api/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ userId: 'e2e-user', role }),
  }));
}

export async function mockDashboard(page: Page) {
  await page.route('**/api/dashboard*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      dataDate: '2026-08-21',
      source: 'DESIGNBAO',
      hasProjects: true,
      summary: { merchantTotal: 48, abnormalProjects: 12, coachingDue: 7, unimproved: 5 },
      merchantStructure: { A: 20, A_RISK: 4, B: 12, C_CANDIDATE: 3, C: 7, ELIMINATED: 2 },
      alerts: { coaching: [{ id: 'P1' }], improvement: [{ id: 'P1' }], projects: [{ id: 'P1' }] },
    }),
  }));
}

export async function mockMetrics(page: Page) {
  await page.route('**/api/filters/operations*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      enabled: true,
      regions: [{ id: 'region-1', name: '华南大区' }],
      cities: [{ id: 'city-1', name: '广州市', parentId: 'region-1' }],
      merchants: [{ id: 'M1', name: '示例装饰', organizationId: 'city-1' }],
      rebuildStatus: { state: 'IDLE', total: 0, completed: 0, failed: 0, lastSuccessfulDate: null },
    }),
  }));
  await page.route('**/api/metrics?*', async (route) => {
    const ids = new URL(route.request().url()).searchParams.get('metricIds')?.split(',') ?? [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        selectedCount: ids.length,
        series: ids.map((metricId, index) => ({
          metricId,
          points: [{ periodStart: '2026-08-17', value: (index * 7) % 100, numerator: index, denominator: 10 }],
        })),
      }),
    });
  });
}

export async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`页面发生 ${overflow}px 横向溢出`);
}
