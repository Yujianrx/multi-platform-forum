import { loginAs } from './auth';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
const access = JSON.parse(readFileSync('work/e2e-credentials.json', 'utf8'));
const login = (page: Page, username = 'chen.yu') => loginAs(page, username);
async function png() {
  return sharp({ create: { width: 180, height: 100, channels: 3, background: '#edb56e' } })
    .png()
    .toBuffer();
}
async function ready(page: Page, id: string) {
  await expect
    .poll(async () => {
      const r = await page.request.get('/api/contents/' + id);
      return (await r.json()).revision?.status;
    })
    .toBe('approved');
  await page.reload();
}
test('图文评论支持表情包、Emoji、图片粘贴、附件与刷新后下载', async ({ page }) => {
  await login(page);
  const item = (await (await page.request.get('/api/contents?type=experience&limit=1')).json())
    .items[0];
  await page.goto('/content/' + item.id);
  const box = page.getByLabel('评论内容', { exact: true }),
    editor = page.locator('.comment-form .media-composer');
  const marker = 'E2E 图文评论 ' + Date.now();
  await box.fill(marker);
  await editor.getByRole('button', { name: '表情', exact: true }).click();
  await page.getByRole('button', { name: '表情包：收到', exact: true }).click();
  await expect(box.locator('img[src="/stickers/received.svg"]')).toBeVisible();
  await editor.getByRole('button', { name: '表情', exact: true }).click();
  await page.getByRole('button', { name: '常用', exact: true }).click();
  await page.getByRole('button', { name: '表情：👍', exact: true }).click();
  await expect(box).toContainText('👍');
  const bytes = await png();
  await box.evaluate((el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, bytes.toString('base64'));
  await expect(editor.locator('.media-file-card')).toContainText('pasted.png');
  await page.getByLabel('评论内容上传附件', { exact: true }).setInputFiles({
    name: 'reply-notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('真实的评论附件下载验收'),
  });
  await expect(editor.locator('.media-file-card')).toHaveCount(2);
  await expect(editor.locator('.sticker-image')).toBeVisible();
  await expect(box.locator('.content-image')).toBeVisible();
  await page.getByRole('button', { name: '发表评论', exact: true }).click();
  await expect(editor.locator('.media-file-card')).toHaveCount(0);
  await expect
    .poll(async () => {
      const r = await page.request.get('/api/contents/' + item.id + '/comments?limit=50');
      return (await r.json()).items.find((x: any) => x.body.includes(marker))?.status;
    })
    .toBe('approved');
  await page.reload();
  const posted = page.locator('.comment').filter({ hasText: marker }).last();
  await expect(posted.locator('.sticker-image')).toBeVisible();
  await expect(posted.locator('.content-image')).toBeVisible();
  await expect(posted.locator('.content-image')).toHaveJSProperty('naturalWidth', 180);
  const download = page.waitForEvent('download');
  await posted.getByRole('link').filter({ hasText: 'reply-notes.md' }).click();
  expect((await download).suggestedFilename()).toBe('reply-notes.md');
  await page.locator('.comment-form').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'outputs/图文评论-桌面.png', fullPage: true });
});
test('论坛发布和回复共用图片表情附件编辑器，手机显示正常', async ({ page }) => {
  await login(page, 'lin.xia');
  await page.goto('/forum/new');
  const title = 'E2E 媒体话题 ' + Date.now();
  await page.getByLabel('话题标题', { exact: true }).fill(title);
  const editor = page.locator('.media-composer');
  await page.getByLabel('话题正文', { exact: true }).fill('记录一次图文协作的尝试。');
  await editor.getByRole('button', { name: '表情', exact: true }).click();
  await page.getByRole('button', { name: '表情包：加油', exact: true }).click();
  await page
    .getByLabel('话题正文上传图片', { exact: true })
    .setInputFiles({ name: 'topic.png', mimeType: 'image/png', buffer: await png() });
  await expect(editor.locator('.media-file-card')).toHaveCount(1);
  await page.getByLabel('话题正文上传附件', { exact: true }).setInputFiles({
    name: 'topic-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('话题附件说明'),
  });
  await expect(editor.locator('.media-file-card')).toHaveCount(2);
  await page.getByRole('button', { name: '发布话题', exact: true }).click();
  await expect(page).toHaveURL(/\/forum\/[a-f\d-]{36}$/);
  const id = page.url().split('/').pop()!;
  await ready(page, id);
  await expect(page.locator('.forum-post').first().locator('.sticker-image')).toBeVisible();
  await expect(page.locator('.forum-post').first().locator('.content-image')).toBeVisible();
  const reply = page.locator('.forum-reply-form .media-composer');
  await page.getByLabel('回复内容', { exact: true }).fill('E2E 媒体回复');
  await page.getByLabel('回复内容上传附件', { exact: true }).setInputFiles({
    name: 'forum-reply.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('楼层回复附件'),
  });
  await expect(reply.locator('.media-file-card')).toHaveCount(1);
  await page.getByRole('button', { name: '发表回复', exact: true }).click();
  await expect
    .poll(async () => {
      const r = await page.request.get('/api/contents/' + id + '/comments');
      return (await r.json()).items[0]?.status;
    })
    .toBe('approved');
  await page.reload();
  await expect(page.locator('.forum-replies')).toContainText('forum-reply.txt');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.forum-reply-form').scrollIntoViewIfNeeded();
  await reply.getByRole('button', { name: '表情', exact: true }).click();
  await expect(page.getByRole('region', { name: '表情选择器' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'outputs/图文编辑器-手机.png', fullPage: true });
  await page.getByRole('button', { name: '关闭表情选择器' }).click();
});
test('经验发布支持格式工具、表情包、拖放图片和附件，保存后仍可编辑', async ({ page }) => {
  await login(page, 'lin.xia');
  await page.goto('/editor');
  await page.getByRole('button', { name: /经验分享/ }).click();
  await expect(page).toHaveURL(/\/editor\//);
  const title = 'E2E 图文经验 ' + Date.now();
  await page.getByLabel('标题 *', { exact: true }).fill(title);
  await page.getByLabel('摘要 *', { exact: true }).fill('验证统一编辑器中的图文、表情和附件。');
  const editor = page.locator('.editor-main .media-composer'),
    body = page.getByLabel('正文 *', { exact: true });
  await body.fill('正文中的重要经验');
  await body.press('ControlOrMeta+A');
  await editor.getByRole('button', { name: '加粗', exact: true }).click();
  await expect(body.locator('strong')).toHaveText('正文中的重要经验');
  await editor.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(body.locator('strong')).toHaveCount(0);
  await expect(body).toHaveText('正文中的重要经验');
  await editor.getByRole('button', { name: '重做', exact: true }).click();
  await expect(body.locator('strong')).toHaveText('正文中的重要经验');
  await body.press('ArrowRight');
  await editor.getByRole('button', { name: '表情', exact: true }).click();
  await page.getByRole('button', { name: '表情包：赞', exact: true }).click();
  const bytes = await png();
  await editor.evaluate((el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, bytes.toString('base64'));
  await expect(editor.locator('.media-file-card')).toHaveCount(1);
  await page.getByLabel('正文 *上传附件', { exact: true }).setInputFiles({
    name: 'experience.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('经验附件内容'),
  });
  await expect(editor.locator('.media-file-card')).toHaveCount(2);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('草稿已保存');
  await page.reload();
  await expect(body.locator('img[src="/stickers/like.svg"]')).toBeVisible();
  await expect(editor.locator('.media-file-card')).toHaveCount(2);
  await editor.getByRole('button', { name: '全屏编辑', exact: true }).click();
  await expect(editor).toHaveClass(/is-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(editor).not.toHaveClass(/is-fullscreen/);
  await editor.getByRole('button', { name: '表情', exact: true }).click();
  await page.screenshot({ path: 'outputs/图文编辑器-桌面.png', fullPage: true });
  await page.getByRole('button', { name: '关闭表情选择器' }).click();
  await page.getByRole('button', { name: '3 预览与发布', exact: true }).click();
  await page.getByRole('button', { name: '发布内容', exact: true }).click();
  await expect(page).toHaveURL(/\/me\?tab=review/);
});
