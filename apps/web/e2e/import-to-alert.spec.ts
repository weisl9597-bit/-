import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { mockSession } from './fixtures';

test('admin can upload the selected workbook sheets and see an auditable result', async ({ page }) => {
  await mockSession(page);
  await page.route('**/api/admin/uploads', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ batchId: 'batch-e2e', status: 'QUEUED' }) });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/admin/uploads/batch-e2e', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      status: 'SUCCEEDED', totalRows: 2, acceptedRows: 2, warningCount: 0, errorCount: 0,
      jobs: [
        { type: 'IMPORT', status: 'SUCCEEDED' },
        { type: 'METRICS', status: 'SUCCEEDED' },
        { type: 'RULES', status: 'SUCCEEDED' },
      ],
    }),
  }));
  await page.route('**/api/filters/operations*', (route) => {
    const source = new URL(route.request().url()).searchParams.get('source') ?? 'DESIGNBAO';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true,
        regions: [{ id: 'region-1', name: '华南大区' }],
        cities: [{ id: 'city-1', name: '广州市', parentId: 'region-1' }],
        merchants: source === 'XIAOHONGSHU'
          ? [{ id: 'M-XHS', name: '示例小红书装企', organizationId: 'city-1' }]
          : [{ id: 'M-DB', name: '示例设计宝装企', organizationId: 'city-1' }],
        rebuildStatus: { state: 'SUCCEEDED', total: 1, completed: 1, failed: 0, lastSuccessfulDate: '2026-08-23' },
      }),
    });
  });
  await page.route('**/api/metrics?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      selectedCount: 1,
      series: [{
        metricId: 'dispatch_project_count',
        points: [{ periodStart: '2026-08-23', value: 561, numerator: 561, denominator: null }],
      }],
    }),
  }));
  await page.route('**/api/merchants?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [{
        id: 'M-XHS', name: '示例小红书装企', classification: 'B', dataAvailable: true,
        sopRate: 55, projectCount: 1, lastAssignedAt: '2026-08-23T00:00:00.000Z',
      }],
    }),
  }));
  await page.route('**/api/projects?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [{
        id: 'P-XHS::M-XHS', sourceProjectId: 'P-XHS', merchantId: 'M-XHS',
        merchantName: '示例小红书装企', organizationId: 'city-1', businessSource: 'XIAOHONGSHU',
        dataDate: '2026-08-23', assignedAt: '2026-08-23T00:00:00.000Z',
        needsCoaching: true, coached: null, improved: false,
      }],
    }),
  }));

  await page.goto('/admin/uploads');
  await page.locator('input[name="dataDate"]').fill('2026-08-21');
  await page.locator('input[type="file"]').setInputFiles(resolve('packages/test-fixtures/excel/designbao-valid.xlsx'));
  await page.getByRole('button', { name: '上传并开始校验' }).click();
  await expect(page.getByRole('heading', { name: '导入成功' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('项目明细2')).toBeVisible();
  await expect(page.getByText('工作表3')).toBeVisible();

  await page.goto('/metrics?metricIds=dispatch_project_count&start=2026-08-01&end=2026-08-23&grain=MONTH');
  await expect(page.getByLabel('业务来源')).toHaveValue('DESIGNBAO');
  await expect(page.getByText('561')).toBeVisible();
  await page.getByLabel('业务来源').selectOption('XIAOHONGSHU');
  await page.getByRole('link', { name: '商家中心' }).click();
  await expect(page.getByText('示例小红书装企').last()).toBeVisible();
  await page.getByRole('link', { name: '项目中心' }).click();
  await expect(page.getByRole('columnheader', { name: '装企' })).toBeVisible();
});
