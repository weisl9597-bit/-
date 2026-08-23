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
    }),
  }));

  await page.goto('/admin/uploads');
  await page.locator('input[name="dataDate"]').fill('2026-08-21');
  await page.locator('input[type="file"]').setInputFiles(resolve('packages/test-fixtures/excel/designbao-valid.xlsx'));
  await page.getByRole('button', { name: '上传并开始校验' }).click();
  await expect(page.getByRole('heading', { name: '导入成功' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('项目明细2')).toBeVisible();
  await expect(page.getByText('工作表3')).toBeVisible();
});
