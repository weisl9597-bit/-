import { expect, test } from '@playwright/test';
import { mockDashboard, mockSession } from './fixtures';

test('dashboard alert opens a filtered project and returns to its merchant', async ({ page }) => {
  await mockSession(page);
  await mockDashboard(page);
  await page.route('**/api/filters/operations*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      enabled: true, regions: [], cities: [], merchants: [],
      rebuildStatus: { state: 'IDLE', total: 0, completed: 0, failed: 0, lastSuccessfulDate: null },
    }),
  }));
  await page.route('**/api/projects?*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{
      id: 'P-100::M-1', sourceProjectId: 'P-100', merchantId: 'M-1', merchantName: '示例装企',
      organizationId: 'city-1', businessSource: 'DESIGNBAO', dataDate: '2026-08-20',
      assignedAt: '2026-08-20T00:00:00.000Z', needsCoaching: true, coached: null, improved: false,
    }] }),
  }));
  await page.route('**/api/projects/P-100%3A%3AM-1*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      id: 'P-100::M-1', sourceProjectId: 'P-100', merchantId: 'M-1', assignedAt: '2026-08-20T00:00:00.000Z',
      followWithin30m: true, needsAnalyzed: true, hardInvite: true, needsCoaching: true, coached: null, improved: false,
      merchant: { name: '示例装企' },
    }),
  }));
  await page.route('**/api/merchants?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
  await page.route('**/api/merchants/M-1*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      id: 'M-1', name: '示例装企', classificationSnapshots: [{ classification: 'B', reason: '连续两周下降' }], metricSnapshots: [], projects: [],
    }),
  }));

  await page.goto('/');
  await page.getByRole('link', { name: /未改善项目/ }).click();
  await expect(page.getByLabel('改善状态')).toHaveValue('false');
  await page.getByRole('button', { name: '查看详情' }).click();
  await expect(page.getByText('SOP执行明细')).toBeVisible();
  await page.getByRole('link', { name: /返回所属商家/ }).click();
  await expect(page.getByText('分类原因')).toBeVisible();
  await expect(page.getByText('连续两周下降')).toBeVisible();
});

test('preserves operations filters when dashboard alerts navigate to projects', async ({ page }) => {
  await mockSession(page);
  await mockDashboard(page);
  await page.route('**/api/filters/operations*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      enabled: true, regions: [], cities: [], merchants: [],
      rebuildStatus: { state: 'IDLE', total: 0, completed: 0, failed: 0, lastSuccessfulDate: null },
    }),
  }));
  await page.goto('/?source=XIAOHONGSHU&regionId=r1&cityId=c1');
  await page.getByRole('link', { name: /异常项目/ }).first().click();
  await expect(page).toHaveURL(/source=XIAOHONGSHU/);
  await expect(page).toHaveURL(/regionId=r1/);
  await expect(page).toHaveURL(/cityId=c1/);
});

test('non-admin navigation does not expose management links', async ({ page }) => {
  await mockSession(page, 'CITY_MANAGER');
  await mockDashboard(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: '数据上传' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '商家决策' })).toHaveCount(0);
});
