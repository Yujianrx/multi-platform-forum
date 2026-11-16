import { testRequest, testCaptchaSource } from './captcha-helper';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { id, passwordHash, type AppContext } from '../server/core';
import { contentData } from '../server/content';
import { DevelopmentProvider, processJobs } from '../server/moderation';
let db: Database, app: Awaited<ReturnType<typeof buildApp>>, ctx: AppContext;
const origin = 'http://127.0.0.1:3000',
  password = 'Forum-test-password-2026',
  cat = id(),
  otherCat = id(),
  deps = [id(), id()];
const people = {
  a: { id: id(), role: 'member', dep: deps[0] },
  b: { id: id(), role: 'member', dep: deps[1] },
  admin: { id: id(), role: 'admin', dep: deps[0] },
  mod: { id: id(), role: 'moderator', dep: deps[0] },
};
const sessions: Record<string, any> = {};
async function req(method: string, url: string, body?: any, who = 'a') {
  return testRequest(app, {
    method: method as any,
    url,
    headers: { origin, ...(sessions[who] || {}) },
    ...(body === undefined ? {} : { payload: body }),
  });
}
async function approve() {
  await processJobs(ctx, new DevelopmentProvider(), 100);
}
async function topic(options: any = {}, who = 'a', publish = true) {
  const { kind = 'question', relatedContentId = null, ...overrides } = options;
  const c = await req(
    'POST',
    '/api/forum/topics',
    { categoryId: cat, kind, relatedContentId },
    who,
  );
  expect(c.statusCode, c.body).toBe(201);
  const cid = c.json().id,
    data = contentData.parse({
      title: '论坛测试 ' + id(),
      body: '描述足够清晰的讨论背景和实际问题。',
      summary: '这是用于论坛验收的摘要',
      categoryId: cat,
      visibility: 'company',
      ...overrides,
    });
  const r = await req(
    'PUT',
    '/api/contents/' + cid,
    { data, baseRevisionId: null, submit: publish },
    who,
  );
  expect(r.statusCode, r.body).toBe(200);
  if (publish) await approve();
  return { cid, rid: r.json().revisionId, data };
}
async function reply(
  cid: string,
  body = '这是一条经过验证的回答',
  who = 'b',
  parentId?: string,
  approved = true,
) {
  const r = await req(
    'POST',
    `/api/contents/${cid}/comments`,
    { body, parentId: parentId || null },
    who,
  );
  expect(r.statusCode, r.body).toBe(201);
  if (approved) await approve();
  return r.json().id;
}
beforeAll(async () => {
  await mkdir('work', { recursive: true });
  db = await openDatabase();
  await migrate(db);
  ctx = {
    db,
    dataDir: await mkdtemp(path.resolve('work/forum-test-')),
    production: false,
    origin,
    provider: 'development',
    clamPort: 3310,
  };
  await db.query("INSERT INTO departments(id,name) VALUES($1,'甲部门'),($2,'乙部门')", deps);
  await db.query("INSERT INTO categories(id,name) VALUES($1,'论坛版块'),($2,'另一个版块')", [
    cat,
    otherCat,
  ]);
  const encoded = await passwordHash(password);
  for (const [k, u] of Object.entries(people))
    await db.query(
      'INSERT INTO users(id,username,name,password_hash,role,department_id) VALUES($1,$2,$2,$3,$4,$5)',
      [u.id, 'forum.' + k, encoded, u.role, u.dep],
    );
  await db.query('INSERT INTO moderator_scopes(id,user_id,category_id) VALUES($1,$2,$3)', [
    id(),
    people.mod.id,
    cat,
  ]);
  app = await buildApp(ctx, false, testCaptchaSource);
  await app.ready();
  for (const k of Object.keys(people)) {
    const r = await req('POST', '/api/auth/login', { username: 'forum.' + k, password }, 'none');
    expect(r.statusCode, r.body).toBe(200);
    sessions[k] = {
      cookie: 'session=' + r.cookies.find((c) => c.name === 'session')!.value,
      'x-csrf-token': r.json().csrf,
    };
  }
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});
it('话题草稿和未审回复不可公开，发布后能搜索并按版块筛选', async () => {
  const t = await topic({}, 'a', false);
  expect((await req('GET', '/api/contents/' + t.cid, undefined, 'b')).statusCode).toBe(404);
  expect(
    (await req('GET', '/api/forum/topics?scope=mine'))
      .json()
      .items.some((x: any) => x.id === t.cid),
  ).toBe(true);
  await req('PUT', '/api/contents/' + t.cid, { data: t.data, submit: true, baseRevisionId: t.rid });
  await approve();
  const list = await req(
    'GET',
    '/api/forum/topics?q=' + encodeURIComponent(t.data.title) + '&board=' + cat,
    undefined,
    'b',
  );
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().total).toBe(1);
  await reply(t.cid, '待审核回复', 'b', undefined, false);
  expect(
    (await req('GET', '/api/forum/topics?sort=unanswered'))
      .json()
      .items.some((x: any) => x.id === t.cid),
  ).toBe(true);
  await approve();
  expect(
    (await req('GET', '/api/forum/topics?sort=unanswered'))
      .json()
      .items.some((x: any) => x.id === t.cid),
  ).toBe(false);
});
it('引用回复、楼层、只看楼主和我的参与正常工作', async () => {
  const t = await topic();
  const cm = await reply(t.cid);
  await reply(t.cid, '楼主补充说明', 'a', cm);
  const r = await req('GET', `/api/contents/${t.cid}/comments?author=1`);
  expect(r.json().total).toBe(1);
  expect(r.json().items[0]).toMatchObject({ parent_body: '这是一条经过验证的回答', floor: 3 });
  expect(
    (await req('GET', '/api/forum/topics?scope=participated', undefined, 'b'))
      .json()
      .items.some((x: any) => x.id === t.cid),
  ).toBe(true);
});
it('关注通知去重，取消关注后不会继续收到新回复通知', async () => {
  const t = await topic();
  await req('PUT', `/api/forum/topics/${t.cid}/follow`, { active: true }, 'admin');
  await reply(t.cid);
  expect(
    (await req('GET', '/api/notifications', undefined, 'admin'))
      .json()
      .items.filter((n: any) => n.content_id === t.cid),
  ).toHaveLength(1);
  await req('PUT', `/api/forum/topics/${t.cid}/follow`, { active: false }, 'admin');
  await reply(t.cid, '第二条回复');
  expect(
    (await req('GET', '/api/notifications', undefined, 'admin'))
      .json()
      .items.filter((n: any) => n.content_id === t.cid),
  ).toHaveLength(1);
});
it('采纳仅允许楼主和管理者操作本帖已审回答，删除采纳回复重新打开问题', async () => {
  const t = await topic(),
    another = await topic();
  const cm = await reply(t.cid),
    other = await reply(another.cid);
  expect(
    (await req('PATCH', `/api/forum/topics/${t.cid}/status`, { acceptedCommentId: cm }, 'b'))
      .statusCode,
  ).toBe(403);
  expect(
    (await req('PATCH', `/api/forum/topics/${t.cid}/status`, { acceptedCommentId: other }))
      .statusCode,
  ).toBe(400);
  expect(
    (await req('PATCH', `/api/forum/topics/${t.cid}/status`, { acceptedCommentId: cm })).statusCode,
  ).toBe(200);
  expect((await req('GET', `/api/forum/topics/${t.cid}`)).json()).toMatchObject({
    resolved: true,
    accepted_comment_id: cm,
  });
  await req('DELETE', '/api/comments/' + cm, undefined, 'b');
  expect((await req('GET', `/api/forum/topics/${t.cid}`)).json()).toMatchObject({
    resolved: false,
    accepted_comment_id: null,
  });
});
it('只有管理者能锁帖置顶，直接调用旧评论接口也不能绕过锁帖', async () => {
  const t = await topic();
  expect(
    (await req('PATCH', `/api/forum/topics/${t.cid}/status`, { locked: true })).statusCode,
  ).toBe(403);
  expect(
    (await req('PATCH', `/api/forum/topics/${t.cid}/status`, { locked: true, pinned: true }, 'mod'))
      .statusCode,
  ).toBe(200);
  expect(
    (await req('POST', `/api/contents/${t.cid}/comments`, { body: '尝试绕过锁帖' }, 'b'))
      .statusCode,
  ).toBe(403);
  await req('PATCH', `/api/forum/topics/${t.cid}/status`, { locked: false }, 'mod');
  await reply(t.cid);
});
it('版主不能管理不在其范围内的话题，普通讨论不能标记解决', async () => {
  const t = await topic({ kind: 'discussion', categoryId: otherCat });
  expect(
    (await req('PATCH', `/api/forum/topics/${t.cid}/status`, { locked: true }, 'mod')).statusCode,
  ).toBe(403);
  expect(
    (await req('PATCH', `/api/forum/topics/${t.cid}/status`, { resolved: true })).statusCode,
  ).toBe(400);
});
it('阅读记录幂等且仅对可读已发布话题生效', async () => {
  const t = await topic();
  await req('POST', `/api/forum/topics/${t.cid}/visit`, {}, 'b');
  await req('POST', `/api/forum/topics/${t.cid}/visit`, {}, 'b');
  expect((await req('GET', `/api/forum/topics/${t.cid}`)).json().views).toBe(1);
  const list = (
    await req('GET', '/api/forum/topics?q=' + encodeURIComponent(t.data.title), undefined, 'b')
  ).json();
  expect(list.items[0].unread).toBe(false);
  const draft = await topic({}, 'a', false);
  expect((await req('POST', `/api/forum/topics/${draft.cid}/visit`, {}, 'b')).statusCode).toBe(404);
});
it('关联资源权限收紧后，连话题作者也不能通过搜索、我的帖子、通知和版本读取越权', async () => {
  const resource = (
    await req('POST', '/api/contents', { type: 'experience', categoryId: cat }, 'admin')
  ).json().id;
  const data = contentData.parse({
    title: '关联资源权限测试',
    summary: '权限测试摘要',
    body: '资源正文',
    categoryId: cat,
    visibility: 'company',
  });
  const revision = (
    await req(
      'PUT',
      '/api/contents/' + resource,
      { data, baseRevisionId: null, submit: true },
      'admin',
    )
  ).json().revisionId;
  await approve();
  const t = await topic({ relatedContentId: resource }, 'b');
  const boundary = 'ForumUpload' + id();
  const uploaded = await app.inject({
    method: 'POST',
    url: `/api/contents/${t.cid}/files`,
    headers: { origin, ...sessions.b, 'content-type': 'multipart/form-data; boundary=' + boundary },
    payload: Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="private.txt"\r\nContent-Type: text/plain\r\n\r\nPrivate discussion attachment.\r\n--${boundary}--\r\n`,
    ),
  });
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  const fileId = uploaded.json().id;
  const fileRevision = (
    await req(
      'PUT',
      '/api/contents/' + t.cid,
      { data: { ...t.data, attachments: [fileId] }, baseRevisionId: t.rid, submit: true },
      'b',
    )
  ).json().revisionId;
  await approve();
  expect(
    (await req('GET', `/api/files/${fileId}?revision=${fileRevision}`, undefined, 'b')).statusCode,
  ).toBe(200);
  await req('PUT', `/api/contents/${t.cid}/bookmark`, { active: true }, 'b');
  await reply(t.cid, '关联讨论回复', 'a');
  const narrowed = { ...data, visibility: 'departments', departments: [deps[0]] };
  await req(
    'PUT',
    '/api/contents/' + resource,
    { data: narrowed, baseRevisionId: revision, submit: true },
    'admin',
  );
  for (const url of [
    `/api/forum/topics/${t.cid}`,
    `/api/contents/${t.cid}`,
    `/api/contents/${t.cid}/versions`,
    `/api/contents/${t.cid}/comments`,
    `/api/forum/topics?related=${resource}`,
    `/api/files/${fileId}?revision=${fileRevision}`,
  ])
    expect((await req('GET', url, undefined, 'b')).statusCode, url).toBe(404);
  for (const url of [
    '/api/forum/topics?scope=mine',
    '/api/contents?mine=all',
    '/api/contents?mine=bookmarks',
    '/api/forum/topics?q=' + encodeURIComponent(t.data.title),
  ])
    expect(
      (await req('GET', url, undefined, 'b')).json().items.some((x: any) => x.id === t.cid),
    ).toBe(false);
  expect(
    (await req('GET', '/api/notifications', undefined, 'b'))
      .json()
      .items.some((x: any) => x.content_id === t.cid),
  ).toBe(false);
  expect((await req('GET', `/api/forum/topics/${t.cid}`, undefined, 'a')).statusCode).toBe(200);
  const boards = (await req('GET', '/api/forum/boards', undefined, 'b')).json();
  const count = (
    await req('GET', '/api/forum/topics?board=' + cat + '&limit=50', undefined, 'b')
  ).json().total;
  expect(boards.items.find((b: any) => b.id === cat).topics).toBe(count);
});
it('回复晚于阅读时间才通过审核时，未读状态和最近动态按审核时间更新', async () => {
  const t = await topic();
  await reply(t.cid, '等待人工审核后才出现的回复', 'b', undefined, false);
  await req('POST', `/api/forum/topics/${t.cid}/visit`, {}, 'a');
  const query = '/api/forum/topics?q=' + encodeURIComponent(t.data.title);
  expect((await req('GET', query)).json().items[0].unread).toBe(false);
  await approve();
  expect((await req('GET', query)).json().items[0].unread).toBe(true);
});
it('不允许链接到无权限资源或其他话题，关联话题仍需通过自身部门权限', async () => {
  const hidden = await topic({ visibility: 'departments', departments: [deps[0]] });
  expect((await req('GET', `/api/forum/topics/${hidden.cid}`, undefined, 'b')).statusCode).toBe(
    404,
  );
  expect(
    (
      await req(
        'POST',
        '/api/forum/topics',
        { categoryId: cat, kind: 'chat', relatedContentId: hidden.cid },
        'b',
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await req(
        'POST',
        '/api/forum/topics',
        { categoryId: cat, kind: 'chat', relatedContentId: hidden.cid },
        'a',
      )
    ).statusCode,
  ).toBe(400);
});
