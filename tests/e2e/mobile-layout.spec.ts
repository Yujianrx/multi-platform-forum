import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './auth';

async function mobile(page: Page, username = 'draft.member') {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, username);
  await expect(page.locator('.m-bottom-nav')).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
async function ready(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.m-bottom-nav')).toBeVisible();
  await expect(page.locator('.skeleton-grid')).toHaveCount(0);
  if (await page.locator('.profile-grid > div').count())
    await expect(page.locator('.profile-grid .m-content-card').first()).toBeVisible();
}

test('电脑只挂载原页面，手机默认最新且共用真实内容接口', async ({ page }) => {
  const modules: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/assets/Mobile')) modules.push(r.url());
  });
  await loginAs(page, 'draft.member');
  await expect(page.locator('.community-layout')).toBeVisible();
  await expect(page.locator('.m-header,.m-bottom-nav,.m-home')).toHaveCount(0);
  expect(modules).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await expect(page.getByRole('button', { name: '最新', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.community-layout')).toHaveCount(0);
  const data = await (
    await page.request.get('/api/contents?resources=1&sort=latest&page=1')
  ).json();
  await expect(page.locator('.m-content-card')).toHaveCount(data.items.length);
  expect(
    await page.locator('.m-card-open').evaluateAll((es) => es.map((e) => e.getAttribute('href'))),
  ).toEqual(data.items.map((i: any) => '/content/' + i.id));
  const hero = await page.locator('.image-carousel').boundingBox();
  const title = await page.locator('.hero-copy h1').boundingBox();
  expect(title!.y).toBeGreaterThanOrEqual(hero!.y);
  expect(title!.y + title!.height).toBeLessThanOrEqual(hero!.y + hero!.height);
  await expect(page.locator('.m-bottom-nav')).toContainText('首页讨论消息我的');
  await noOverflow(page);
});

test('手机类型、精选、分类、分页与真实空榜入口可用', async ({ page }) => {
  await mobile(page);
  await page
    .getByRole('navigation', { name: '内容类型' })
    .getByRole('button', { name: '项目', exact: true })
    .click();
  await expect(page).toHaveURL(/type=project/);
  await ready(page);
  await expect(page.locator('.m-content-card:not(.m-card-project)')).toHaveCount(0);
  await page.getByRole('button', { name: '精选', exact: true }).click();
  await expect(page).toHaveURL(/channel=featured/);
  await page.getByRole('button', { name: '筛选分类' }).click();
  await expect(page.getByRole('dialog', { name: '内容分类' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '全部分类', exact: true }).click();
  await page.getByRole('button', { name: '榜单', exact: true }).click();
  await expect(page.getByRole('tab', { name: '综合', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '内容人气榜 →' })).toBeVisible();
  await page.getByRole('link', { name: '内容人气榜 →' }).click();
  await page.getByRole('button', { name: '浏览榜', exact: true }).click();
  await expect(page).toHaveURL(/metric=views/);
  await noOverflow(page);
  await page.route('**/api/contents?*', (r) =>
    r.fulfill({ json: { items: [], total: 0, page: 1, limit: 12 } }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '这里还没有内容' })).toBeVisible();
  await expect(page.locator('.m-content-card')).toHaveCount(0);
});

test('手机讨论保留全部类型、版块、范围、排序和搜索', async ({ page }) => {
  await mobile(page);
  await page
    .getByRole('navigation', { name: '手机导航' })
    .getByRole('link', { name: '讨论', exact: true })
    .click();
  await expect(page.locator('.m-topic').first()).toBeVisible();
  await page
    .getByRole('navigation', { name: '讨论类型' })
    .getByRole('button', { name: '问答', exact: true })
    .click();
  await expect(page).toHaveURL(/kind=question/);
  await ready(page);
  await expect(page.locator('.m-topic-kind')).toHaveText(
    (await page.locator('.m-topic-kind').count())
      ? Array(await page.locator('.m-topic-kind').count()).fill('问答')
      : [],
  );
  await page.getByRole('button', { name: '筛选讨论', exact: true }).click();
  await page.getByLabel('话题类型', { exact: true }).selectOption('chat');
  await page.getByLabel('话题排序', { exact: true }).selectOption('newest');
  await page.getByLabel('话题范围', { exact: true }).selectOption('all');
  await expect(page.getByLabel('论坛版块')).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await ready(page);
  await expect(page.locator('.m-topic-kind').first()).toHaveText('闲聊');
  await page.getByRole('button', { name: '搜索讨论', exact: true }).click();
  await page.getByLabel('搜索关键词').fill('欢迎来到讨论区');
  await page.getByRole('dialog').getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.m-topic')).toHaveCount(1);
  await expect(page.locator('.m-topic-excerpt')).not.toContainText('##');
  await page.locator('.m-topic-title').click();
  await expect(page.locator('.forum-post').first()).toBeVisible();
  await noOverflow(page);
});

test('手机个人主页显示真实等级并保留草稿、审核、设置、接入和角色入口', async ({ page }) => {
  await mobile(page);
  await page
    .getByRole('navigation', { name: '手机导航' })
    .getByRole('link', { name: '我的', exact: true })
    .click();
  const data = await (await page.request.get('/api/honors/me')).json();
  await expect(page.locator('.m-level-card strong')).toContainText(String(data.level.total));
  await expect(page.locator('.m-badge-strip button')).toHaveCount(Math.min(data.badges.length, 4));
  await page.getByRole('link', { name: '勋章墙', exact: true }).click();
  await expect(page.locator('.honor-wall')).toBeVisible();
  await expect(page.locator('.honor-badge-tile')).toHaveCount(6);
  await page.getByRole('button', { name: /首次分享案例/ }).click();
  await expect(page.getByRole('dialog')).toContainText('自动授予');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('link', { name: '更多个人功能' }).click();
  const menu = page.getByRole('dialog', { name: '我的社区' });
  for (const label of ['全部内容', '等待审核', '被退回', '资料与密码', 'AI 接入'])
    await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
  await expect(menu.getByRole('link', { name: '管理后台' })).toHaveCount(0);
  await menu.getByRole('link', { name: '资料与密码', exact: true }).click();
  await expect(page.getByRole('button', { name: '更换头像', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '更新密码', exact: true })).toBeVisible();
  await page.goto('/me?tab=review');
  await expect(page.getByRole('heading', { name: '等待审核', exact: true })).toBeVisible();
  await noOverflow(page);
});

test('手机发布复用单一草稿创建，旋转不丢正文，离开保护和删除有效', async ({ page }) => {
  await mobile(page);
  let created = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/contents') created++;
  });
  await page
    .getByRole('navigation', { name: '手机导航' })
    .getByRole('button', { name: '选择发布类型', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '想分享点什么？' })
    .getByRole('link', { name: '经验', exact: true })
    .click();
  await expect(page).toHaveURL(/\/editor\/[\da-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  const title = '手机独立布局草稿 ' + id;
  await page.getByLabel('标题 *', { exact: true }).fill(title);
  await page.getByLabel('摘要 *', { exact: true }).fill('手机端保存、旋转和导航保护验收');
  await page
    .getByLabel('正文 *', { exact: true })
    .fill('这段正文必须在旋转屏幕及切换展示模式后继续保留。');
  await page.setViewportSize({ width: 900, height: 600 });
  await expect(page.locator('.m-header')).toHaveCount(0);
  await expect(page.getByLabel('标题 *', { exact: true })).toHaveValue(title);
  await expect(page.getByLabel('正文 *', { exact: true })).toContainText('继续保留');
  await page.evaluate(() => window.scrollTo(0, 1000));
  const desktopHeader = await page.locator('.site-header').boundingBox();
  await expect
    .poll(async () => (await page.locator('.editor-toolbar').boundingBox())!.y)
    .toBeGreaterThanOrEqual(desktopHeader!.y + desktopHeader!.height - 1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('navigation', { name: '手机导航' })
    .getByRole('link', { name: '首页', exact: true })
    .click();
  const leave = page.getByRole('dialog', { name: '离开当前编辑？' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page
    .getByRole('navigation', { name: '手机导航' })
    .getByRole('button', { name: '选择发布类型', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '想分享点什么？' })
    .getByRole('link', { name: '项目', exact: true })
    .click();
  await expect(leave).toBeVisible();
  expect(created).toBe(1);
  await leave.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page
    .getByRole('navigation', { name: '手机导航' })
    .getByRole('link', { name: '我的', exact: true })
    .click();
  await leave.getByRole('button', { name: '保存后离开', exact: true }).click();
  await page
    .getByRole('navigation', { name: '我的内容' })
    .getByRole('button', { name: '草稿', exact: true })
    .click();
  const card = page.locator('.profile-grid > div').filter({ hasText: title });
  await expect(card.getByRole('button', { name: '删除草稿', exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/contents/' + id)).json();
  expect(saved.revision.data.body).toContain('继续保留');
  page.once('dialog', (d) => d.accept());
  await card.getByRole('button', { name: '删除草稿', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await page.request.get('/api/contents/' + id)).status()).toBe(404);
});

test('手机窄屏、错误封面和超长文本有回退，桌面断点无样式泄漏', async ({ page }) => {
  await mobile(page);
  const data = await (await page.request.get('/api/contents?resources=1')).json();
  const item = {
    ...data.items[0],
    title: '超长标题'.repeat(22),
    summary: '一段很长的摘要'.repeat(15),
    cover_id: 'invalid-cover',
  };
  await page.route('**/api/contents?*', (r) =>
    r.fulfill({ json: { ...data, items: [item], total: 1 } }),
  );
  await page.route('**/api/files/invalid-cover?*', (r) =>
    r.fulfill({ status: 404, json: { error: '不存在' } }),
  );
  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('.m-text-cover h3')).toHaveText(item.title);
    await expect(page.locator('.m-card-cover')).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `work/mobile-regression/long-cover-${width}.png` });
  }
  await page.unroute('**/api/contents?*');
  await page.setViewportSize({ width: 761, height: 900 });
  await expect(page.locator('.community-layout')).toBeVisible();
  await expect(page.locator('.m-bottom-nav,.m-home')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/mobile-app/);
});

test('手机管理员菜单、消息已读与三页截图', async ({ page }) => {
  await mobile(page, 'admin');
  await page.goto('/me?tab=menu');
  await expect(
    page.getByRole('dialog').getByRole('link', { name: '管理后台', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.goto('/notifications');
  await page.getByRole('button', { name: '全部已读', exact: true }).click();
  await expect(page.locator('.notification.unread')).toHaveCount(0);
  for (const [name, url] of [
    ['home', '/'],
    ['discuss', '/forum'],
    ['mine', '/me'],
  ]) {
    await page.goto(url);
    await ready(page);
    await noOverflow(page);
    await page.screenshot({ path: `outputs/mobile-${name}.png` });
  }
});
