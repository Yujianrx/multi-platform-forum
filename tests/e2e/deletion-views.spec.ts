import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './auth';
async function headers(page: Page) {
  const s = await (await page.request.get('/api/auth/me')).json();
  return { origin: 'http://127.0.0.1:3100', 'x-csrf-token': s.csrf };
}
async function create(page: Page, submit = false) {
  const h = await headers(page),
    t = await (await page.request.get('/api/taxonomy')).json(),
    categoryId = t.categories[0].id;
  const c = await page.request.post('/api/contents', {
      headers: h,
      data: { type: 'experience', categoryId },
    }),
    cid = (await c.json()).id,
    title = '删除功能验收 ' + cid;
  const data = {
    title,
    summary: '本次操作的实际步骤与验证结果',
    body: '独立测试正文 ' + cid,
    categoryId,
    visibility: 'company',
  };
  const r = await page.request.put('/api/contents/' + cid, {
    headers: h,
    data: { data, submit, baseRevisionId: null },
  });
  expect(r.status()).toBe(200);
  if (submit)
    await expect
      .poll(async () => (await (await page.request.get('/api/contents/' + cid)).json()).state)
      .toBe('published');
  return { cid, title, data, rid: (await r.json()).revisionId, h };
}
test('草稿箱支持删除和取消，已发布内容仅删除新草稿，手机布局可用', async ({ page }) => {
  await loginAs(page, 'draft.member');
  const d = await create(page);
  await page.goto('/me?tab=draft');
  let card = page.locator('.profile-grid > div').filter({ hasText: d.title });
  page.once('dialog', (dialog) => dialog.dismiss());
  await card.getByRole('button', { name: '删除草稿' }).click();
  await expect(card).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await card.getByRole('button', { name: '删除草稿' }).click();
  await expect(card).toHaveCount(0);
  const p = await create(page, true);
  try {
    await page.request.put('/api/contents/' + p.cid, {
      headers: p.h,
      data: {
        data: { ...p.data, title: p.title + ' 待修改' },
        baseRevisionId: p.rid,
        submit: false,
      },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/me?tab=draft');
    card = page.locator('.profile-grid > div').filter({ hasText: p.title });
    await expect(card.getByRole('button', { name: '删除草稿' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: 'outputs/删除功能-手机草稿箱.png', fullPage: true });
    page.once('dialog', (dialog) => dialog.accept());
    await card.getByRole('button', { name: '删除草稿' }).click();
    await expect(card).toHaveCount(0);
    const current = await (await page.request.get('/api/contents/' + p.cid)).json();
    expect(current.state).toBe('published');
    expect(current.revision.id).toBe(p.rid);
  } finally {
    await page.request.delete('/api/contents/' + p.cid, { headers: p.h });
  }
});
test('管理员确认账号删除，原会话失效，历史文章和其他成员回复保留', async ({ page, browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' }),
    employee = await context.newPage();
  await loginAs(employee, 'delete.member');
  const p = await create(employee, true);
  const member = (await (await employee.request.get('/api/auth/me')).json()).user;
  await loginAs(page, 'honors.admin');
  const h = await headers(page);
  try {
    const reply = await page.request.post('/api/contents/' + p.cid + '/comments', {
      headers: h,
      data: { body: '保留另一位同事的历史回复' },
    });
    expect(reply.status()).toBe(201);
    await page.goto('/admin?section=users');
    const row = page.locator('tbody tr').filter({ hasText: 'delete.member' });
    await row.getByRole('button', { name: '删除账号', exact: true }).click();
    await expect(page.getByRole('button', { name: '确认删除账号' })).toBeDisabled();
    await page.getByLabel('输入账号确认删除', { exact: true }).fill('delete.member');
    await page.screenshot({ path: 'outputs/删除功能-员工账号确认.png', fullPage: true });
    await page.getByRole('button', { name: '确认删除账号' }).click();
    await expect(row).toHaveCount(0);
    expect((await employee.request.get('/api/auth/me')).status()).toBe(401);
    await page.goto('/content/' + p.cid);
    await expect(page.getByRole('heading', { name: p.title, exact: true })).toBeVisible();
    await expect(page.locator('.detail-page')).toContainText('已删除成员');
    await expect(page.locator('.detail-page')).toContainText('保留另一位同事的历史回复');
    expect((await page.request.get('/api/authors/' + member.id)).status()).toBe(200);
  } finally {
    await page.request.delete('/api/contents/' + p.cid, { headers: h });
    await context.close();
  }
});
test('首页保留点赞和浏览入口，实际打开内容计浏览，下载与贡献榜独立保留', async ({ page }) => {
  await loginAs(page, 'draft.member');
  await page.goto('/');
  await page
    .getByRole('region', { name: '社区人气榜' })
    .getByRole('button', { name: '浏览榜', exact: true })
    .click();
  await page.getByRole('link', { name: '查看完整浏览榜 →', exact: true }).click();
  await expect(page.getByRole('button', { name: '浏览榜', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: '点赞榜', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载榜', exact: true })).toBeVisible();
  const contents = await (await page.request.get('/api/contents?limit=50')).json(),
    c = contents.items.find((x: any) => x.type !== 'discussion');
  await page.goto('/content/' + c.id);
  await expect(page.getByRole('heading', { name: c.title, exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const b = await (
        await page.request.get('/api/rankings?metric=views&period=all&limit=50')
      ).json();
      return b.items.find((x: any) => x.id === c.id)?.score || 0;
    })
    .toBeGreaterThan(0);
  await page.goto('/rankings?metric=views&period=all');
  await expect(page.locator('.ranking-card-header').first()).toContainText('次有效浏览');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'outputs/排行榜-手机浏览榜.png', fullPage: true });
  await page.getByRole('button', { name: '点赞榜', exact: true }).click();
  await expect(page.locator('.ranking-card-header').first()).toContainText('个赞');
  await page.getByRole('link', { name: '贡献榜 →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '社区贡献榜' })).toBeVisible();
});
