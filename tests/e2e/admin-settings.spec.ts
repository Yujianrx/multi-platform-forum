import { test, expect } from '@playwright/test';
import { loginAs } from './auth';

test('从管理列表切到站点设置不使用旧响应，延迟加载后能保存和重开', async ({ page }) => {
  await loginAs(page);
  const initial = await (await page.request.get('/api/admin/settings')).json();
  await page.goto('/admin?section=users');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/settings?*', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: '站点设置', exact: true }).click();
    await expect(page.getByRole('status', { name: '正在加载' })).toBeVisible();
    await expect(page.getByText('页面遇到问题，请刷新重试', { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue(initial.name);
  const types = await page.locator('.settings-form input[type=checkbox]:checked').count();
  expect(types).toBeGreaterThan(0);
  for (const label of ['首页轮播', '附件与存储', '成员与权限']) {
    const target = page.getByRole('button', { name: label, exact: true });
    await target.click();
    await expect(page.locator('.admin-content .skeleton-grid')).toHaveCount(0);
    await page.getByRole('button', { name: '站点设置', exact: true }).click();
    await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue(initial.name);
    await expect(page.locator('.settings-form input[type=checkbox]:checked')).toHaveCount(types);
  }
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.getByText('站点设置已更新', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue(initial.name);
  await page.screenshot({ path: 'outputs/修复-站点设置.png', fullPage: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
});
