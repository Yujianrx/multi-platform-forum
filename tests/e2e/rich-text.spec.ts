import { test, expect, type Page, type Locator } from '@playwright/test';
import { loginAs } from './auth';

async function pasteHtml(box: Locator, html: string) {
  await box.focus();
  await box.evaluate((el, html) => {
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, html);
}
async function draft(page: Page, body: string) {
  const me = await (await page.request.get('/api/auth/me')).json();
  const tax = await (await page.request.get('/api/taxonomy')).json();
  const headers = { 'x-csrf-token': me.csrf, origin: 'http://127.0.0.1:3100' };
  const created = await page.request.post('/api/forum/topics', {
    headers,
    data: { categoryId: tax.categories[0].id, kind: 'discussion' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const saved = await page.request.put('/api/contents/' + id, {
    headers,
    data: {
      data: {
        title: 'E2E 富文本兼容 ' + Date.now(),
        summary: '旧版内容的富文本兼容验证',
        body,
        categoryId: tax.categories[0].id,
        tags: [],
        visibility: 'company',
        departments: [],
        coverId: null,
        attachments: [],
        fields: {},
      },
      submit: false,
      baseRevisionId: null,
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto('/forum/edit/' + id);
  return id;
}

test('历史 Markdown 在编辑时显示真实格式，保存重载和发布保持表格、任务、代码与表情', async ({
  page,
}) => {
  await loginAs(page, 'zhou.ning');
  const body =
    '# 项目实践\n\n这是 **重要经验** 和 *补充说明*，含 ~~旧方案~~ 与 `inline()`。<u>需要跟进</u>\n\n> 同事的建议\n\n1. 第一步\n2. 第二步\n\n- [x] 已完成\n- [ ] 待跟进\n\n| 工具 | 用途 |\n| --- | --- |\n| 助手 | 总结<br>跟进 |\n\n```js\nconst ready = true;\n```\n\n前一行  \n后一行\n\n![谢谢](/stickers/thanks.svg)\n\n[资料](https://example.com/docs)';
  const id = await draft(page, body);
  const box = page.getByRole('textbox', { name: '话题正文', exact: true });
  await expect(box.locator('h1')).toHaveText('项目实践');
  await expect(box.locator('strong')).toHaveText('重要经验');
  await expect(box.locator('em')).toHaveText('补充说明');
  await expect(box.locator('s')).toHaveText('旧方案');
  await expect(box.locator('u')).toHaveText('需要跟进');
  await expect(box.locator('table')).toContainText('总结');
  await expect(box.locator('input[type=checkbox]').first()).toBeChecked();
  await expect(box.locator('pre code')).toHaveText('const ready = true;');
  await expect(box.locator('img[src]')).toBeVisible();
  await expect(box).not.toContainText('![谢谢]');
  // A real edit forces serialization; merely loading and saving would not exercise the bridge.
  await box.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('新增验证文字');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.reload();
  await expect(box.locator('h1')).toHaveText('项目实践');
  await expect(box.locator('table')).toContainText('总结');
  await expect(box.locator('input[type=checkbox]').first()).toBeChecked();
  await expect(box.locator('pre code')).toHaveText('const ready = true;');
  await expect(box.locator('img[src]')).toBeVisible();
  const current = await (await page.request.get('/api/contents/' + id)).json();
  expect(current.revision.data.body).toContain('- [x]');
  expect(current.revision.data.body).toContain('/stickers/thanks.svg');
  await page.getByRole('button', { name: '发布话题', exact: true }).click();
  await expect
    .poll(
      async () => (await (await page.request.get('/api/contents/' + id)).json()).revision.status,
    )
    .toBe('approved');
  await page.reload();
  const posted = page.locator('.forum-post').first();
  await expect(posted.locator('h1')).toHaveText('项目实践');
  await expect(posted.locator('table')).toContainText('总结');
  await expect(posted.locator('table br')).toHaveCount(1);
  await expect(posted.locator('u')).toHaveText('需要跟进');
  await expect(posted.locator('.prose')).not.toContainText('<br>');
  await expect(posted.locator('pre code')).toHaveText('const ready = true;\n');
  await expect(posted.locator('.sticker-image')).toBeVisible();
});

test('光标位置插入表情、选区格式、键盘撤销与中文组合输入', async ({ page }) => {
  await loginAs(page, 'zhou.ning');
  await page.goto('/forum/new');
  const box = page.getByRole('textbox', { name: '话题正文', exact: true });
  const composer = page.locator('.media-composer');
  await box.fill('前文后文');
  await box.press('ArrowLeft');
  await box.press('ArrowLeft');
  await composer.getByRole('button', { name: '表情', exact: true }).click();
  await page.getByRole('button', { name: '表情包：谢谢' }).click();
  expect(
    await box.locator('p').evaluate((el) =>
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE || (n as HTMLElement).hasAttribute('src'))
        .map((n) => (n.nodeType === Node.TEXT_NODE ? n.textContent : (n as HTMLElement).tagName)),
    ),
  ).toEqual(['前文', 'IMG', '后文']);
  await box.press('ControlOrMeta+z');
  await expect(box.locator('img[src]')).toHaveCount(0);
  await box.press('ControlOrMeta+Shift+z');
  await expect(box.locator('img[src]')).toHaveCount(1);
  await box.fill('中文输入');
  await box.press('ControlOrMeta+A');
  await composer.getByRole('button', { name: '加粗', exact: true }).click();
  await expect(box.locator('strong')).toHaveText('中文输入');
  await expect(composer.getByRole('button', { name: '加粗', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await composer.getByRole('button', { name: '下划线', exact: true }).click();
  await expect(box.locator('u')).toHaveText('中文输入');
  await composer.getByRole('button', { name: '清除格式' }).click();
  await expect(box.locator('u')).toHaveCount(0);
  await expect(box.locator('strong')).toHaveCount(0);
  await box.press('ArrowRight');
  const session = await page.context().newCDPSession(page);
  await session.send('Input.imeSetComposition', {
    text: '测试',
    selectionStart: 2,
    selectionEnd: 2,
  });
  await session.send('Input.insertText', { text: '测试' });
  await expect(box).toHaveText('中文输入测试');
  await session.detach();
  await composer.getByLabel('段落样式').selectOption('2');
  await expect(box.locator('h2')).toHaveText('中文输入测试');
  await composer.getByRole('button', { name: '全屏编辑' }).click();
  await expect(composer).toHaveClass(/is-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(composer).not.toHaveClass(/is-fullscreen/);
});

test('粘贴富文本保留基础格式，屏蔽脚本、外链图片及危险链接', async ({ page }) => {
  await loginAs(page, 'zhou.ning');
  await page.goto('/forum/new');
  const box = page.getByRole('textbox', { name: '话题正文', exact: true });
  const remoteRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('track.invalid')) remoteRequests.push(r.url());
  });
  await pasteHtml(
    box,
    '<h2>会议记录</h2><p><strong>重点</strong>与<em>说明</em> <a href="https://example.com">资料</a></p><ul><li>行动事项</li></ul><script>window.richTextInjected=1</script><img src="https://track.invalid/pixel" onerror="window.richTextInjected=2"><p><a href="javascript:alert(1)">危险链接</a></p>',
  );
  await expect(box.locator('h2')).toHaveText('会议记录');
  await expect(box.locator('strong')).toHaveText('重点');
  await expect(box.locator('em')).toHaveText('说明');
  await expect(box.locator('ul')).toContainText('行动事项');
  await expect(box.locator('a')).toHaveAttribute('href', 'https://example.com');
  await expect(box.locator('script,img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).richTextInjected)).toBeUndefined();
  expect(remoteRequests).toEqual([]);
  await box.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.locator('.media-composer').getByRole('button', { name: '插入表格' }).click();
  await expect(box.locator('table tr')).toHaveCount(3);
  await page.getByRole('button', { name: '添加行', exact: true }).click();
  await expect(box.locator('table tr')).toHaveCount(4);
  await page.getByRole('button', { name: '删除表格', exact: true }).click();
  await expect(box.locator('table')).toHaveCount(0);
});

test('评论长度限制、纯表情发布、发送后清空与撤销隔离', async ({ page }) => {
  await loginAs(page, 'chen.yu');
  const item = (await (await page.request.get('/api/contents?type=experience&limit=1')).json())
    .items[0];
  await page.goto('/content/' + item.id);
  const box = page.getByRole('textbox', { name: '评论内容', exact: true });
  const composer = page.locator('.comment-form .media-composer');
  await box.fill('中'.repeat(5000));
  await expect(box).toHaveText('中'.repeat(5000));
  await box.press('End');
  await page.keyboard.insertText('多');
  await expect(composer.getByRole('alert')).toContainText('长度上限');
  await expect(box).toHaveText('中'.repeat(5000));
  await box.fill('');
  await composer.getByRole('button', { name: '表情', exact: true }).click();
  await page.getByRole('button', { name: '表情包：收到' }).click();
  await expect(box.locator('img[src]')).toBeVisible();
  await expect(page.getByRole('button', { name: '发表评论', exact: true })).toBeEnabled();
  const submitted = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/comments'),
  );
  await page.getByRole('button', { name: '发表评论', exact: true }).click();
  const response = await submitted;
  expect(response.ok()).toBeTruthy();
  const commentId = (await response.json()).id;
  await expect(box.locator('img[src]')).toHaveCount(0);
  await expect(box).toHaveText('');
  await expect(composer.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await box.press('ControlOrMeta+z');
  await expect(box.locator('img[src]')).toHaveCount(0);
  const me = await (await page.request.get('/api/auth/me')).json();
  const removed = await page.request.delete('/api/comments/' + commentId, { headers: { origin: 'http://127.0.0.1:3100', 'x-csrf-token': me.csrf } });
  expect(removed.ok()).toBeTruthy();
});
