import { testRequest, testCaptchaSource } from './captcha-helper';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { id, passwordHash, type AppContext } from '../server/core';
import { contentData } from '../server/content';
import { processJobs, DevelopmentProvider } from '../server/moderation';
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  ctx: AppContext,
  cid: string,
  second: string;
const origin = 'http://127.0.0.1:3000',
  cat = id(),
  deps = [id(), id()],
  password = 'Media-tests-password-2026',
  sessions: Record<string, any> = {};
const users = {
  a: { id: id(), role: 'member', dep: deps[0] },
  b: { id: id(), role: 'member', dep: deps[0] },
  c: { id: id(), role: 'member', dep: deps[1] },
  admin: { id: id(), role: 'admin', dep: deps[0] },
};
async function req(method: string, url: string, body?: any, who = 'b') {
  return testRequest(app, {
    method: method as any,
    url,
    headers: { origin, ...sessions[who] },
    ...(body === undefined ? {} : { payload: body }),
  });
}
async function approve() {
  await processJobs(ctx, new DevelopmentProvider(), 100);
}
async function upload(target: string, name: string, buffer: Buffer, who = 'b', comment = true) {
  const boundary = 'Media' + id();
  return app.inject({
    method: 'POST',
    url: `/api/contents/${target}/${comment ? 'comment-files' : 'files'}`,
    headers: {
      origin,
      ...sessions[who],
      'content-type': 'multipart/form-data; boundary=' + boundary,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}
async function post(target: string, body: any, who = 'b') {
  return req('POST', `/api/contents/${target}/comments`, body, who);
}
async function make(privateOnly = false) {
  const c = (
    await req('POST', '/api/contents', { type: 'experience', categoryId: cat }, 'a')
  ).json().id;
  const data = contentData.parse({
    title: '媒体测试 ' + id(),
    summary: '图片和附件验收内容',
    body: '这是用来验证图文评论的文章。',
    categoryId: cat,
    visibility: privateOnly ? 'departments' : 'company',
    departments: privateOnly ? [deps[0]] : [],
  });
  await req('PUT', '/api/contents/' + c, { data, baseRevisionId: null, submit: true }, 'a');
  await approve();
  return c;
}
beforeAll(async () => {
  await mkdir('work', { recursive: true });
  db = await openDatabase();
  await migrate(db);
  ctx = {
    db,
    dataDir: await mkdtemp(path.resolve('work/media-test-')),
    origin,
    production: false,
    provider: 'development',
    clamPort: 3310,
  };
  await db.query("INSERT INTO categories(id,name) VALUES($1,'图文测试')", [cat]);
  await db.query("INSERT INTO departments(id,name) VALUES($1,'甲'),($2,'乙')", deps);
  const encoded = await passwordHash(password);
  for (const [k, u] of Object.entries(users))
    await db.query(
      'INSERT INTO users(id,username,name,role,password_hash,department_id) VALUES($1,$2,$2,$3,$4,$5)',
      [u.id, 'media.' + k, u.role, encoded, u.dep],
    );
  app = await buildApp(ctx, false, testCaptchaSource);
  await app.ready();
  for (const k of Object.keys(users)) {
    const r = await req('POST', '/api/auth/login', { username: 'media.' + k, password }, 'none');
    expect(r.statusCode, r.body).toBe(200);
    sessions[k] = {
      cookie: 'session=' + r.cookies.find((c) => c.name === 'session')!.value,
      'x-csrf-token': r.json().csrf,
    };
  }
  cid = await make();
  second = await make();
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});
it('静态页面与表情素材不会耗用 API 限流额度', async () => {
  const results = await Promise.all(
    Array.from({ length: 305 }, () => req('GET', '/stickers/received.svg', undefined, 'none')),
  );
  // buildApp in this fixture has no static plugin, so the expected response is a normal 404.
  expect(results.every((r) => r.statusCode === 404)).toBe(true);
  expect((await req('GET', '/api/health', undefined, 'none')).statusCode).toBe(200);
});
it('普通读者可以上传自己的评论附件，不能编辑文章或泄露待审素材；纯附件评论可发布且不计资源下载', async () => {
  const u = await upload(cid, 'comment-notes.txt', Buffer.from('仅用于这条评论的笔记'));
  expect(u.statusCode, u.body).toBe(201);
  const fid = u.json().id;
  expect((await req('GET', '/api/files/' + fid)).statusCode).toBe(200);
  expect((await req('GET', '/api/files/' + fid, undefined, 'a')).statusCode).toBe(404);
  expect(
    (await req('GET', `/api/contents/${cid}/files`, undefined, 'a'))
      .json()
      .items.some((f: any) => f.id === fid),
  ).toBe(false);
  expect((await upload(cid, 'forbidden.txt', Buffer.from('x'), 'b', false)).statusCode).toBe(403);
  const p = await post(cid, { body: '', attachments: [fid] });
  expect(p.statusCode, p.body).toBe(201);
  expect((await req('GET', '/api/files/' + fid, undefined, 'a')).statusCode).toBe(404);
  await approve();
  const cm = (await req('GET', `/api/contents/${cid}/comments`, undefined, 'a'))
    .json()
    .items.find((x: any) => x.id === p.json().id);
  expect(cm.files[0].id).toBe(fid);
  expect((await req('GET', '/api/files/' + fid, undefined, 'a')).statusCode).toBe(200);
  expect(
    (await db.query('SELECT id FROM download_events WHERE attachment_id=$1', [fid])).length,
  ).toBe(0);
});
it('评论图片、表情文字与附件内容一并进入审核输入', async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffbc73' } })
    .png()
    .toBuffer();
  const image = (await upload(cid, 'comment.png', png)).json();
  const text = (await upload(cid, 'notes.md', Buffer.from('附件内的审核内容'))).json();
  const p = await post(cid, {
    body: `这是一条图文回复 ![图片](/api/files/${image.id}) ![收到](/stickers/received.svg)`,
    attachments: [text.id],
  });
  expect(p.statusCode, p.body).toBe(201);
  let input: any;
  await processJobs(
    ctx,
    {
      name: 'test-capture',
      async review(v) {
        input = v;
        return { decision: 'approved', reason: '测试审核输入覆盖', categories: [] };
      },
    },
    100,
  );
  expect(input.images).toEqual([{ id: image.id, mime: 'image/webp' }]);
  expect(input.text).toContain('附件内的审核内容');
  expect(input.text).toContain('收到');
  expect(
    (await req('GET', '/api/files/' + image.id, undefined, 'a')).headers['content-type'],
  ).toContain('image/webp');
});
it('拒绝盗用他人、其他内容、已提交和不同用途的附件，正文手写图片地址同样校验', async () => {
  const f = (await upload(cid, 'owned.txt', Buffer.from('owner'))).json();
  expect((await post(cid, { body: '盗用', attachments: [f.id] }, 'a')).statusCode).toBe(400);
  expect((await post(second, { body: '跨内容', attachments: [f.id] })).statusCode).toBe(400);
  await post(cid, { body: '首次提交', attachments: [f.id] });
  expect((await post(cid, { body: '重复引用', attachments: [f.id] })).statusCode).toBe(409);
  const ownedByAuthor = (
    await upload(cid, 'author-comment.txt', Buffer.from('comment'), 'a')
  ).json();
  const current = (await req('GET', '/api/contents/' + cid + '?edit=1', undefined, 'a')).json();
  expect(
    (
      await req(
        'PUT',
        '/api/contents/' + cid,
        {
          data: { ...current.revision.data, attachments: [ownedByAuthor.id] },
          baseRevisionId: current.latest_revision_id,
          submit: false,
        },
        'a',
      )
    ).statusCode,
  ).toBe(400);
  const article = (await upload(cid, 'article.txt', Buffer.from('article'), 'a', false)).json();
  expect((await post(cid, { body: `![伪造图片](/api/files/${article.id})` })).statusCode).toBe(400);
});
it('自动审核保持文件隔离，人工通过评论时同步放行关联附件', async () => {
  const f = (await upload(cid, 'review.txt', Buffer.from('等待独立扫描'))).json();
  await db.query("UPDATE attachments SET scan_status='review' WHERE id=$1", [f.id]);
  const p = await post(cid, { body: '附件待扫描', attachments: [f.id] });
  await approve();
  expect((await db.query('SELECT status FROM comments WHERE id=$1', [p.json().id]))[0].status).toBe(
    'review',
  );
  expect((await req('GET', '/api/files/' + f.id)).statusCode).toBe(423);
  const job = (
    await db.query('SELECT id FROM moderation_jobs WHERE comment_id=$1', [p.json().id])
  )[0];
  await req('POST', `/api/admin/moderation/${job.id}/review`, { decision: 'approved' }, 'admin');
  expect((await db.query('SELECT status FROM comments WHERE id=$1', [p.json().id]))[0].status).toBe(
    'approved',
  );
  expect(
    (await db.query('SELECT scan_status FROM attachments WHERE id=$1', [f.id]))[0].scan_status,
  ).toBe('clean');
  expect((await req('GET', '/api/files/' + f.id)).statusCode).toBe(200);
});
it('部门限制和后续收紧范围同时保护评论图片与附件', async () => {
  const privateId = await make(true);
  expect((await upload(privateId, 'private.txt', Buffer.from('x'), 'c')).statusCode).toBe(404);
  const f = (await upload(privateId, 'private.txt', Buffer.from('私有内容'))).json();
  await post(privateId, { body: '部门附件', attachments: [f.id] });
  await approve();
  expect((await req('GET', '/api/files/' + f.id, undefined, 'c')).statusCode).toBe(404);
  await db.query('UPDATE users SET department_id=$2 WHERE id=$1', [users.b.id, deps[1]]);
  expect((await req('GET', '/api/files/' + f.id)).statusCode).toBe(404);
  await db.query('UPDATE users SET department_id=$2 WHERE id=$1', [users.b.id, deps[0]]);
});
it('删除评论后所有人都无法直接读取附件，未提交素材可以移除', async () => {
  const f = (await upload(cid, 'remove.txt', Buffer.from('remove'))).json();
  const p = await post(cid, { body: '稍后删除', attachments: [f.id] });
  await approve();
  expect((await req('DELETE', '/api/files/' + f.id)).statusCode).toBe(409);
  await req('DELETE', '/api/comments/' + p.json().id);
  for (const who of ['a', 'b', 'admin'])
    expect((await req('GET', '/api/files/' + f.id, undefined, who)).statusCode).toBe(404);
  const draft = (await upload(cid, 'draft.txt', Buffer.from('unused'))).json();
  expect((await req('DELETE', '/api/files/' + draft.id)).statusCode).toBe(200);
  expect((await req('GET', '/api/files/' + draft.id)).statusCode).toBe(404);
});
it('GIF 保留动画，过多帧和伪装图片被拒绝，PDF 进入人工复核', async () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const secondFrame = Buffer.from(gif.subarray(19, -1));
  secondFrame[secondFrame.length - 2] = 0x4c;
  const animated = Buffer.concat([
    gif.subarray(0, 19),
    gif.subarray(19, -1),
    secondFrame,
    Buffer.from([0x3b]),
  ]);
  expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
  const result = await upload(cid, 'animation.gif', animated);
  expect(result.statusCode, result.body).toBe(201);
  const served = await req('GET', '/api/files/' + result.json().id);
  expect((await sharp(served.rawPayload, { animated: true }).metadata()).pages).toBe(2);
  const excess = Buffer.concat([
    gif.subarray(0, 19),
    ...Array(101).fill(gif.subarray(19, -1)),
    Buffer.from([0x3b]),
  ]);
  expect((await upload(cid, 'many.gif', excess)).statusCode).toBe(400);
  expect((await upload(cid, 'fake.png', Buffer.from('not an image'))).statusCode).toBe(400);
  const pdf = await upload(
    cid,
    'document.pdf',
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'),
  );
  expect(pdf.statusCode, pdf.body).toBe(201);
  expect(pdf.json().scan_status).toBe('review');
  for (const [extension, part, contentType] of [
    [
      'docx',
      'word/document.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    ],
    [
      'xlsx',
      'xl/workbook.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    ],
    [
      'pptx',
      'ppt/presentation.xml',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    ],
  ]) {
    const archive = zipSync({
      '[Content_Types].xml': strToU8(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${part}" ContentType="${contentType}"/></Types>`,
      ),
      [part]: strToU8('<?xml version="1.0"?><document>文档结构验收</document>'),
    });
    const document = await upload(cid, 'document.' + extension, Buffer.from(archive));
    expect(document.statusCode, document.body).toBe(201);
    expect(document.json().scan_status).toBe('review');
  }
});
it('锁定论坛话题不能上传评论素材；文件数量和空评论校验生效', async () => {
  const t = (
    await req('POST', '/api/forum/topics', { categoryId: cat, kind: 'discussion' }, 'a')
  ).json().id;
  await req(
    'PUT',
    '/api/contents/' + t,
    {
      data: contentData.parse({
        title: '锁帖图文测试',
        summary: '锁帖测试摘要内容',
        body: '锁定话题',
        categoryId: cat,
        visibility: 'company',
      }),
      baseRevisionId: null,
      submit: true,
    },
    'a',
  );
  await approve();
  await req('PATCH', '/api/forum/topics/' + t + '/status', { locked: true }, 'admin');
  expect((await upload(t, 'locked.txt', Buffer.from('no'))).statusCode).toBe(403);
  expect((await post(cid, { body: '', attachments: [] })).statusCode).toBe(400);
  expect(
    (await post(cid, { body: '超量', attachments: Array.from({ length: 11 }, () => id()) }))
      .statusCode,
  ).toBe(400);
});
