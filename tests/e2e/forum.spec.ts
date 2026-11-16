import { loginAs } from './auth';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
const access = JSON.parse(readFileSync('work/e2e-credentials.json', 'utf8'));
const login = (page: Page, username = 'lin.xia') => loginAs(page, username);
async function approved(page: Page, cid: string) {
  await expect
    .poll(async () => {
      const r = await page.request.get('/api/contents/' + cid);
      return (await r.json()).revision?.status;
    })
    .toBe('approved');
  await page.reload();
}
test('论坛发帖、草稿、附件、引用、关注、采纳和版主锁帖的完整流程', async ({ page, browser }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto('/forum/new');
  await page.getByLabel('话题类型', { exact: true }).selectOption('question');
  const title = 'E2E 论坛问题 ' + Date.now();
  await page.getByLabel('话题标题', { exact: true }).fill(title);
  await page
    .getByLabel('话题正文', { exact: true })
    .fill('## 场景说明\n\n如何验证共享技能的运行环境？请给出可以逐项检查的方法。');
  await page.getByLabel('话题正文上传附件', { exact: true }).setInputFiles({
    name: 'environment-check.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('检查依赖版本、工作目录和输入文件。'),
  });
  await expect(page.locator('.media-file-card')).toContainText('environment-check.md');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/forum\/edit\//);
  await page.getByRole('button', { name: '发布话题', exact: true }).click();
  await expect(page).toHaveURL(/\/forum\/[\da-f-]{36}$/);
  const cid = page.url().split('/').pop()!;
  await approved(page, cid);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('.forum-post-files')).toContainText('environment-check.md');
  const memberContext = await browser.newContext(),
    member = await memberContext.newPage();
  await login(member, 'chen.yu');
  await member.goto('/forum/' + cid);
  await member.getByRole('button', { name: '关注话题', exact: true }).click();
  await expect(member.getByRole('button', { name: '已关注', exact: true })).toBeVisible();
  await member
    .getByLabel('回复内容', { exact: true })
    .fill('先检查依赖版本，再用示例输入跑通最短流程。');
  await member.getByRole('button', { name: '发表回复', exact: true }).click();
  await expect
    .poll(async () => {
      const r = await member.request.get('/api/contents/' + cid + '/comments');
      return (await r.json()).items[0]?.status;
    })
    .toBe('approved');
  await page.reload();
  await page.getByRole('button', { name: '引用回复', exact: true }).click();
  await expect(page.locator('.forum-reply-form .reply-quote')).toContainText('先检查依赖版本');
  await page.getByLabel('回复内容', { exact: true }).fill('按这个顺序已经跑通了，谢谢补充！');
  await page.getByRole('button', { name: '发表回复', exact: true }).click();
  await expect
    .poll(async () => {
      const r = await page.request.get('/api/contents/' + cid + '/comments');
      return (await r.json()).items.filter((x: any) => x.status === 'approved').length;
    })
    .toBe(2);
  await page.reload();
  await page.getByRole('button', { name: '采纳回答', exact: true }).first().click();
  await expect(page.locator('.accepted-label')).toBeVisible();
  await expect(page.locator('.topic-page-heading')).toContainText('已解决');
  await page.getByLabel('只看楼主', { exact: true }).check();
  await expect(page.locator('.forum-replies .forum-post')).toHaveCount(1);
  await expect(page.locator('.forum-replies .reply-quote')).toBeVisible();
  await page.getByLabel('只看楼主', { exact: true }).uncheck();
  await member.goto('/forum?scope=following');
  await expect(member.locator('.topic-row').filter({ hasText: title })).toBeVisible();
  await member.goto('/notifications');
  await expect(member.locator('main')).toContainText('你关注的话题有了新回复');
  const adminContext = await browser.newContext(),
    admin = await adminContext.newPage();
  await login(admin, 'admin');
  await admin.goto('/forum/' + cid);
  await admin.getByRole('button', { name: '锁定话题', exact: true }).click();
  await expect(admin.getByRole('button', { name: '解锁话题', exact: true })).toBeVisible();
  await admin.getByRole('button', { name: '置顶话题', exact: true }).click();
  await expect(admin.getByRole('button', { name: '取消置顶', exact: true })).toBeVisible();
  await member.goto('/forum/' + cid);
  await expect(member.locator('.forum-reply-form')).toContainText('此话题已锁定');
  await expect(member.getByLabel('回复内容')).toHaveCount(0);
  await expect(page.locator('body')).toBeVisible();
  expect(errors).toEqual([]);
  await memberContext.close();
  await adminContext.close();
});
test('所有资源详情均提供关联讨论，创建后可返回该资源', async ({ page }) => {
  await login(page);
  let resourceId = '';
  for (const type of ['experience', 'project', 'skill', 'prompt']) {
    const r = await page.request.get('/api/contents?type=' + type + '&limit=1');
    const item = (await r.json()).items[0];
    resourceId = item.id;
    await page.goto('/content/' + resourceId);
    await expect(page.getByRole('heading', { name: '围绕这份内容的讨论' })).toBeVisible();
    await page.getByRole('link', { name: '发起讨论', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/forum/new\\?related=' + resourceId));
    await expect(page.locator('.notice')).toContainText(item.title);
  }
  const title = 'E2E 关联讨论 ' + Date.now();
  await page.getByLabel('话题标题', { exact: true }).fill(title);
  await page
    .getByLabel('话题正文', { exact: true })
    .fill('这个提示词还适合哪些场景？欢迎补充具体的输入示例。');
  await page.getByRole('button', { name: '发布话题', exact: true }).click();
  await expect(page).toHaveURL(/\/forum\/[\da-f-]{36}$/);
  const cid = page.url().split('/').pop()!;
  await approved(page, cid);
  await expect(page.locator('.notice a')).toHaveAttribute('href', '/content/' + resourceId);
  await page.goto('/content/' + resourceId);
  await expect(page.locator('.forum-preview')).toContainText(title);
});
test('手机论坛版块、搜索和发帖表单无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page
    .getByRole('navigation', { name: '手机导航' })
    .getByRole('link', { name: '讨论', exact: true })
    .click();
  await expect(page.locator('.m-topic').first()).toBeVisible();
  await page.getByRole('button', { name: '筛选讨论', exact: true }).click();
  await expect(page.getByLabel('论坛版块')).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '搜索讨论', exact: true }).click();
  await page.getByLabel('搜索关键词', { exact: true }).fill('欢迎来到讨论区');
  await page.getByRole('dialog').getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.m-topic')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.locator('.m-topic-title').click();
  await expect(page.locator('.forum-post').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto('/forum/new');
  await expect(page.getByLabel('话题标题')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
