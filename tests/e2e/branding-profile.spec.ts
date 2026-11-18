import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { loginAs } from './auth';

const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );

test('论坛标识和插画在登录与首页展示，首页左右两栏从轮播下方对齐', async ({ page }) => {
  await page.goto('/');
  const publicSite = await (await page.request.get('/api/public')).json();
  await expect(page.locator('.brand-title')).toHaveText(publicSite.name);
  await expect(page.locator('.brand-wordmark')).toHaveJSProperty('complete', true);
  await expect(page.locator('.login-illustration')).toBeVisible();
  await expect(page.locator('.login-illustration')).toHaveJSProperty('naturalWidth', 768);
  await page.screenshot({ path: 'outputs/多端论坛-登录页.png', fullPage: true });
  await loginAs(page);
  await expect(page.locator('.carousel-image')).toBeVisible();
  await expect(page.locator('.carousel-image')).toHaveJSProperty('complete', true);
  for (const width of [1440, 1200, 900]) {
    await page.setViewportSize({ width, height: 1000 });
    const hero = await page.locator('.hero').boundingBox(),
      discussion = await page.locator('.community-feed > .forum-preview').boundingBox(),
      share = await page.locator('.invitation-card').boundingBox(),
      category = await page.locator('.category-shortcuts').boundingBox(),
      feed = await page.locator('.community-feed').boundingBox();
    expect(Math.abs(discussion!.y - share!.y)).toBeLessThan(2);
    expect(discussion!.y - (hero!.y + hero!.height)).toBeLessThanOrEqual(32);
    expect(Math.abs(discussion!.width - feed!.width)).toBeLessThan(2);
    expect(Math.abs(category!.width - feed!.width)).toBeLessThan(2);
    expect(share!.x).toBeGreaterThan(discussion!.x + discussion!.width);
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: 'outputs/多端论坛-首页.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: 'outputs/多端论坛-手机首页.png' });
});

test('四种内容导航只有当前一项选中，查询参数和后退不误激活其他项', async ({ page }) => {
  await loginAs(page);
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  for (const [type, label] of [
    ['experience', '经验分享'],
    ['project', '开发项目'],
    ['skill', '技能包'],
    ['prompt', '提示词'],
  ]) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp('type=' + type));
    await expect(nav.locator('.active')).toHaveCount(1);
    await expect(nav.locator('.active')).toHaveText(label);
    await expect(nav.locator('[aria-current=page]')).toHaveCount(1);
  }
  await page.goBack();
  await expect(nav.locator('.active')).toHaveText('技能包');
  await page.goto('/explore?q=project&type=experience');
  await expect(nav.locator('.active')).toHaveText('经验分享');
  await expect(nav.locator('.active')).toHaveCount(1);
});

test('四类内容的正文、关联讨论和评论边缘一致，手机无横向溢出', async ({ page }) => {
  await loginAs(page);
  for (const type of ['experience', 'project', 'skill', 'prompt']) {
    const item = (await (await page.request.get('/api/contents?type=' + type + '&limit=1')).json())
      .items[0];
    await page.goto('/content/' + item.id);
    await expect(page.locator('.article')).toBeVisible();
    const article = await page.locator('.article').boundingBox();
    for (const selector of ['.detail-main > .forum-preview', '.comments-section']) {
      const box = await page.locator(selector).boundingBox();
      expect(Math.abs(box!.x - article!.x)).toBeLessThan(2);
      expect(Math.abs(box!.width - article!.width)).toBeLessThan(2);
    }
  }
  await page.locator('.detail-main > .forum-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'outputs/多端论坛-讨论对齐.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});

test('头像选择预览、取消、保存后在页头/作者/帖子/评论同步，刷新后保留且可移除', async ({
  page,
}) => {
  await loginAs(page, 'chen.yu');
  await page.goto('/me?tab=settings');
  const me = (await (await page.request.get('/api/auth/me')).json()).user;
  const image = await sharp({
    create: { width: 480, height: 320, channels: 3, background: '#50a9ce' },
  })
    .png()
    .toBuffer();
  const input = page.getByLabel('上传头像', { exact: true });
  await input.setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('img', { name: '新头像预览' })).toBeVisible();
  await page.locator('.avatar-settings').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('img', { name: '新头像预览' })).toHaveCount(0);
  await input.setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: image });
  await page.getByRole('button', { name: '保存头像', exact: true }).click();
  await expect(page.locator('.profile-link .avatar img')).toHaveJSProperty('naturalWidth', 256);
  await page.reload();
  await expect(page.locator('.profile-hero .avatar img')).toHaveJSProperty('naturalWidth', 256);
  await page.screenshot({ path: 'outputs/多端论坛-个人头像.png' });
  await page.goto('/author/' + me.id);
  await expect(page.locator('.profile-hero .avatar img')).toBeVisible();
  const content = (
    await (await page.request.get('/api/contents?author=' + me.id + '&limit=1')).json()
  ).items[0];
  if (content) {
    await page.goto((content.type === 'discussion' ? '/forum/' : '/content/') + content.id);
    await expect(page.locator(`img[src^="/api/avatars/${me.id}"]`).first()).toBeVisible();
  }
  const article = (await (await page.request.get('/api/contents?type=experience&limit=1')).json())
    .items[0];
  await page.goto('/content/' + article.id);
  const marker = 'E2E 头像同步 ' + Date.now();
  await page.getByRole('textbox', { name: '评论内容', exact: true }).fill(marker);
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/comments'),
  );
  await page.getByRole('button', { name: '发表评论', exact: true }).click();
  const commentId = (await (await response).json()).id;
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get('/api/contents/' + article.id + '/comments?limit=50')
          ).json()
        ).items.find((cm: any) => cm.id === commentId)?.status,
    )
    .toBe('approved');
  await page.reload();
  await expect(
    page.locator('.comment').filter({ hasText: marker }).locator('.avatar img'),
  ).toHaveJSProperty('naturalWidth', 256);
  const session = await (await page.request.get('/api/auth/me')).json();
  await page.request.delete('/api/comments/' + commentId, {
    headers: { origin: 'http://127.0.0.1:3100', 'x-csrf-token': session.csrf },
  });
  await page.goto('/me?tab=settings');
  await page.getByRole('button', { name: '移除头像', exact: true }).click();
  await expect(page.locator('.profile-link .avatar img')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.profile-hero .avatar img')).toHaveCount(0);
});
