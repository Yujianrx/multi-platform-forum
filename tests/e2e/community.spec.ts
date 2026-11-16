import { loginAs } from './auth';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import sharp from 'sharp';
const access = JSON.parse(readFileSync('work/e2e-credentials.json', 'utf8'));
test('后台图片 Logo、站点名称和轮播编辑真实生效', async ({ page }) => {
  await login(page);
  await page.goto('/admin?section=settings');
  const name = page.getByLabel('站点名称', { exact: true });
  await expect(name).toBeVisible();
  const originalName = await name.inputValue();
  await name.fill(originalName + ' · 配置验收');
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.locator('.brand')).toContainText('配置验收');
  await page.getByLabel('站点名称', { exact: true }).fill(originalName);
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.locator('.brand')).not.toContainText('配置验收');
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#e86946' } })
    .png()
    .toBuffer();
  await page
    .getByLabel('图片 Logo', { exact: true })
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.brand-image')).toBeVisible();
  await page.getByRole('button', { name: '移除图片 Logo' }).click();
  await expect(page.locator('.brand-image')).toHaveCount(0);
  await page.goto('/admin?section=banners');
  await page.getByRole('button', { name: '编辑', exact: true }).first().click();
  const title = page.getByLabel('轮播标题', { exact: true });
  const originalTitle = await title.inputValue();
  await title.fill('轮播编辑验收');
  await page.getByRole('button', { name: '确认保存' }).click();
  await expect(page.locator('table')).toContainText('轮播编辑验收');
  await page
    .getByRole('row')
    .filter({ hasText: '轮播编辑验收' })
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  await page.getByLabel('轮播标题', { exact: true }).fill(originalTitle);
  await page.getByRole('button', { name: '确认保存' }).click();
  await expect(page.locator('table')).toContainText(originalTitle);
});
const login = loginAs;
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}
test('桌面首页、搜索、详情、榜单和后台可实际浏览', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await expect(page.locator('.content-card')).toHaveCount(9);
  await page.screenshot({ path: 'outputs/首页-桌面.png', fullPage: true });
  await noOverflow(page);
  await page.getByLabel('全站搜索').fill('会议纪要');
  await page.getByLabel('全站搜索').press('Enter');
  await expect(page.locator('.content-card')).toHaveCount(1);
  await page.getByRole('link', { name: '一个懂团队的会议纪要助手', exact: true }).click();
  await expect(page.locator('.article h1')).toHaveText('一个懂团队的会议纪要助手');
  await page.goto('/rankings');
  await expect(page.locator('.ranking-card-header').first()).toBeVisible();
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '审核与安全服务' })).toBeVisible();
  await page.screenshot({ path: 'outputs/管理后台-桌面.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('邀请码后台生成、真实注册、发布提示词、评论与收藏完整闭环', async ({ page, browser }) => {
  await login(page);
  await page.goto('/admin?section=invitations');
  await page.getByRole('button', { name: '生成邀请码', exact: true }).click();
  await page.getByLabel('邀请码名称').fill('端到端验收');
  await page.getByRole('button', { name: '确认保存' }).click();
  const code = await page.locator('.secret-box code').innerText();
  expect(code.length).toBeGreaterThan(20);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' }),
    member = await context.newPage();
  await member.goto('/');
  await member.getByRole('button', { name: '邀请注册', exact: true }).click();
  await expect(member.getByLabel('账号', { exact: true })).toHaveAccessibleDescription(
    /3–40.*不区分大小写/,
  );
  await expect(member.getByLabel('设置新密码', { exact: true })).toHaveAccessibleDescription(
    /6–20.*无需组合/,
  );
  await expect(member.getByLabel('邀请码', { exact: true })).toHaveAccessibleDescription(
    /向管理员领取.*部门/,
  );
  await member.screenshot({ path: 'outputs/邀请注册-桌面.png', fullPage: true });
  await member.setViewportSize({ width: 390, height: 844 });
  expect(await member.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await member.screenshot({ path: 'outputs/邀请注册-手机.png', fullPage: true });
  await member.setViewportSize({ width: 1280, height: 1000 });
  await member.getByLabel('姓名', { exact: true }).fill('端到端测试成员');
  await member.getByLabel('账号', { exact: true }).fill('e2e.' + Date.now());
  await member.getByLabel('设置新密码', { exact: true }).fill('827364');
  await member.getByLabel('确认密码', { exact: true }).fill('827365');
  await member.getByLabel('邀请码', { exact: true }).fill(code);
  await member.getByRole('button', { name: '加入共创社区', exact: true }).click();
  await expect(member.getByRole('alert')).toHaveText('两次密码不一致，请重新确认');
  await member.getByLabel('确认密码', { exact: true }).fill('827364');
  await member.getByRole('button', { name: '加入共创社区', exact: true }).click();
  await expect(member.locator('.site-header')).toBeVisible();
  await member.goto('/editor');
  await member.getByRole('button', { name: /提示词 分享经过验证/ }).click();
  await member.getByLabel('标题 *', { exact: true }).fill('E2E 真实发布提示词 ' + Date.now());
  const title = await member.getByLabel('标题 *', { exact: true }).inputValue();
  await member
    .getByLabel('摘要 *', { exact: true })
    .fill('这份提示词用于验证真实注册到发布的端到端流程。');
  await member
    .getByLabel('提示词正文 *', { exact: true })
    .fill('请只根据给定资料总结事实，不要补充未经确认的信息。');
  await expect(member.getByText(/已保存/)).toBeVisible();
  await member.getByRole('button', { name: '3 预览与发布', exact: true }).click();
  await expect(member.locator('.preview-sheet h1')).toHaveText(title);
  await member.getByRole('button', { name: '发布内容', exact: true }).click();
  await expect(member).toHaveURL(/\/me\?tab=review/);
  await expect
    .poll(async () => {
      const r = await member.request.get('/api/contents?mine=published');
      return (await r.json()).items.some((c: any) => c.title === title);
    })
    .toBe(true);
  await member.goto('/me');
  await member.getByRole('link', { name: title, exact: true }).click();
  const contentUrl = member.url();
  await expect(member.locator('.prompt-block')).toContainText('只根据给定资料');
  await member.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(member.getByRole('button', { name: '已收藏', exact: true })).toBeVisible();
  await member.reload();
  await expect(member.getByRole('button', { name: '已收藏', exact: true })).toBeVisible();
  await page.goto(contentUrl);
  await page
    .getByLabel('评论内容', { exact: true })
    .fill('已经完成实际发布验证，欢迎继续补充使用说明。');
  await page.getByRole('button', { name: '发表评论', exact: true }).click();
  await expect
    .poll(async () => {
      const r = await page.request.get(
        '/api/contents/' + contentUrl.split('/').pop() + '/comments',
      );
      return (await r.json()).items[0]?.status;
    })
    .toBe('approved');
  await page.reload();
  await expect(page.locator('.comment')).toContainText('已经完成实际发布验证');
  await context.close();
});
test('技能包上传、版本发布和真实下载可用', async ({ page, browser }) => {
  await login(page, 'chen.yu');
  await page.goto('/editor');
  await page.getByRole('button', { name: /技能包 打包工作流/ }).click();
  const title = 'E2E 技能包 ' + Date.now();
  await page.getByLabel('标题 *', { exact: true }).fill(title);
  await page
    .getByLabel('摘要 *', { exact: true })
    .fill('真实 ZIP 文件上传和版本下载的完整流程验证。');
  await page
    .getByLabel('正文 *', { exact: true })
    .fill('## 技能说明\n\n下载后阅读 SKILL.md，平台不会执行文件。');
  mkdirSync('work/e2e-assets', { recursive: true });
  writeFileSync(
    'work/e2e-assets/skill.zip',
    zipSync({ 'SKILL.md': strToU8('# E2E skill\nThis is data, never execute it.') }),
  );
  await page.locator('.upload-zone input[type=file]').setInputFiles('work/e2e-assets/skill.zip');
  await expect(page.locator('.editor-file')).toContainText('skill.zip');
  await page.getByRole('button', { name: '3 预览与发布', exact: true }).click();
  await page.getByRole('button', { name: '发布内容', exact: true }).click();
  await expect
    .poll(async () => {
      const r = await page.request.get('/api/contents?mine=published');
      return (await r.json()).items.some((c: any) => c.title === title);
    })
    .toBe(true);
  await page.goto('/me');
  await page.getByRole('link', { name: title, exact: true }).click();
  const cid = page.url().split('/').pop();
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3100' }),
    member = await context.newPage();
  await login(member, 'zhou.ning');
  await member.goto('/content/' + cid);
  const [download] = await Promise.all([
    member.waitForEvent('download'),
    member.getByRole('link', { name: '下载文件', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('skill.zip');
  expect(await download.failure()).toBeNull();
  await expect
    .poll(async () => {
      const r = await member.request.get('/api/contents/' + cid);
      return (await r.json()).metrics.downloads;
    })
    .toBe(1);
  await context.close();
});
test('手机首页、发布表单、详情和排行榜无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'lin.xia');
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: 'outputs/首页-手机.png', fullPage: true });
  await page.goto('/rankings');
  await expect(page.locator('.ranking-card-header').first()).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: 'outputs/排行榜-手机.png', fullPage: true });
  await page.goto('/editor');
  await page.getByRole('button', { name: /经验分享 一个方法/ }).click();
  await expect(page.getByLabel('标题 *', { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.getByLabel('标题 *', { exact: true }).fill('手机端草稿测试');
  await page.screenshot({ path: 'outputs/发布表单-手机.png', fullPage: true });
  await page.goto('/explore?type=project');
  await page.locator('.content-card h3 a').first().click();
  await expect(page.locator('.article h1')).toBeVisible();
  await noOverflow(page);
});
