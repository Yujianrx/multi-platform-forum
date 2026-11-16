import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './auth';
async function session(page: Page) {
  const me = await (await page.request.get('/api/auth/me')).json();
  return { me, headers: { origin: 'http://127.0.0.1:3100', 'x-csrf-token': me.csrf } };
}
test('积分空状态、规则、六枚真实勋章与手机布局', async ({ page }) => {
  await loginAs(page, 'honors.member');
  await page.goto('/me?tab=honors');
  await expect(page.locator('.honor-total strong')).toHaveText('0');
  await expect(page.getByText('暂无积分记录', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '勋章墙', exact: true }).click();
  await expect(page.locator('.honor-badge-tile')).toHaveCount(6);
  for (const img of await page.locator('.honor-badge-tile img').all())
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(256);
  await page.getByRole('button', { name: /首次分享案例/ }).click();
  await expect(page.getByRole('dialog')).toContainText('首篇原创实用案例');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.screenshot({ path: 'outputs/积分荣誉-勋章墙.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.honor-wall')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'outputs/积分荣誉-手机勋章墙.png', fullPage: true });
  await page.getByRole('tab', { name: '规则', exact: true }).click();
  await expect(page.locator('.honor-rules')).toContainText('1,800'.replace(',', ''));
  await page.goto('/honors');
  await expect(page.getByRole('heading', { name: '社区贡献榜' })).toBeVisible();
  await page.getByRole('tab', { name: '案例', exact: true }).click();
  await expect(page.getByText('本周还没有有效贡献', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test('实际审核认定、个人积分及周榜、人工授勋和异常撤回闭环', async ({ page, browser }) => {
  await loginAs(page, 'honors.admin');
  const admin = await session(page);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' }),
    member = await context.newPage();
  await loginAs(member, 'honors.member');
  const ms = await session(member),
    taxonomy = await (await member.request.get('/api/taxonomy')).json(),
    categoryId = taxonomy.categories[0].id;
  const created = await member.request.post('/api/contents', {
    headers: ms.headers,
    data: { type: 'experience', categoryId },
  });
  const cid = (await created.json()).id,
    title = '荣誉验收原创案例 ' + Date.now();
  try {
    const saved = await member.request.put('/api/contents/' + cid, {
      headers: ms.headers,
      data: {
        data: {
          title,
          summary: '真实操作记录及实践效果',
          body: '[dev:review] 原创案例：问题、实施过程和验证结果 ' + cid,
          categoryId,
          visibility: 'company',
        },
        submit: true,
        baseRevisionId: null,
      },
    });
    expect(saved.status()).toBe(200);
    await page.goto('/admin?section=moderation');
    const card = page.locator('.review-item').filter({ hasText: title });
    await card.getByRole('button', { name: '人工复核', exact: true }).click();
    await page.getByRole('checkbox', { name: /同时确认贡献资格/ }).check();
    await page.getByRole('button', { name: '确认通过', exact: true }).click();
    await expect(card).toHaveCount(0);
    await member.goto('/me?tab=honors');
    await expect(member.locator('.honor-total strong')).toHaveText('20');
    await expect(member.locator('.honor-records')).toContainText('+20');
    await member.goto('/honors');
    await expect(
      member.locator('.honor-rank-row').filter({ hasText: '荣誉验收成员' }),
    ).toContainText('20');
    await member.screenshot({ path: 'outputs/积分荣誉-贡献榜.png', fullPage: true });
    await page.goto('/admin?section=honors');
    await page.getByRole('tab', { name: '人工勋章', exact: true }).click();
    await page.getByRole('button', { name: '授予勋章', exact: true }).click();
    await page.getByLabel('查找成员', { exact: true }).fill('honors.member');
    await page.getByLabel('授予成员', { exact: true }).selectOption(ms.me.user.id);
    await page
      .getByLabel('授予理由（公开展示）', { exact: true })
      .fill('实践过程清晰，对同事有实际帮助');
    await page.getByRole('checkbox', { name: title, exact: true }).check();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(page.locator('.honor-admin-item')).toContainText('优质贡献者');
    await member.goto('/author/' + ms.me.user.id);
    await expect(member.locator('.honor-badge-tile.earned')).toHaveCount(2);
    await member.getByRole('button', { name: /优质贡献者/ }).click();
    await expect(member.getByRole('dialog')).toContainText('实践过程清晰');
    await member.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('tab', { name: '贡献确认', exact: true }).click();
    await page.getByLabel('贡献资格状态').selectOption('confirmed');
    const item = page.locator('.honor-admin-item').filter({ hasText: title });
    await item.getByRole('button', { name: '撤回资格' }).click();
    await page.getByLabel('处理原因', { exact: true }).fill('发现案例存在重复搬运，撤回本次资格');
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(item).toHaveCount(0);
    await member.goto('/me?tab=honors');
    await expect(member.locator('.honor-total strong')).toHaveText('0');
    await expect(member.locator('.honor-records')).toContainText('-20');
    await page.getByRole('tab', { name: '人工勋章', exact: true }).click();
    await expect(page.locator('.honor-admin-item')).toContainText('待复核');
    await page.screenshot({ path: 'outputs/积分荣誉-管理后台.png', fullPage: true });
    await page.getByRole('button', { name: '撤销勋章' }).click();
    await page.getByLabel('处理原因', { exact: true }).fill('依据已失效，撤销本次人工授予');
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
  } finally {
    await page.request.delete('/api/contents/' + cid, { headers: admin.headers });
    await context.close();
  }
});
test('免审内容单独确认贡献资格，管理手机页面无溢出', async ({ page }) => {
  await loginAs(page, 'honors.admin');
  const s = await session(page),
    taxonomy = await (await page.request.get('/api/taxonomy')).json(),
    categoryId = taxonomy.categories[0].id;
  const users = await (await page.request.get('/api/admin/users?limit=50')).json(),
    u = users.items.find((x: any) => x.id === s.me.user.id);
  await page.request.patch('/api/admin/users/' + u.id, {
    headers: s.headers,
    data: { role: 'admin', active: true, departmentId: u.department_id, moderationExempt: true },
  });
  let cid: string | undefined;
  try {
    const c = await page.request.post('/api/contents', {
      headers: s.headers,
      data: { type: 'project', categoryId },
    });
    cid = (await c.json()).id;
    const title = '免审资源验收 ' + Date.now();
    const r = await page.request.put('/api/contents/' + cid, {
      headers: s.headers,
      data: {
        data: {
          title,
          summary: '可复用的完整项目及使用方法',
          body: '实际项目部署步骤和示例 ' + cid,
          fields: { demoUrl: 'https://example.com/' + cid, usage: '按文档步骤使用' },
          categoryId,
          visibility: 'company',
        },
        submit: true,
        baseRevisionId: null,
      },
    });
    expect((await r.json()).status).toBe('approved');
    await page.goto('/admin?section=honors');
    const item = page.locator('.honor-admin-item').filter({ hasText: title });
    await expect(item).toContainText('等待贡献资格确认');
    await item.getByRole('button', { name: '确认并计分' }).click();
    await page.getByRole('checkbox', { name: /说明完整/ }).check();
    await page.getByLabel('处理原因', { exact: true }).fill('已检查项目完整，资源可使用');
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(item).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: '积分追溯', exact: true }).click();
    await expect(page.locator('.honor-records')).toContainText('+20');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: 'outputs/积分荣誉-手机管理.png', fullPage: true });
  } finally {
    if (cid) await page.request.delete('/api/contents/' + cid, { headers: s.headers });
    await page.request.patch('/api/admin/users/' + u.id, {
      headers: s.headers,
      data: { role: 'admin', active: true, departmentId: u.department_id, moderationExempt: false },
    });
  }
});
