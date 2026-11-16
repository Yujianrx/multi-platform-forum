import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { id, hash, passwordHash } from '../server/core';
import { processJobs, UnconfiguredProvider } from '../server/moderation';
import { staticCacheControl } from '../server/image-cache';

let db: Database, app: Awaited<ReturnType<typeof buildApp>>, admin: any, member: any, other: any;
const origin = 'https://community.test',
  category = id(),
  department = id();
let encoded: string;
const ctx: any = {
  origin,
  production: true,
  provider: 'none',
  dataDir: 'work/exemption-cache-test',
  clamPort: 3310,
};
async function account(role: string) {
  const uid = id(),
    raw = id(),
    csrf = id();
  await db.query(
    'INSERT INTO users(id,username,name,role,password_hash,department_id) VALUES($1,$1,$2,$3,$4,$5)',
    [uid, '免审验收', role, encoded, department],
  );
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
    [hash(raw), uid, csrf],
  );
  return { id: uid, headers: { origin, cookie: 'session=' + raw, 'x-csrf-token': csrf } };
}
function request(method: string, url: string, payload?: any, who = member, extra = {}) {
  return app.inject({
    method: method as any,
    url,
    headers: { ...who.headers, ...extra },
    ...(payload === undefined ? {} : { payload }),
  });
}
async function toggle(enabled: boolean, who = admin) {
  return request(
    'PATCH',
    '/api/admin/users/' + member.id,
    { departmentId: department, role: 'member', active: true, moderationExempt: enabled },
    who,
  );
}
async function draft(type = 'experience') {
  const r = await request(
    'POST',
    type === 'discussion' ? '/api/forum/topics' : '/api/contents',
    type === 'discussion'
      ? { categoryId: category, kind: 'discussion' }
      : { type, categoryId: category },
  );
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id;
}
async function submit(cid: string, extra: any = {}, baseRevisionId = null) {
  return request('PUT', '/api/contents/' + cid, {
    data: {
      title: '账号免审测试',
      summary: '足够完整的实践说明摘要',
      body: '实践步骤与结果说明',
      categoryId: category,
      visibility: 'company',
      ...extra,
    },
    submit: true,
    baseRevisionId,
  });
}
beforeAll(async () => {
  db = await openDatabase();
  ctx.db = db;
  await migrate(db);
  encoded = await passwordHash('Test123');
  await db.query("INSERT INTO categories(id,name) VALUES($1,'免审测试')", [category]);
  await db.query("INSERT INTO departments(id,name) VALUES($1,'缓存测试部门')", [department]);
});
beforeEach(async () => {
  await app?.close();
  admin = await account('admin');
  member = await account('member');
  other = await account('member');
  app = await buildApp(ctx);
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

test('免审默认关闭，只有管理员可设置，资料注入被拒绝并记录开关操作', async () => {
  expect((await request('GET', '/api/auth/me')).json().user.moderation_exempt).toBe(false);
  expect((await toggle(true, member)).statusCode).toBe(403);
  expect(
    (
      await request('PATCH', '/api/auth/profile', {
        name: '新姓名',
        bio: '',
        moderationExempt: true,
      })
    ).statusCode,
  ).toBe(400);
  expect((await toggle(true)).statusCode).toBe(200);
  expect((await request('GET', '/api/auth/me')).json().user.moderation_exempt).toBe(true);
  // Older clients updating a role must not reset the new permission inadvertently.
  await request(
    'PATCH',
    '/api/admin/users/' + member.id,
    { departmentId: department, role: 'member', active: true },
    admin,
  );
  expect((await request('GET', '/api/auth/me')).json().user.moderation_exempt).toBe(true);
  const audit = (
    await db.query(
      "SELECT details FROM audit_logs WHERE target=$1 AND action='user.moderation-exemption'",
      [member.id],
    )
  )[0];
  expect(audit.details).toMatchObject({ previous: false, enabled: true });
});

test('普通账号仍排队；免审账号提交立即发布并跳过规则和供应商，关闭后恢复审核', async () => {
  const waiting = await submit(await draft());
  expect(waiting.json().status).toBe('queued');
  await toggle(true);
  await db.query(
    "INSERT INTO moderation_rules(id,name,phrase,reason,action) VALUES($1,'测试禁止词',$2,'测试规则','reject')",
    [id(), member.id],
  );
  const cid = await draft('project');
  const result = await submit(cid, {
    body: member.id + ' [dev:reject]',
    fields: { version: '2.0' },
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().status).toBe('approved');
  expect((await request('GET', '/api/contents/' + cid, undefined, other)).json().state).toBe(
    'published',
  );
  expect(
    (await db.query('SELECT version FROM resource_versions WHERE content_id=$1', [cid]))[0].version,
  ).toBe('2.0');
  const jobs = await db.query(
    'SELECT j.status,m.provider FROM moderation_jobs j JOIN moderation_records m ON m.job_id=j.id WHERE j.revision_id=$1',
    [result.json().revisionId],
  );
  expect(jobs).toEqual([{ status: 'done', provider: 'account-exemption' }]);
  expect(
    (await db.query('SELECT status FROM revisions WHERE id=$1', [waiting.json().revisionId]))[0]
      .status,
  ).toBe('queued');
  await toggle(false);
  const updated = await submit(cid, { body: '关闭免审后的新版本' }, result.json().revisionId);
  expect(updated.json().status).toBe('queued');
  const visible = (await request('GET', '/api/contents/' + cid, undefined, other)).json();
  expect(visible.published_revision_id).toBe(result.json().revisionId);
});

test('免审论坛话题与回复立即可见，保留回复通知和锁帖限制', async () => {
  await toggle(true);
  const cid = await draft('discussion');
  expect((await submit(cid)).json().status).toBe('approved');
  await db.query('INSERT INTO forum_subscriptions(content_id,user_id) VALUES($1,$2)', [
    cid,
    other.id,
  ]);
  const reply = await request('POST', `/api/contents/${cid}/comments`, {
    body: '直接展示的免审回复',
  });
  expect(reply.json().status).toBe('approved');
  expect(
    (await request('GET', `/api/contents/${cid}/comments`, undefined, other)).json().items[0].body,
  ).toContain('免审回复');
  expect(
    (
      await db.query(
        "SELECT id FROM notifications WHERE user_id=$1 AND content_id=$2 AND kind='comment'",
        [other.id, cid],
      )
    ).length,
  ).toBe(1);
  await db.query('UPDATE forum_topics SET locked=true WHERE content_id=$1', [cid]);
  expect(
    (await request('POST', `/api/contents/${cid}/comments`, { body: '锁帖后不能回复' })).statusCode,
  ).toBe(403);
});

test('免审同样适用于个人接口投稿且保持幂等', async () => {
  await toggle(true);
  const key = (
    await request('POST', '/api/auth/api-keys', { name: '免审工具', expiresInDays: 1 })
  ).json();
  const options = {
    method: 'POST' as const,
    url: '/api/open/v1/posts',
    headers: { authorization: 'Bearer ' + key.token, 'idempotency-key': id() },
    payload: {
      type: 'experience',
      title: '接口免审文章',
      body: '接口提交的具体实践步骤与结论',
      categoryId: category,
    },
  };
  const first = await app.inject(options);
  expect(first.statusCode, first.body).toBe(201);
  expect(first.json().status).toBe('published');
  const second = await app.inject(options);
  expect(second.statusCode).toBe(200);
  expect(second.json().replayed).toBe(true);
});

test('免审不放行未检查附件，文件通过前内容仍不可见', async () => {
  await toggle(true);
  const cid = await draft(),
    fid = id();
  await db.query(
    "INSERT INTO attachments(id,content_id,owner_id,original_name,mime,size,storage_key,kind,scan_status) VALUES($1,$2,$3,'待检查.txt','text/plain',10,$4,'resource','review')",
    [fid, cid, member.id, id()],
  );
  const saved = await submit(cid, { attachments: [fid] });
  expect(saved.json().status).toBe('review');
  expect((await request('GET', '/api/contents/' + cid, undefined, other)).statusCode).toBe(404);
  expect(
    (await db.query('SELECT scan_status FROM attachments WHERE id=$1', [fid]))[0].scan_status,
  ).toBe('review');
});

test('私有图片可以条件重用，但收紧权限、隔离和退出后不能命中 304', async () => {
  await toggle(true);
  const cid = await draft(),
    fid = id(),
    storageKey = id();
  await mkdir(ctx.dataDir + '/uploads', { recursive: true });
  await writeFile(ctx.dataDir + '/uploads/' + storageKey, Buffer.from('test-image-bytes'));
  await db.query(
    "INSERT INTO attachments(id,content_id,owner_id,original_name,mime,size,storage_key,kind,scan_status) VALUES($1,$2,$3,'图片.webp','image/webp',16,$4,'image','clean')",
    [fid, cid, member.id, storageKey],
  );
  const saved = await submit(cid, { coverId: fid });
  expect(saved.json().status).toBe('approved');
  const image = await request('GET', '/api/files/' + fid, undefined, other);
  expect(image.statusCode).toBe(200);
  expect(image.headers['cache-control']).toBe('private, no-cache, must-revalidate');
  const etag = image.headers.etag;
  const cached = await request('GET', '/api/files/' + fid, undefined, other, {
    'if-none-match': etag,
  });
  expect(cached.statusCode).toBe(304);
  expect(cached.body).toBe('');
  await db.query("UPDATE attachments SET scan_status='review' WHERE id=$1", [fid]);
  expect(
    (await request('GET', '/api/files/' + fid, undefined, other, { 'if-none-match': etag }))
      .statusCode,
  ).toBe(423);
  await db.query("UPDATE attachments SET scan_status='clean' WHERE id=$1", [fid]);
  await db.query("UPDATE contents SET visibility='departments' WHERE id=$1", [cid]);
  expect(
    (await request('GET', '/api/files/' + fid, undefined, other, { 'if-none-match': etag }))
      .statusCode,
  ).toBe(404);
  expect(
    (await app.inject({ url: '/api/files/' + fid, headers: { 'if-none-match': etag } })).statusCode,
  ).toBe(401);
});

test('只有带哈希静态资源长期缓存，页面及原始素材保持重新验证', () => {
  expect(
    staticCacheControl('E:/app/public/brand/optimized/experience-123456abcdef.webp'),
  ).toContain('immutable');
  expect(staticCacheControl('E:/app/dist/client/assets/index-Abc123.js')).toContain('immutable');
  expect(staticCacheControl('E:/app/dist/client/index.html')).toBe('no-cache');
  expect(staticCacheControl('E:/app/public/brand/banners-clean/experience.png')).toBe('no-cache');
});
