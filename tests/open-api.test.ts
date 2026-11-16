import { beforeAll, beforeEach, afterEach, afterAll, test, expect } from 'vitest';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { hash, id, passwordHash, type AppContext, type User } from '../server/core';
import {
  processJobs,
  UnconfiguredProvider,
  DevelopmentProvider,
  manualReview,
  matchModerationRules,
} from '../server/moderation';
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const origin = 'https://community.test',
  category = id();
let uid: string, browser: any, b: any, admin: any, encoded: string, ctx: AppContext;
async function account(role = 'member') {
  const userId = id(),
    raw = id(),
    csrf = id();
  await db.query('INSERT INTO users(id,username,name,role,password_hash) VALUES($1,$2,$3,$4,$5)', [
    userId,
    'api.' + userId,
    '接口测试用户',
    role,
    encoded,
  ]);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
    [hash(raw), userId, csrf],
  );
  return { id: userId, headers: { origin, cookie: 'session=' + raw, 'x-csrf-token': csrf } };
}
beforeAll(async () => {
  db = await openDatabase();
  await migrate(db);
  encoded = await passwordHash('Before123');
  await db.query("INSERT INTO categories(id,name) VALUES($1,'接口测试分类')", [category]);
  ctx = {
    db,
    origin,
    production: true,
    provider: 'none',
    dataDir: 'work/api-test',
    clamPort: 3310,
  };
});
beforeEach(async () => {
  const a = await account();
  uid = a.id;
  browser = a.headers;
  b = await account();
  admin = await account('admin');
  app = await buildApp(ctx);
  await app.ready();
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db?.close();
});
async function createKey(headers = browser, name = '工作流') {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/api-keys',
    headers,
    payload: { name, expiresInDays: 90 },
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
const bearer = (key: any) => ({ authorization: 'Bearer ' + key.token });
const body = (extra: any = {}) => ({
  type: 'experience',
  title: '接口投稿',
  body: '这是接口提交的工作实践过程与结果。',
  categoryId: category,
  ...extra,
});
const post = (key: any, payload = body(), requestId = id()) =>
  app.inject({
    method: 'POST',
    url: '/api/open/v1/posts',
    headers: { ...bearer(key), 'idempotency-key': requestId },
    payload,
  });
const status = (key: any, cid: string) =>
  app.inject({ url: '/api/open/v1/posts/' + cid, headers: bearer(key) });
test('个人登录可以创建接口密钥，列表不再返回原文', async () => {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/api-keys',
    headers: browser,
    payload: { name: '工作流', expiresInDays: 90 },
  });
  expect(r.statusCode, r.body).toBe(201);
  const key = r.json();
  expect(key.token).toMatch(/^aic_[\w-]{43}$/);
  const list = await app.inject({ url: '/api/auth/api-keys', headers: browser });
  expect(list.statusCode).toBe(200);
  expect(list.body).not.toContain(key.token);
  const stored = (await db.query('SELECT * FROM api_keys WHERE id=$1', [key.id]))[0];
  expect(stored.token_hash).toBe(hash(key.token));
  expect(JSON.stringify(stored)).not.toContain(key.token);
  expect(list.body).not.toContain(stored.token_hash);
  expect(
    JSON.stringify(await db.query('SELECT * FROM audit_logs WHERE target=$1', [key.id])),
  ).not.toContain(key.token);
});

test('无效密钥请求也受到鉴权前限流保护', async () => {
  for (let n = 0; n < 600; n++)
    expect(
      (await app.inject({ url: '/api/open/v1/taxonomy', remoteAddress: '127.80.0.1' })).statusCode,
    ).toBe(401);
  const limited = await app.inject({ url: '/api/open/v1/taxonomy', remoteAddress: '127.80.0.1' });
  expect(limited.statusCode).toBe(429);
  expect(limited.headers['retry-after']).toBeTruthy();
});
test('密钥管理保留 Origin 和 CSRF，Cookie 和密钥不能越权混用', async () => {
  const k = await createKey();
  for (const headers of [
    { ...browser, origin: 'https://evil.invalid' },
    { ...browser, 'x-csrf-token': 'wrong' },
  ])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/api-keys',
          headers,
          payload: { name: '不能创建' },
        })
      ).statusCode,
    ).toBe(403);
  expect((await app.inject({ url: '/api/open/v1/taxonomy', headers: browser })).statusCode).toBe(
    401,
  );
  for (const url of ['/api/auth/me', '/api/admin/settings', '/api/auth/api-keys'])
    expect((await app.inject({ url, headers: bearer(k) })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/open/v1/taxonomy', headers: bearer(k) })).statusCode).toBe(
    200,
  );
});
test('密钥不能被其他用户列出、撤销或读取他人的投稿状态', async () => {
  const ka = await createKey(),
    kb = await createKey(b.headers);
  expect((await app.inject({ url: '/api/auth/api-keys', headers: b.headers })).body).not.toContain(
    ka.id,
  );
  expect(
    (await app.inject({ method: 'DELETE', url: '/api/auth/api-keys/' + ka.id, headers: b.headers }))
      .statusCode,
  ).toBe(404);
  const r = await post(ka);
  expect(r.statusCode, r.body).toBe(201);
  expect((await status(kb, r.json().id)).statusCode).toBe(404);
  expect(
    (await db.query('SELECT author_id FROM contents WHERE id=$1', [r.json().id]))[0].author_id,
  ).toBe(uid);
});
test('撤销、过期、停用和待重置账号的密钥立即失效', async () => {
  const revoked = await createKey();
  await app.inject({ method: 'DELETE', url: '/api/auth/api-keys/' + revoked.id, headers: browser });
  expect((await post(revoked)).statusCode).toBe(401);
  const expired = await createKey();
  await db.query("UPDATE api_keys SET expires_at=now()-interval '1 second' WHERE id=$1", [
    expired.id,
  ]);
  expect((await post(expired)).statusCode).toBe(401);
  const active = await createKey();
  await db.query('UPDATE users SET active=false WHERE id=$1', [uid]);
  expect((await post(active)).statusCode).toBe(401);
  await db.query('UPDATE users SET active=true,must_reset=true WHERE id=$1', [uid]);
  expect((await post(active)).statusCode).toBe(401);
});
test('修改密码和管理员停用、重置永久撤销已有密钥', async () => {
  const k = await createKey();
  const changed = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: browser,
    payload: { currentPassword: 'Before123', password: 'After123' },
  });
  expect(changed.statusCode, changed.body).toBe(200);
  expect((await post(k)).statusCode).toBe(401);
  const kb = await createKey(b.headers);
  const off = await app.inject({
    method: 'PATCH',
    url: '/api/admin/users/' + b.id,
    headers: admin.headers,
    payload: { departmentId: null, role: 'member', active: false },
  });
  expect(off.statusCode, off.body).toBe(200);
  await db.query('UPDATE users SET active=true WHERE id=$1', [b.id]);
  expect((await post(kb)).statusCode).toBe(401);
  const c = await account(),
    kr = await createKey(c.headers);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/admin/users/' + c.id + '/reset',
        headers: admin.headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await db.query('SELECT revoked_at FROM api_keys WHERE id=$1', [kr.id]))[0].revoked_at,
  ).toBeTruthy();
});
test('最多五把有效密钥，撤销后可新建', async () => {
  const keys = [];
  for (let i = 0; i < 5; i++) keys.push(await createKey(browser, '工具' + i));
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/api-keys',
        headers: browser,
        payload: { name: '第六把' },
      })
    ).statusCode,
  ).toBe(409);
  await app.inject({ method: 'DELETE', url: '/api/auth/api-keys/' + keys[0].id, headers: browser });
  await createKey(browser, '替换密钥');
});
test('并发重试只创建一篇内容和一个审核任务，同键异内容拒绝', async () => {
  const k = await createKey(),
    requestId = id();
  const responses = await Promise.all([post(k, body(), requestId), post(k, body(), requestId)]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
  expect(responses[0].json().id).toBe(responses[1].json().id);
  const cid = responses[0].json().id;
  expect(await db.query('SELECT * FROM revisions WHERE content_id=$1', [cid])).toHaveLength(1);
  expect(
    await db.query(
      'SELECT j.id FROM moderation_jobs j JOIN revisions r ON r.id=j.revision_id WHERE r.content_id=$1',
      [cid],
    ),
  ).toHaveLength(1);
  expect((await post(k, body({ title: '不同内容' }), requestId)).statusCode).toBe(409);
  expect((await post(await createKey(b.headers), body(), requestId)).statusCode).toBe(201);
});
test('进入人工审核，通过前不公开，审核后可查询状态', async () => {
  const k = await createKey(),
    r = await post(k);
  expect(r.statusCode, r.body).toBe(201);
  expect(r.json().status).toBe('queued');
  await processJobs(ctx, new UnconfiguredProvider(), 100);
  expect((await status(k, r.json().id)).json().status).toBe('review');
  expect(
    (
      await db.query('SELECT state,published_revision_id FROM contents WHERE id=$1', [r.json().id])
    )[0],
  ).toMatchObject({ state: 'draft', published_revision_id: null });
  const job = (
    await db.query(
      'SELECT j.id FROM moderation_jobs j JOIN revisions r ON r.id=j.revision_id WHERE r.content_id=$1',
      [r.json().id],
    )
  )[0];
  await manualReview(
    ctx,
    (await db.query('SELECT * FROM users WHERE id=$1', [admin.id]))[0] as User,
    job.id,
    'approved',
    '已核实为真实工作实践，符合社区规则',
  );
  expect((await status(k, r.json().id)).json().status).toBe('published');
});
test('论坛和提示词使用同一队列，部门范围保留', async () => {
  const k = await createKey(),
    dep = (await db.query('SELECT id FROM departments LIMIT 1'))[0].id;
  const forum = await post(
    k,
    body({ type: 'discussion', kind: 'question', visibility: 'departments', departments: [dep] }),
  );
  expect(forum.statusCode, forum.body).toBe(201);
  expect(
    (await db.query('SELECT kind FROM forum_topics WHERE content_id=$1', [forum.json().id]))[0]
      .kind,
  ).toBe('question');
  expect(
    (
      await db.query('SELECT department_id FROM content_departments WHERE content_id=$1', [
        forum.json().id,
      ])
    )[0].department_id,
  ).toBe(dep);
  const prompt = await post(k, body({ type: 'prompt' }));
  expect(prompt.statusCode, prompt.body).toBe(201);
  expect(
    (await db.query('SELECT data FROM revisions WHERE content_id=$1', [prompt.json().id]))[0].data
      .fields.prompt,
  ).toBe(body().body);
});
test('无效分类、标签、范围和伪造发布状态拒绝，事务不留半成品', async () => {
  const k = await createKey();
  for (const extra of [
    { categoryId: id() },
    { tags: ['未建立标签'] },
    { visibility: 'departments', departments: [] },
    { authorId: b.id },
    { status: 'published' },
    { type: 'skill' },
  ])
    expect((await post(k, body(extra))).statusCode).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/open/v1/posts',
        headers: bearer(k),
        payload: body(),
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await db.query('SELECT count(*)::int n FROM contents WHERE author_id=$1', [uid]))[0].n,
  ).toBe(0);
});
test('投稿每分钟限流，超限时不创建内容', async () => {
  const k = await createKey();
  for (let i = 0; i < 20; i++) expect((await post(k, body({ title: '' }))).statusCode).toBe(400);
  expect((await post(k)).statusCode).toBe(429);
});
test('每日额度跨密钥合计，达到额度后仍可安全重试已有投稿', async () => {
  const k = await createKey(),
    rid = id(),
    first = await post(k, body(), rid);
  expect(first.statusCode).toBe(201);
  await db.transaction(async (tx) => {
    for (let n = 0; n < 99; n++) {
      const cid = id();
      await tx.query('INSERT INTO contents(id,author_id,type,category_id) VALUES($1,$2,$3,$4)', [
        cid,
        uid,
        'experience',
        category,
      ]);
      await tx.query(
        'INSERT INTO api_posts(content_id,user_id,api_key_id,idempotency_key,request_digest) VALUES($1,$2,$3,$4,$5)',
        [cid, uid, k.id, id(), hash('fixture')],
      );
    }
  });
  expect((await post(await createKey(), body())).statusCode).toBe(429);
  expect((await post(k, body(), rid)).statusCode).toBe(200);
});
test('明确辱骂自动退回，人工提前审批不能绕过', async () => {
  const k = await createKey(),
    r = await post(k, body({ body: '你 这 个 傻 逼，这句话属于明确人身辱骂。' }));
  expect(r.statusCode).toBe(201);
  const job = (
    await db.query(
      'SELECT j.id FROM moderation_jobs j JOIN revisions r ON r.id=j.revision_id WHERE r.content_id=$1',
      [r.json().id],
    )
  )[0];
  await expect(
    manualReview(
      ctx,
      (await db.query('SELECT * FROM users WHERE id=$1', [admin.id]))[0] as User,
      job.id,
      'approved',
      '尝试直接批准',
    ),
  ).rejects.toThrow('禁止发布规则');
  await processJobs(ctx, new DevelopmentProvider(), 100);
  expect((await status(k, r.json().id)).json().status).toBe('rejected');
  expect(
    (await db.query('SELECT published_revision_id FROM contents WHERE id=$1', [r.json().id]))[0]
      .published_revision_id,
  ).toBeNull();
});
test('各国政治暴力和仇恨语境提示复核，正常新闻可人工批准', async () => {
  for (const country of ['中国', '美国', '法国'])
    expect(
      (await matchModerationRules(db, `${country}发生恐怖袭击，新闻报道回顾其背景。`))?.decision,
    ).toBe('review');
  expect(await matchModerationRules(db, '讨论不同国家的经济政策和财政预算')).toBeNull();
  const k = await createKey(),
    r = await post(k, body({ body: '这是一篇反对恐怖主义的国际新闻分析，没有号召或支持暴力。' }));
  await processJobs(ctx, new DevelopmentProvider(), 100);
  expect((await status(k, r.json().id)).json().status).toBe('review');
  const job = (
    await db.query(
      'SELECT j.id FROM moderation_jobs j JOIN revisions r ON r.id=j.revision_id WHERE r.content_id=$1',
      [r.json().id],
    )
  )[0];
  await manualReview(
    ctx,
    (await db.query('SELECT * FROM users WHERE id=$1', [admin.id]))[0] as User,
    job.id,
    'approved',
    '已核实为反对恐怖主义的正常新闻分析，无煽动行为',
  );
  expect((await status(k, r.json().id)).json().status).toBe('published');
});
