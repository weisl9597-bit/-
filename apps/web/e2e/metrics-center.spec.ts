import { expect, test } from '@playwright/test';
import { expectNoPageOverflow, mockMetrics, mockSession } from './fixtures';

test('all 40 metrics can be selected and switch to the matrix', async ({ page }) => {
  await mockSession(page);
  await mockMetrics(page);
  await page.goto('/metrics');
  await page.getByRole('button', { name: '全选全部' }).click();
  await expect(page.getByText('已选 40/40')).toBeVisible();
  await expect(page.getByTestId('metric-matrix-item')).toHaveCount(40);
  await expectNoPageOverflow(page);
});

test('defaults to Designbao and supports region, city and merchant cascading filters', async ({ page }) => {
  await mockSession(page);
  await mockMetrics(page);
  await page.goto('/metrics');

  await expect(page.getByLabel('业务来源')).toHaveValue('DESIGNBAO');
  await page.getByLabel('大区').selectOption('region-1');
  await page.getByLabel('城市').selectOption('city-1');
  await expect(page.getByLabel('商家')).toBeEnabled();

  await page.getByLabel('商家').selectOption('M1');
  await page.getByLabel('业务来源').selectOption('ALL');
  await expect.poll(() => new URL(page.url()).searchParams.get('merchantId')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('source')).toBe('ALL');
});

test('the workbench fits both accepted desktop viewports', async ({ page }) => {
  await mockSession(page);
  await mockMetrics(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/metrics');
    await expectNoPageOverflow(page);
  }
});
