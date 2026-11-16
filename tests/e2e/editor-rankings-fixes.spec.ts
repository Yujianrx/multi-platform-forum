import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './auth';

async function draft(page: Page) {
  const session = await (await page.request.get('/api/auth/me')).json();
  const headers = { origin: 'http://127.0.0.1:3100', 'x-csrf-token': session.csrf };
  const categoryId = (await (await page.request.get('/api/taxonomy')).json()).categories[0].id;
  const c = await (
    await page.request.post('/api/contents', { headers, data: { type: 'experience', categoryId } })
  ).json();
  const title = '编辑与入口验收 ' + c.id;
  const data = {
    title,
    summary: '保存发布操作与真实编辑流程验证',
    body: '通过实际操作验证编辑页面保存、发布及导航保护。',
    categoryId,
    visibility: 'company',
  };
  const result = await page.request.put('/api/contents/' + c.id, {
    headers,
    data: { data, submit: false, baseRevisionId: null },
  });
  expect(result.ok()).toBe(true);
  return { id: c.id, title, data, headers, revisionId: (await result.json()).revisionId };
}

for (const name of ['draft.member', 'honors.admin']) {
  test(name + ' 在我的发布、详情及后台都能找到草稿删除', async ({ page }) => {
    await loginAs(page, name);
    const d = await draft(page);
    await page.goto('/me');
    const card = page.locator('.profile-grid > div').filter({ hasText: d.title });
    await expect(card.getByRole('button', { name: '删除草稿' })).toBeVisible();
    await card.getByRole('link', { name: d.title, exact: true }).click();
    await expect(page.getByRole('button', { name: '删除草稿' })).toBeVisible();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: '删除草稿' }).click();
    await expect(page.getByLabel('标题 *', { exact: true })).toHaveValue(d.title);
    await page.goto('/content/' + d.id);
    await expect(page.getByRole('button', { name: '删除草稿' })).toBeVisible();
    if (name === 'honors.admin') {
      await page.goto('/admin?section=contents');
      const row = page.locator('tbody tr').filter({ hasText: d.title });
      await expect(row.getByRole('button', { name: '删除草稿' })).toBeVisible();
      await page.screenshot({ path: 'outputs/草稿删除-后台内容入口.png', fullPage: true });
      page.once('dialog', (dialog) => dialog.accept());
      await row.getByRole('button', { name: '删除草稿' }).click();
      await expect(row).toContainText('已删除');
      await expect(row.getByRole('button', { name: '删除草稿' })).toHaveCount(0);
    } else {
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: '删除草稿' }).click();
      await expect(page).toHaveURL(/\/me\?tab=draft/);
    }
    expect((await page.request.get('/api/contents/' + d.id)).status()).toBe(404);
  });
}

test('首页独立人气榜显示真实排行，切换浏览和周期，空状态不造数据', async ({ page }) => {
  await loginAs(page, 'draft.member');
  await page.goto('/');
  const board = page.getByRole('region', { name: '社区人气榜' });
  const likes = await (
    await page.request.get('/api/rankings?metric=likes&period=week&limit=5')
  ).json();
  await expect(board.locator('.rank-item h4')).toHaveText(likes.items.map((x: any) => x.title));
  await expect(board.locator('.rank-meta small:last-child')).toHaveText(
    likes.items.map((x: any) => x.score + ' 赞'),
  );
  await board.getByRole('button', { name: '浏览榜', exact: true }).click();
  await board.getByRole('button', { name: '累计', exact: true }).click();
  const views = await (
    await page.request.get('/api/rankings?metric=views&period=all&limit=5')
  ).json();
  await expect(board.locator('.rank-item h4')).toHaveText(views.items.map((x: any) => x.title));
  await expect(board.locator('.rank-meta small:last-child')).toHaveText(
    views.items.map((x: any) => x.score + ' 次浏览'),
  );
  await board.scrollIntoViewIfNeeded();
  await board.screenshot({ path: 'outputs/首页-独立人气榜.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await board.getByRole('link', { name: '查看完整浏览榜 →' }).click();
  await expect(page).toHaveURL(/metric=views&period=all/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '浏览榜', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/rankings?*', (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.goto('/');
  await expect(board).toContainText('暂无可上榜的内容');
  await expect(board.locator('.rank-item')).toHaveCount(0);
});

test('编辑工具栏随滚动可见，发布内容直接提交，预览仍可选', async ({ page }) => {
  await loginAs(page, 'draft.member');
  const d = await draft(page);
  await page.goto('/editor/' + d.id);
  await expect(page.getByLabel('标题 *', { exact: true })).toHaveValue(d.title);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const toolbar = page.locator('.editor-toolbar'),
      box = await toolbar.boundingBox();
    const header = await page.locator('.site-header').boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(header!.height - 1);
    expect(box!.y + box!.height).toBeLessThan(viewport.height - 75);
    await expect(toolbar.getByRole('button', { name: '发布内容', exact: true })).toBeInViewport();
    await expect(toolbar.getByRole('button', { name: '保存草稿', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `outputs/编辑操作栏-${viewport.width}.png` });
  }
  await page.getByRole('button', { name: '3 预览与发布', exact: true }).click();
  await expect(page.locator('.preview-sheet h1')).toHaveText(d.title);
  await page.getByRole('button', { name: '2 编辑内容与素材', exact: true }).click();
  await page.getByRole('button', { name: '发布内容', exact: true }).click();
  await expect(page).toHaveURL(/\/me\?tab=review|\/content\//);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.request.delete('/api/contents/' + d.id, { headers: d.headers });
});

test('误点顶部发布和返回时可继续编辑，保存失败不离开，保存后离开保留修改', async ({ page }) => {
  await loginAs(page, 'draft.member');
  const d = await draft(page);
  await page.goto('/me');
  await page
    .locator('.profile-grid > div')
    .filter({ hasText: d.title })
    .getByRole('link', { name: '继续编辑 →' })
    .click();
  const title = page.getByLabel('标题 *', { exact: true });
  await title.fill(d.title + ' 尚未发布');
  await page.locator('.site-header').getByRole('link', { name: '发布', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '离开当前编辑？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(title).toHaveValue(d.title + ' 尚未发布');
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await expect(page).toHaveURL('/editor/' + d.id);
  await page.route('**/api/contents/' + d.id, (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { error: '测试保存失败' } })
      : route.continue(),
  );
  await title.fill(d.title + ' 需要保存的新修改');
  await page.locator('.site-header').getByRole('link', { name: '发布', exact: true }).click();
  await dialog.getByRole('button', { name: '保存后离开' }).click();
  await expect(dialog.getByRole('alert')).toContainText('未能保存');
  await expect(page).toHaveURL('/editor/' + d.id);
  await page.screenshot({ path: 'outputs/编辑-离开保护.png' });
  await page.unroute('**/api/contents/' + d.id);
  await dialog.getByRole('button', { name: '保存后离开' }).click();
  await expect(page).toHaveURL('/editor');
  const stored = await (await page.request.get('/api/contents/' + d.id)).json();
  expect(stored.revision.data.title).toBe(d.title + ' 需要保存的新修改');
  await page.request.delete('/api/contents/' + d.id, { headers: d.headers });
});

test('保存请求未完成时不能离开，刷新提示和直接离开均可用', async ({ page }) => {
  await loginAs(page, 'draft.member');
  const d = await draft(page);
  await page.goto('/editor/' + d.id);
  const title = page.getByLabel('标题 *', { exact: true });
  await expect(title).toHaveValue(d.title);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/contents/' + d.id, async (route) => {
    if (route.request().method() === 'PUT') await pending;
    await route.continue();
  });
  await title.fill(d.title + ' 保存中');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('正在保存');
  await page.locator('.site-header').getByRole('link', { name: '发布', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '离开当前编辑？' });
  await expect(dialog.getByRole('button', { name: '直接离开' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '保存后离开' })).toBeDisabled();
  release();
  await expect(dialog.getByRole('button', { name: '直接离开' })).toBeEnabled();
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  await page.unroute('**/api/contents/' + d.id);
  // Keep an unsaved edit, so refresh must use the browser's native protection.
  await page.route('**/api/contents/' + d.id, (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { error: '保存失败测试' } })
      : route.continue(),
  );
  await title.fill(d.title + ' 丢弃本次修改');
  const native = page.waitForEvent('dialog');
  const refresh = page.reload({ timeout: 3000 }).catch(() => null);
  const warning = await native;
  expect(warning.type()).toBe('beforeunload');
  await warning.dismiss();
  await refresh;
  await expect(title).toHaveValue(d.title + ' 丢弃本次修改');
  await page.locator('.site-header').getByRole('link', { name: '发布', exact: true }).click();
  await dialog.getByRole('button', { name: '直接离开' }).click();
  await expect(page).toHaveURL('/editor');
  const stored = await (await page.request.get('/api/contents/' + d.id)).json();
  expect(stored.revision.data.title).toBe(d.title + ' 保存中');
  await page.request.delete('/api/contents/' + d.id, { headers: d.headers });
});
