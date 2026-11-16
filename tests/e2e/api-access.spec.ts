import { test, expect } from '@playwright/test';
import { loginAs } from './auth';

test('个人接口密钥在桌面和手机可创建、接入并撤销，关闭后不再显示原文', async ({ page }) => {
  await loginAs(page);
  await page.goto('/me?tab=api');
  await expect(page.getByRole('heading', { name: 'AI 接入', exact: true })).toBeVisible();
  await page.getByLabel('密钥名称', { exact: true }).fill('浏览器接入验收');
  await page.getByRole('button', { name: '创建密钥', exact: true }).click();
  const secret = page.getByLabel('新接口密钥');
  await expect(secret).toBeVisible();
  const token = await secret.inputValue();
  expect(token).toMatch(/^aic_[\w-]{43}$/);
  const taxonomy = await page.request.get('/api/open/v1/taxonomy', {
    headers: { Authorization: 'Bearer ' + token },
  });
  expect(taxonomy.status()).toBe(200);
  expect((await taxonomy.json()).departments).toHaveLength(13);
  const response = await page.request.post('/api/open/v1/posts', {
    headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': 'browser-api-' + Date.now() },
    data: {
      title: 'AI 接口浏览器验收',
      body: '本条内容仅用于独立测试环境中的接口验收。',
      categoryId: (await taxonomy.json()).categories[0].id,
    },
  });
  expect(response.status()).toBe(201);
  await page.getByRole('button', { name: '已保存，关闭' }).click();
  await expect(secret).toHaveCount(0);
  await page.screenshot({ path: 'outputs/AI接入-桌面.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'AI 接入', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'outputs/AI接入-手机.png', fullPage: true });
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .locator('.api-key-row')
    .filter({ hasText: '浏览器接入验收' })
    .getByRole('button', { name: '撤销', exact: true })
    .click();
  await expect(page.locator('.api-key-row').filter({ hasText: '浏览器接入验收' })).toContainText(
    '已撤销',
  );
  expect(
    (
      await page.request.get('/api/open/v1/taxonomy', {
        headers: { Authorization: 'Bearer ' + token },
      })
    ).status(),
  ).toBe(401);
  await page.reload();
  expect(await page.locator('body').innerText()).not.toContain(token);
});

test('审核规则展示预设处理方式和政治语境说明', async ({ page }) => {
  await loginAs(page);
  await page.goto('/admin?section=rules');
  await page.getByRole('button', { name: '审核规则', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: '处理方式', exact: true })).toBeVisible();
  await expect(page.getByText('直接退回', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/正常新闻、研究和时政讨论可通过/)).toBeVisible();
  await page.screenshot({ path: 'outputs/审核规则-预设.png', fullPage: true });
});
