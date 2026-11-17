import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './auth';
const created: { cid: string; headers: Record<string, string> }[] = [];
test.afterEach(async ({ page }) => {
  for (const c of created.splice(0)) {
    const response = await page.request.delete('/api/contents/' + c.cid, { headers: c.headers });
    expect(response.status()).toBe(200);
  }
});

async function fixture(page: Page, label: string, withFile = false) {
  const me = await (await page.request.get('/api/auth/me')).json();
  const headers = { Origin: 'http://127.0.0.1:3100', 'X-CSRF-Token': me.csrf };
  const taxonomy = await (await page.request.get('/api/taxonomy')).json();
  const categoryId = taxonomy.categories[0].id;
  const create = await page.request.post('/api/contents', {
    headers,
    data: { type: 'project', categoryId },
  });
  expect(create.status()).toBe(201);
  const cid = (await create.json()).id;
  created.push({ cid, headers });
  const attachments: string[] = [];
  if (withFile) {
    const upload = await page.request.post('/api/contents/' + cid + '/files', {
      headers,
      multipart: {
        file: {
          name: 'project-document.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const file = await upload.json();
    expect(file.scan_status).toBe('review');
    attachments.push(file.id);
  }
  const title = label + ' ' + Date.now();
  const save = await page.request.put('/api/contents/' + cid, {
    headers,
    data: {
      data: {
        title,
        summary: '这是一条独立测试环境内的审核验收内容',
        body: '[dev:review] 项目实施步骤和结果。',
        categoryId,
        visibility: 'company',
        departments: [],
        attachments,
      },
      submit: true,
      baseRevisionId: null,
    },
  });
  expect(save.status()).toBe(200);
  const rid = (await save.json()).revisionId;
  const jobs = await (await page.request.get('/api/admin/moderation?limit=50')).json();
  const job = jobs.items.find((j: any) => j.revision_id === rid);
  expect(job).toBeTruthy();
  return { title, cid, job: job.id, headers, attachments };
}
const card = (page: Page, title: string) =>
  page
    .locator('.review-item')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test('单条通过没有原因输入，并同步通过项目文件', async ({ page }) => {
  await loginAs(page, 'bulkreview.admin');
  const c = await fixture(page, '单条审核验收', true);
  expect((await page.request.get('/api/files/' + c.attachments[0])).status()).toBe(423);
  await page.goto('/admin?section=moderation');
  await card(page, c.title).getByRole('button', { name: '人工复核' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('textarea')).toHaveCount(0);
  await expect(dialog.getByText('[dev:review] 项目实施步骤和结果。')).toBeVisible();
  const reviewFile = dialog.getByRole('link', { name: 'project-document.pdf' });
  await expect(reviewFile).toBeVisible();
  expect((await page.request.get((await reviewFile.getAttribute('href'))!)).status()).toBe(200);
  expect((await page.request.get('/api/files/' + c.attachments[0])).status()).toBe(423);
  await expect(dialog.getByText('通过内容时同步通过关联文件。')).toBeVisible();
  await page.screenshot({ path: 'outputs/人工审核-免填原因.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'outputs/统一审核-手机.png' });
  await dialog.getByRole('button', { name: '确认通过' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await (await page.request.get('/api/contents/' + c.cid)).json()).state).toBe('published');
  expect((await page.request.get('/api/files/' + c.attachments[0])).status()).toBe(200);
});

test('桌面手机批量选择，已完成项目显示失败而其他项目通过', async ({ page }) => {
  await loginAs(page, 'bulkreview.admin');
  const first = await fixture(page, '批量审核一'),
    second = await fixture(page, '批量审核二');
  await page.goto('/admin?section=moderation');
  await expect(page.getByRole('button', { name: '批量通过', exact: true })).toBeDisabled();
  await page.getByLabel('全选本页', { exact: true }).check();
  expect(await page.locator('.review-item input:checked').count()).toBe(
    await page.locator('.review-item').count(),
  );
  await page.getByLabel('全选本页', { exact: true }).uncheck();
  await card(page, first.title).getByRole('checkbox').check();
  await card(page, second.title).getByRole('checkbox').check();
  await expect(page.getByText('已选 2 项', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'outputs/批量审核-桌面.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'outputs/批量审核-手机.png', fullPage: true });
  const otherReviewer = await page.request.post('/api/admin/moderation/' + first.job + '/review', {
    headers: first.headers,
    data: { decision: 'approved' },
  });
  expect(otherReviewer.status()).toBe(200);
  await page.getByRole('button', { name: '批量通过', exact: true }).click();
  await expect(page.locator('.review-batch-errors')).toContainText('该任务已完成');
  await expect(page.locator('.review-batch-errors')).toContainText(first.title);
  await expect(card(page, second.title)).toHaveCount(0);
  for (const c of [first, second])
    expect((await (await page.request.get('/api/contents/' + c.cid)).json()).state).toBe(
      'published',
    );
});

test('批量退回只填写一次原因，单条退回仍展示原因输入', async ({ page }) => {
  await loginAs(page, 'bulkreview.admin');
  const first = await fixture(page, '批量退回一'),
    second = await fixture(page, '批量退回二');
  await page.goto('/admin?section=moderation');
  await card(page, first.title).getByRole('button', { name: '人工复核' }).click();
  await page.getByLabel('处理结论').selectOption('rejected');
  await expect(page.getByLabel('退回原因', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  for (const c of [first, second]) await card(page, c.title).getByRole('checkbox').check();
  await page.getByRole('button', { name: '批量退回', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '批量退回 2 项' })).toBeVisible();
  await dialog.getByLabel('退回原因', { exact: true }).fill('请补充完整的项目实施结果');
  await dialog.getByRole('button', { name: '确认退回' }).click();
  await expect(dialog).toHaveCount(0);
  for (const c of [first, second]) {
    const revision = (await (await page.request.get('/api/contents/' + c.cid)).json()).revision;
    expect(revision.status).toBe('rejected');
    expect(revision.reason).toBe('请补充完整的项目实施结果');
  }
});
