import { test, expect } from '@playwright/test';
import { loginAs } from './auth';

test('首页图片使用轻量资源和长期缓存，手机选择较小轮播图', async ({ page }) => {
  await loginAs(page, 'zhou.ning');
  await page.locator('.carousel-image').evaluate((image: HTMLImageElement) => image.decode());
  await page.waitForTimeout(1600);
  const images = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e) => e.name.includes('/brand/'))
      .map((e) => ({ url: e.name, bytes: (e as PerformanceResourceTiming).encodedBodySize })),
  );
  expect(images.length).toBeGreaterThan(3);
  expect(images.reduce((n, i) => n + i.bytes, 0)).toBeLessThan(1000000);
  expect(images.every((i) => i.url.includes('/brand/optimized/'))).toBe(true);
  const response = await page.request.get(images[0].url);
  expect(response.headers()['cache-control']).toContain('immutable');
  await page.reload();
  await page.locator('.carousel-image').evaluate((image: HTMLImageElement) => image.decode());
  const retransferred = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e) => e.name.includes('/brand/'))
      .reduce((n, e) => n + (e as PerformanceResourceTiming).transferSize, 0),
  );
  expect(retransferred).toBeLessThan(1000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect
    .poll(() => page.locator('.carousel-image').evaluate((img: HTMLImageElement) => img.currentSrc))
    .toContain('-small-');
});

test('管理员开启账号免审，成员发帖与回复直接展示，关闭后恢复送审', async ({ page, browser }) => {
  await loginAs(page);
  const adminSession = await (await page.request.get('/api/auth/me')).json();
  const adminHeaders = { origin: 'http://127.0.0.1:3100', 'x-csrf-token': adminSession.csrf };
  const accounts = await (await page.request.get('/api/admin/users?limit=50')).json();
  const account = accounts.items.find((u: any) => u.username === 'lin.xia');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' }),
    member = await context.newPage();
  const created: string[] = [];
  try {
    await page.goto('/admin?section=users');
    const row = page.getByRole('row').filter({ hasText: 'lin.xia' });
    await row.getByRole('button', { name: '权限与部门' }).click();
    await page.getByRole('switch', { name: '发布免审' }).check();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(row).toContainText('发布免审');
    await page.screenshot({ path: 'outputs/账号免审-成员设置.png', fullPage: true });
    await loginAs(member, 'lin.xia');
    await member.goto('/forum/new');
    await member.getByLabel('话题标题', { exact: true }).fill('E2E 免审话题');
    await member
      .getByRole('textbox', { name: '话题正文', exact: true })
      .fill('启用账号免审后直接分享实践过程。');
    const saved = member.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes('/api/contents/'),
    );
    await member.getByRole('button', { name: '发布话题', exact: true }).click();
    const content = await (await saved).json();
    created.push(content.id);
    expect(content.status).toBe('approved');
    await expect(member.locator('.forum-post').first()).toContainText('启用账号免审');
    await member
      .getByRole('textbox', { name: '回复内容', exact: true })
      .fill('免审回复直接显示，不用等待。');
    const replied = member.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/comments'),
    );
    await member.getByRole('button', { name: '发表回复', exact: true }).click();
    expect((await (await replied).json()).status).toBe('approved');
    await expect(
      member.locator('article[id^="reply-"]').filter({ hasText: '免审回复直接显示' }),
    ).toBeVisible();
    await row.getByRole('button', { name: '权限与部门' }).click();
    await page.getByRole('switch', { name: '发布免审' }).uncheck();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(row).not.toContainText('发布免审');
    const me = await (await member.request.get('/api/auth/me')).json();
    expect(me.user.moderation_exempt).toBe(false);
    const headers = { origin: 'http://127.0.0.1:3100', 'x-csrf-token': me.csrf };
    const reply = await member.request.post('/api/contents/' + content.id + '/comments', {
      headers,
      data: { body: '关闭免审后恢复审核' },
    });
    expect((await reply.json()).status).toBe('queued');
  } finally {
    await page.request.patch('/api/admin/users/' + account.id, {
      headers: adminHeaders,
      data: {
        role: account.role,
        departmentId: account.department_id,
        active: account.active,
        moderationExempt: false,
      },
    });
    for (const cid of created)
      await page.request.delete('/api/contents/' + cid, { headers: adminHeaders });
    await context.close();
  }
});
