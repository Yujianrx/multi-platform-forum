import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { loginAs } from './auth';

test('登录验证码必填、刷新、错误换图与正确登录，手机无溢出', async ({ page }) => {
  const access = JSON.parse(readFileSync('work/e2e-credentials.json', 'utf8'));
  await page.goto('/');
  await expect(page.getByRole('img', { name: '登录图片验证码' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'outputs/登录验证码-手机.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'outputs/登录验证码-桌面.png', fullPage: true });
  const denied = await page.request.post('/api/auth/login', {
    headers: { origin: 'http://127.0.0.1:3100' },
    data: { username: 'admin', password: access.password },
  });
  expect(denied.status()).toBe(400);
  await page.getByLabel('账号', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill(access.password);
  await page.getByLabel('验证码', { exact: true }).fill('ZZZZ');
  const refreshed = page.waitForResponse((r) => r.url().endsWith('/api/auth/captcha'));
  await page.getByRole('button', { name: '进入社区', exact: true }).click();
  const a = await (await refreshed).json();
  await expect(page.getByRole('alert')).toContainText('验证码不正确');
  await expect(page.getByLabel('验证码', { exact: true })).toHaveValue('');
  const manual = page.waitForResponse((r) => r.url().endsWith('/api/auth/captcha'));
  await page.getByRole('button', { name: '更换验证码' }).click();
  const b = await (await manual).json();
  expect(b.id).not.toBe(a.id);
  expect(Object.keys(b).sort()).toEqual(['expiresAt', 'id', 'image']);
  await page.getByLabel('验证码', { exact: true }).fill('ab7k');
  await page.getByRole('button', { name: '进入社区', exact: true }).click();
  await expect(page.locator('.site-header')).toBeVisible();
});

test('手机头像可触摸裁剪、缩放和重置，保存的像素与选区一致', async ({ page }) => {
  await loginAs(page, 'lin.xia');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/me?tab=settings');
  const portrait = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="400"><rect width="200" height="200" fill="red"/><rect y="200" width="200" height="200" fill="blue"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  await page
    .getByLabel('上传头像', { exact: true })
    .setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: portrait });
  const crop = page.getByRole('group', { name: '头像裁剪区域' });
  await crop.scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '保存头像', exact: true })).toBeEnabled();
  const zoom = page.getByLabel('缩放', { exact: true });
  await zoom.fill('2');
  await expect(zoom).toHaveValue('2');
  await page.getByRole('button', { name: '重置裁剪' }).click();
  await expect(zoom).toHaveValue('1');
  await crop.scrollIntoViewIfNeeded();
  const box = (await crop.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + 100, y: box.y + box.height - 30 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: box.x + 100, y: box.y + 20 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(crop.locator('img')).toHaveCSS('top', `-${box.width}px`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: '保存头像', exact: true }).click();
  await expect(crop).toHaveCount(0);
  const me = (await (await page.request.get('/api/auth/me')).json()).user;
  const stored = await page.request.get('/api/avatars/' + me.id);
  const { data, info } = await sharp(await stored.body())
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(256);
  expect(data[0]).toBeLessThan(10);
  expect(data[2]).toBeGreaterThan(240);
  await page.getByRole('button', { name: '移除头像' }).click();
});

test('部门下拉按附图显示全部 13 个部门', async ({ page }) => {
  await loginAs(page);
  const names = [
    '总经办',
    '海外及大客户服务中心',
    '品牌中心',
    '设计部',
    '供应链中心',
    '营运中心',
    '财务部',
    '人力行政部',
    '招商中心',
    '外卖运营部',
    '工程部',
    '研发中心',
    '团购运营',
  ];
  const taxonomy = await (await page.request.get('/api/taxonomy')).json();
  expect(taxonomy.departments.map((d: any) => d.name)).toEqual(names);
  await page.goto('/admin?section=invitations');
  await page.getByRole('button', { name: '生成邀请码', exact: true }).click();
  const options = await page
    .getByLabel('默认部门', { exact: true })
    .locator('option')
    .allTextContents();
  expect(options.filter((n) => names.includes(n))).toEqual(names);
});
