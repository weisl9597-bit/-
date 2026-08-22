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

test('the workbench fits both accepted desktop viewports', async ({ page }) => {
  await mockSession(page);
  await mockMetrics(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/metrics');
    await expectNoPageOverflow(page);
  }
});

