import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { id, hash, passwordHash } from '../server/core';
import { manualReview } from '../server/moderation';
import { recordContentView, viewDay } from '../server/views';
import { readdir, readFile } from 'node:fs/promises';
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  admin: any,
  member: any,
  other: any,
  mod: any,
  cat: string,
  dep: string;
const origin = 'https://delete.test',
  ctx: any = {
    origin,
    production: true,
    provider: 'none',
    dataDir: 'work/deletion-test',
    clamPort: 3310,
  };
async function account(role = 'member') {
  const uid = id(),
    raw = id(),
    csrf = id();
  await db.query(
    "INSERT INTO users(id,username,name,password_hash,role,department_id) VALUES($1,$1,'删除验收',$2,$3,$4)",
    [uid, await passwordHash('123456'), role, dep],
  );
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
    [hash(raw), uid, csrf],
  );
  return { id: uid, role, headers: { origin, cookie: 'session=' + raw, 'x-csrf-token': csrf } };
}
function req(method: string, url: string, payload?: any, who = member) {
  return app.inject({
    method: method as any,
    url,
    headers: who.headers,
    ...(payload === undefined ? {} : { payload }),
  });
}
async function draft(who = member) {
  const r = await req('POST', '/api/contents', { type: 'experience', categoryId: cat }, who);
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id;
}
async function save(
  cid: string,
  base: string | null = null,
  submit = false,
  who = member,
  extra: any = {},
) {
  const r = await req(
    'PUT',
    '/api/contents/' + cid,
    {
      baseRevisionId: base,
      submit,
      data: {
        title: '案例 ' + cid,
        summary: '真实实践过程和结果',
        body: '有效原创正文 ' + cid,
        categoryId: cat,
        visibility: 'company',
        ...extra,
      },
    },
    who,
  );
  expect(r.statusCode, r.body).toBe(200);
  return r.json().revisionId;
}
async function published(who = member, extra: any = {}) {
  const cid = await draft(who),
    rid = await save(cid, null, true, who, extra);
  const job = (await db.query('SELECT id FROM moderation_jobs WHERE revision_id=$1', [rid]))[0];
  await manualReview(ctx, admin, job.id, 'approved', '', true);
  return { cid, rid };
}
beforeAll(async () => {
  db = await openDatabase();
  ctx.db = db;
  await migrate(db);
});
beforeEach(async () => {
  await app?.close();
  cat = id();
  dep = id();
  await db.query('INSERT INTO categories(id,name) VALUES($1,$1)', [cat]);
  await db.query('INSERT INTO departments(id,name) VALUES($1,$1)', [dep]);
  admin = await account('admin');
  member = await account();
  other = await account();
  mod = await account('moderator');
  app = await buildApp(ctx);
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await db.close();
});

test('浏览按北京时间零点分日，同日不重复，跨日允许新增一次且不发积分', async () => {
  const p = await published(),
    before = new Date('2026-11-17T15:59:59Z'),
    after = new Date('2026-11-17T16:00:00Z');
  expect(viewDay(before)).toBe('2026-11-17');
  expect(viewDay(after)).toBe('2026-11-18');
  for (const at of [before, before, after, after])
    await db.transaction((tx) => recordContentView(tx, other, p.cid, at));
  expect(
    (
      await db.query('SELECT count(*)::int n FROM content_view_events WHERE content_id=$1', [p.cid])
    )[0].n,
  ).toBe(2);
  expect((await req('GET', '/api/honors/me', undefined, other)).json().level.total).toBe(0);
});

test('013 升级到 014 保留旧账号、会话和规则，只迁移真实论坛最近访问', async () => {
  const upgrade = await openDatabase();
  try {
    await upgrade.query(
      'CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())',
    );
    for (const name of (await readdir('migrations'))
      .filter((n) => n.endsWith('.sql') && n < '014')
      .sort()) {
      for (const sql of (await readFile('migrations/' + name, 'utf8'))
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await upgrade.query(sql);
      await upgrade.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
    const author = id(),
      reader = id(),
      category = id(),
      cid = id(),
      rid = id();
    await upgrade.query(
      "INSERT INTO users(id,username,name,password_hash) VALUES($1,$1,'旧作者','unchanged'),($2,$2,'旧读者','unchanged')",
      [author, reader],
    );
    await upgrade.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES('old-session',$1,'unchanged',now()+interval '1 day')",
      [reader],
    );
    await upgrade.query('INSERT INTO categories(id,name) VALUES($1,$1)', [category]);
    await upgrade.query(
      "INSERT INTO contents(id,author_id,type,category_id,state) VALUES($1,$2,'discussion',$3,'published')",
      [cid, author, category],
    );
    await upgrade.query(
      "INSERT INTO revisions(id,content_id,number,data,digest,status) VALUES($1,$2,1,'{}','unchanged','approved')",
      [rid, cid],
    );
    await upgrade.query(
      'UPDATE contents SET latest_revision_id=$2,published_revision_id=$2 WHERE id=$1',
      [cid, rid],
    );
    await upgrade.query('INSERT INTO forum_topics(content_id) VALUES($1)', [cid]);
    await upgrade.query(
      "INSERT INTO forum_visits(content_id,user_id,last_seen_at) VALUES($1,$2,'2026-11-15T16:10:00Z'),($1,$3,'2026-11-15T16:10:00Z')",
      [cid, reader, author],
    );
    const users = await upgrade.query('SELECT * FROM users ORDER BY id'),
      rules = await upgrade.query('SELECT * FROM moderation_rules ORDER BY id');
    await migrate(upgrade);
    await migrate(upgrade);
    const after = await upgrade.query('SELECT * FROM users ORDER BY id');
    expect(after.map(({ deleted_at, deleted_by, phone_e164, ...u }) => u)).toEqual(users);
    expect(after.every((u) => u.deleted_at === null)).toBe(true);
    expect(after.every((u) => u.phone_e164 === null)).toBe(true);
    expect(await upgrade.query('SELECT * FROM moderation_rules ORDER BY id')).toEqual(rules);
    expect((await upgrade.query('SELECT count(*)::int n FROM sessions'))[0].n).toBe(1);
    expect(await upgrade.query('SELECT user_id,day::text AS day FROM content_view_events')).toEqual(
      [{ user_id: reader, day: '2026-11-16' }],
    );
    expect((await upgrade.query('SELECT count(*)::int n FROM points_ledger'))[0].n).toBe(0);
  } finally {
    await upgrade.close();
  }
});

test('本人可删除空草稿及有正文草稿，他人不能删除，刷新后不可再编辑', async () => {
  const cid = await draft();
  expect(
    (await req('DELETE', '/api/contents/' + cid + '/draft', { revisionId: null }, other))
      .statusCode,
  ).toBe(404);
  expect(
    (await req('DELETE', '/api/contents/' + cid + '/draft', { revisionId: null })).statusCode,
  ).toBe(200);
  expect((await req('GET', '/api/contents/' + cid + '?editing=1')).statusCode).toBe(404);
  const second = await draft(),
    rid = await save(second);
  expect(
    (await req('DELETE', '/api/contents/' + second + '/draft', { revisionId: rid })).statusCode,
  ).toBe(200);
  expect((await req('GET', '/api/contents?mine=draft')).json().items).toHaveLength(0);
});
test('删除已发布文章的新草稿保留公开版本、评论与积分，丢弃版本不可再读取', async () => {
  const { cid, rid } = await published(),
    newRid = await save(cid, rid);
  const r = await req('DELETE', '/api/contents/' + cid + '/draft', { revisionId: newRid });
  expect(r.statusCode, r.body).toBe(200);
  const c = (await req('GET', '/api/contents/' + cid)).json();
  expect(c.state).toBe('published');
  expect(c.revision.id).toBe(rid);
  expect(c.honors.level.total).toBe(20);
  expect((await req('GET', '/api/contents?mine=draft')).json().items).toHaveLength(0);
  expect((await req('GET', '/api/contents/' + cid + '?revision=' + newRid)).statusCode).toBe(404);
  expect(
    (await req('GET', '/api/contents/' + cid + '/versions')).json().items.map((r: any) => r.id),
  ).not.toContain(newRid);
});
test('过时草稿、已提交或已发布版本不能用草稿删除端点移除，已下架内容可以删除', async () => {
  const cid = await draft(),
    r1 = await save(cid),
    r2 = await save(cid, r1);
  expect(
    (await req('DELETE', '/api/contents/' + cid + '/draft', { revisionId: r1 })).statusCode,
  ).toBe(409);
  const queued = await save(cid, r2, true);
  expect(
    (await req('DELETE', '/api/contents/' + cid + '/draft', { revisionId: queued })).statusCode,
  ).toBe(409);
  const p = await published();
  expect(
    (await req('DELETE', '/api/contents/' + p.cid + '/draft', { revisionId: p.rid })).statusCode,
  ).toBe(409);
  await req('POST', '/api/contents/' + p.cid + '/withdraw');
  expect(
    (await req('DELETE', '/api/contents/' + p.cid + '/draft', { revisionId: p.rid })).statusCode,
  ).toBe(200);
});
test('删除员工撤销会话、接口密钥、重置凭证和头像，历史关联及其他成员保持一致', async () => {
  const p = await published();
  const key = (await req('POST', '/api/auth/api-keys', { name: '删除验收' })).json();
  const reset = id();
  await db.query(
    "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
    [hash(reset), member.id],
  );
  await db.query(
    "INSERT INTO user_avatars(user_id,data,status) VALUES($1,'old-avatar','approved')",
    [member.id],
  );
  await db.query('UPDATE users SET avatar_version=$2 WHERE id=$1', [member.id, id()]);
  await req(
    'POST',
    '/api/contents/' + p.cid + '/comments',
    { body: '保留另一位同事的回复' },
    other,
  );
  const snapshot = (await db.query('SELECT * FROM users WHERE id=$1', [other.id]))[0];
  const payload = { username: member.id };
  const deleted = await req('DELETE', '/api/admin/users/' + member.id, payload, admin);
  expect(deleted.statusCode, deleted.body).toBe(200);
  const u = (await db.query('SELECT * FROM users WHERE id=$1', [member.id]))[0];
  expect(u.active).toBe(false);
  expect(u.deleted_at).toBeTruthy();
  expect(u.name).toBe('已删除成员');
  expect(u.avatar_version).toBeNull();
  for (const table of ['sessions', 'password_resets', 'user_avatars'])
    expect(
      (await db.query(`SELECT count(*)::int n FROM ${table} WHERE user_id=$1`, [member.id]))[0].n,
    ).toBe(0);
  expect((await req('GET', '/api/auth/me')).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        url: '/api/open/v1/taxonomy',
        headers: { authorization: 'Bearer ' + key.token },
      })
    ).statusCode,
  ).toBe(401);
  expect((await req('GET', '/api/contents/' + p.cid, undefined, other)).statusCode).toBe(200);
  expect(
    (await db.query('SELECT count(*)::int n FROM comments WHERE content_id=$1', [p.cid]))[0].n,
  ).toBe(1);
  expect((await db.query('SELECT * FROM users WHERE id=$1', [other.id]))[0]).toEqual(snapshot);
  expect((await req('GET', '/api/auth/me', undefined, other)).statusCode).toBe(200);
  expect(
    (await req('GET', '/api/admin/users?limit=50', undefined, admin))
      .json()
      .items.map((u: any) => u.id),
  ).not.toContain(member.id);
  expect((await req('DELETE', '/api/admin/users/' + member.id, payload, admin)).statusCode).toBe(
    200,
  );
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM audit_logs WHERE action='user.delete' AND target=$1",
        [member.id],
      )
    )[0].n,
  ).toBe(1);
  expect(
    (
      await req(
        'PATCH',
        '/api/admin/users/' + member.id,
        { role: 'member', departmentId: dep, active: true },
        admin,
      )
    ).statusCode,
  ).toBe(404);
});
test('账号删除仅限管理员且不能删除本人，必须核对登录名', async () => {
  for (const who of [member, mod])
    expect(
      (await req('DELETE', '/api/admin/users/' + other.id, { username: other.id }, who)).statusCode,
    ).toBe(403);
  expect(
    (await req('DELETE', '/api/admin/users/' + admin.id, { username: admin.id }, admin)).statusCode,
  ).toBe(400);
  expect(
    (await req('DELETE', '/api/admin/users/' + other.id, { username: 'wrong' }, admin)).statusCode,
  ).toBe(409);
});

test('两名管理员同时删除对方仍保留一名有效管理员', async () => {
  await db.query("UPDATE users SET active=false WHERE role='admin' AND id<>$1", [admin.id]);
  const peer = await account('admin');
  const results = await Promise.all([
    req('DELETE', '/api/admin/users/' + peer.id, { username: peer.id }, admin),
    req('DELETE', '/api/admin/users/' + admin.id, { username: admin.id }, peer),
  ]);
  expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
  expect(results.every((r) => [200, 401, 403].includes(r.statusCode))).toBe(true);
  expect(
    (await db.query("SELECT count(*)::int n FROM users WHERE role='admin' AND active"))[0].n,
  ).toBe(1);
});
test('浏览仅计已发布且可见内容，作者不计，同日重复并发访问只计一次', async () => {
  const p = await published(),
    url = '/api/contents/' + p.cid + '/visit';
  expect((await req('POST', url)).statusCode).toBe(200);
  const result = await Promise.all([
    req('POST', url, undefined, other),
    req('POST', url, undefined, other),
  ]);
  expect(result.every((r) => r.statusCode === 200)).toBe(true);
  expect(
    (
      await db.query('SELECT count(*)::int n FROM content_view_events WHERE content_id=$1', [p.cid])
    )[0].n,
  ).toBe(1);
  const privatePost = await published(member, { visibility: 'departments', departments: [dep] });
  await db.query('UPDATE users SET department_id=NULL WHERE id=$1', [other.id]);
  expect(
    (await req('POST', '/api/contents/' + privatePost.cid + '/visit', undefined, other)).statusCode,
  ).toBe(404);
  expect(
    (await req('POST', '/api/contents/' + (await draft()) + '/visit', undefined, other)).statusCode,
  ).toBe(404);
  expect((await app.inject({ method: 'POST', url, headers: { origin } })).statusCode).toBe(401);
});
test('浏览榜使用浏览事件及实际周期，与点赞和下载榜互不替代', async () => {
  const p = await published(),
    q = await published();
  await req('POST', '/api/contents/' + p.cid + '/visit', undefined, other);
  await db.query('INSERT INTO likes(content_id,user_id) VALUES($1,$2)', [q.cid, other.id]);
  await db.query(
    "INSERT INTO content_view_events(content_id,user_id,day,created_at) VALUES($1,$2,(now()-interval '12 days')::date,now()-interval '12 days')",
    [q.cid, other.id],
  );
  const board = async (metric: string, period = 'week') =>
    (
      await req('GET', `/api/rankings?metric=${metric}&period=${period}&limit=50`, undefined, other)
    ).json().items;
  expect((await board('views')).find((r: any) => r.id === p.cid).score).toBe(1);
  expect((await board('views')).find((r: any) => r.id === q.cid).score).toBe(0);
  expect((await board('views', 'month')).find((r: any) => r.id === q.cid).score).toBe(1);
  expect((await board('likes')).find((r: any) => r.id === q.cid).score).toBe(1);
  expect((await board('downloads')).find((r: any) => r.id === p.cid).score).toBe(0);
  expect((await req('GET', '/api/honors/board', undefined, other)).statusCode).toBe(200);
  expect((await req('GET', '/api/rankings?metric=views', undefined, other)).statusCode).toBe(200);
});
