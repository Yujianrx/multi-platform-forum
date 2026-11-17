import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './auth';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function ready(page: Page) {
  await expect(page.locator('.m-content-card').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test('所有类型的封面、短长标题、精选与无封面卡片尺寸一致', async ({ page }) => {
  await loginAs(page, 'draft.member');
  const data = await (await page.request.get('/api/contents?resources=1')).json();
  const base = data.items[0];
  const items = ['experience', 'project', 'skill', 'prompt'].map((type, i) => ({
    ...base,
    id: base.id + '-' + i,
    type,
    cover_id: i < 2 ? 'test-cover' : null,
    title: i % 2 ? '一段比较长的项目标题，用于验证两行截断和对齐' : '短标题',
    summary: i % 2 ? '摘要长度不同仍需保持统一高度。' : '',
    featured: i === 1,
  }));
  await page.route('**/api/contents?*', (r) => r.fulfill({ json: { ...data, items, total: 4 } }));
  await page.route('**/api/files/test-cover?*', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#edd9c1"/></svg>',
    }),
  );
  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await ready(page);
    const boxes = await page.locator('.m-content-card').evaluateAll((es) =>
      es.map((e) => {
        const r = e.getBoundingClientRect();
        return { width: r.width, height: r.height, y: r.y };
      }),
    );
    expect(
      Math.max(...boxes.map((b) => b.height)) - Math.min(...boxes.map((b) => b.height)),
    ).toBeLessThan(1);
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1);
    expect(Math.abs(boxes[2].y - boxes[3].y)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `outputs/mobile-aligned-${width}.png`, fullPage: true });
  }
});

test('首页双击和下拉刷新保留筛选，重复手势合并且错误不清空内容', async ({ page }) => {
  await loginAs(page, 'draft.member');
  await page.goto('/?type=project');
  await ready(page);
  let reads = 0,
    fail = false;
  let releaseFirst = () => {};
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  await page.route('**/api/contents?*', async (route) => {
    reads++;
    if (reads === 1) await firstResponse;
    else await new Promise((resolve) => setTimeout(resolve, 250));
    if (fail) return route.fulfill({ status: 503, json: { error: '刷新测试失败' } });
    await route.continue();
  });
  const card = await page.locator('.m-content-card').first().elementHandle();
  const home = page
    .getByRole('navigation', { name: '手机导航' })
    .getByRole('link', { name: '首页', exact: true });
  await home.dblclick();
  await expect.poll(() => reads).toBe(1);
  await home.dblclick();
  expect(reads).toBe(1);
  releaseFirst();
  await expect(page.locator('.m-refresh')).toHaveAttribute('aria-busy', 'false');
  await expect(page).toHaveURL(/type=project/);
  expect(await card!.evaluate((el) => el.isConnected)).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  const pull = async (distance = 170) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 30, y: 360 }],
    });
    for (const y of [380, 410, 360 + distance])
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 30, y }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await pull(60);
  expect(reads).toBe(1);
  await pull();
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator('.m-refresh')).toHaveAttribute('aria-busy', 'false');
  expect(await card!.evaluate((el) => el.isConnected)).toBe(true);
  fail = true;
  await home.dblclick();
  await expect(page.getByRole('alert')).toContainText('刷新失败');
  await expect(page.locator('.m-content-card').first()).toBeVisible();
  await expect(page.locator('.m-refresh')).toHaveAttribute('aria-busy', 'false');
  await cdp.detach();
  await page.goto('/?channel=ranking');
  await expect(page.getByRole('tab', { name: '综合', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  let boardReads = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/honors/board?')) boardReads++;
  });
  await home.dblclick();
  await expect.poll(() => boardReads).toBe(1);
  await expect(page.locator('.m-refresh')).toHaveAttribute('aria-busy', 'false');
});

for (const forum of [false, true])
  test(`${forum ? '论坛' : '文章'}点赞和回复不替换页面，不重新请求正文`, async ({ page }) => {
    await loginAs(page, 'draft.member');
    const me = await (await page.request.get('/api/auth/me')).json();
    const headers = { origin: 'http://127.0.0.1:3100', 'x-csrf-token': me.csrf };
    const topics = await (
      await page.request.get(
        forum ? '/api/forum/topics' : '/api/contents?resources=1&type=experience',
      )
    ).json();
    const id = (forum ? topics.items.find((item: any) => !item.locked) : topics.items[0]).id;
    await page.goto((forum ? '/forum/' : '/content/') + id);
    const root = page.locator(forum ? '.forum-topic-page' : '.detail-page');
    await expect(root).toBeVisible();
    await page.waitForLoadState('networkidle');
    const element = await root.elementHandle();
    const reads: string[] = [];
    page.on('request', (r) => {
      if (
        r.method() === 'GET' &&
        (new URL(r.url()).pathname === '/api/contents/' + id ||
          new URL(r.url()).pathname === '/api/forum/topics/' + id)
      )
        reads.push(r.url());
    });
    const likes = page
      .locator(forum ? '.post-actions' : '.article-interactions')
      .first()
      .getByRole('button', { name: forum ? /^赞同/ : /\d+ 赞/ });
    await likes.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    const liked = page.waitForResponse(
      (r) => r.url().endsWith('/like') && r.request().method() === 'PUT',
    );
    await likes.click();
    expect((await liked).status()).toBe(200);
    await expect(likes).toBeEnabled();
    expect(await element!.evaluate((el) => el.isConnected)).toBe(true);
    expect(Math.abs((await page.evaluate(() => scrollY)) - scroll)).toBeLessThan(5);
    expect(reads).toHaveLength(0);
    // A failed interaction leaves the current values and DOM intact.
    const before = await likes.textContent();
    await page.route('**/api/contents/*/like', (r) =>
      r.fulfill({ status: 503, json: { error: '点赞失败测试' } }),
    );
    await likes.click();
    await expect(page.getByRole('alert')).toContainText('点赞失败测试');
    await expect(likes).toHaveText(before!);
    await page.unroute('**/api/contents/*/like');
    const text = '手机局部更新验证 ' + Date.now();
    await page
      .getByRole('textbox', { name: forum ? '回复内容' : '评论内容', exact: true })
      .fill(text);
    const submitted = page.waitForResponse(
      (r) => r.url().endsWith('/comments') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: forum ? '发表回复' : '发表评论', exact: true }).click();
    const result = await (await submitted).json();
    await expect(page.locator(forum ? '.forum-replies' : '.comments-section')).toContainText(text);
    expect(await element!.evaluate((el) => el.isConnected)).toBe(true);
    expect(reads).toHaveLength(0);
    await page.request.delete('/api/comments/' + result.id, { headers });
    await page.request.put('/api/contents/' + id + '/like', { headers, data: { active: false } });
  });
