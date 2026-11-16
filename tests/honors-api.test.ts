import { beforeAll, beforeEach, afterAll, test, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { id, hash } from '../server/core';
import { syncContentHonors } from '../server/honors-engine';
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  a: any,
  m: any,
  other: any,
  mod: any,
  cat: string,
  dep: string;
const origin = 'https://honors.test',
  ctx: any = {
    origin,
    production: true,
    provider: 'none',
    dataDir: 'work/honors-api',
    clamPort: 3310,
  };
async function account(role = 'member') {
  const uid = id(),
    raw = id(),
    csrf = id();
  await db.query(
    "INSERT INTO users(id,username,name,password_hash,role,department_id) VALUES($1,$1,'荣誉验收','unused',$2,$3)",
    [uid, role, dep],
  );
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
    [hash(raw), uid, csrf],
  );
  return { id: uid, headers: { origin, cookie: 'session=' + raw, 'x-csrf-token': csrf } };
}
function req(method: string, url: string, payload?: any, who = m) {
  return app.inject({
    method: method as any,
    url,
    headers: who.headers,
    ...(payload === undefined ? {} : { payload }),
  });
}
async function create(type = 'experience', who = m, data: any = {}) {
  const d = await req(
    'POST',
    type === 'discussion' ? '/api/forum/topics' : '/api/contents',
    type === 'discussion' ? { kind: 'question', categoryId: cat } : { type, categoryId: cat },
    who,
  );
  expect(d.statusCode, d.body).toBe(201);
  const cid = d.json().id;
  const content = {
    title: '真实贡献 ' + cid,
    summary: '通过实际实践得到的操作和结果',
    body: '完整的实践过程 ' + cid,
    categoryId: cat,
    visibility: 'company',
    ...data,
  };
  const r = await req(
    'PUT',
    '/api/contents/' + cid,
    { data: content, submit: true, baseRevisionId: null },
    who,
  );
  expect(r.statusCode, r.body).toBe(200);
  const job = (
    await db.query('SELECT * FROM moderation_jobs WHERE revision_id=$1', [r.json().revisionId])
  )[0];
  return { cid, rid: r.json().revisionId, job, content };
}
async function approve(p: any, qualify = false) {
  const r = await req(
    'POST',
    '/api/admin/moderation/' + p.job.id + '/review',
    { decision: 'approved', confirmContribution: qualify },
    a,
  );
  expect(r.statusCode, r.body).toBe(200);
  return r;
}
async function contribution(cid: string, commentId?: string) {
  return (
    await db.query(
      commentId
        ? 'SELECT * FROM contributions WHERE comment_id=$1'
        : 'SELECT * FROM contributions WHERE content_id=$1 AND comment_id IS NULL',
      [commentId || cid],
    )
  )[0];
}
async function assess(g: any, decision = 'confirmed', who = a, extra: any = {}) {
  return req(
    'POST',
    '/api/admin/honors/contributions/' + g.id + '/assess',
    {
      decision,
      reason: '核实内容满足有效贡献条件',
      revisionId: g.revision_id,
      verified: true,
      ...extra,
    },
    who,
  );
}
async function reply(cid: string, who = other, body = '一个经过验证的解答 ' + id()) {
  const r = await req('POST', '/api/contents/' + cid + '/comments', { body }, who);
  expect(r.statusCode, r.body).toBe(201);
  const cm = r.json().id,
    job = (await db.query('SELECT * FROM moderation_jobs WHERE comment_id=$1', [cm]))[0];
  if (r.json().status === 'queued') await approve({ job });
  return cm;
}
async function accept(cid: string, cm: string | null, who = m) {
  const r = await req(
    'PATCH',
    '/api/forum/topics/' + cid + '/status',
    { acceptedCommentId: cm },
    who,
  );
  expect(r.statusCode, r.body).toBe(200);
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
  a = await account('admin');
  m = await account();
  other = await account();
  mod = await account('moderator');
  app = await buildApp(ctx);
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await db.close();
});
test('新账号没有虚构积分，成员不能认定资格、人工授勋或读取全局流水', async () => {
  const p = await req('GET', '/api/honors/me');
  expect(p.statusCode).toBe(200);
  expect(p.json().level.total).toBe(0);
  expect(p.json().badges).toEqual([]);
  for (const url of [
    '/api/admin/honors/contributions',
    '/api/admin/honors/ledger',
    '/api/admin/honors/badges',
    '/api/admin/honors/members',
  ])
    expect((await req('GET', url)).statusCode).toBe(403);
  expect((await app.inject({ url: '/api/honors/board' })).statusCode).toBe(401);
});
test('审核同时认定原创案例发20分和首枚勋章，重放不重复奖励', async () => {
  const p = await create();
  await approve(p, true);
  const g = await contribution(p.cid);
  expect(g).toMatchObject({ valid: true, points: 20, qualification: 'confirmed' });
  expect((await req('GET', '/api/honors/me')).json().badges.map((b: any) => b.id)).toContain(
    'first-case',
  );
  expect(
    (
      await req(
        'POST',
        '/api/admin/moderation/' + p.job.id + '/review',
        { decision: 'approved', confirmContribution: true },
        a,
      )
    ).statusCode,
  ).toBe(409);
  expect((await assess(g)).statusCode).toBe(200);
  expect(
    (
      await db.query('SELECT count(*)::int n FROM points_ledger WHERE contribution_id=$1', [g.id])
    )[0].n,
  ).toBe(1);
});
test('免审发布保持立即公开，但须人工确认资格；前端验证与修订校验不可绕过', async () => {
  await db.query('UPDATE users SET moderation_exempt=true WHERE id=$1', [m.id]);
  const p = await create();
  const g = await contribution(p.cid);
  expect(g.points).toBe(0);
  expect((await assess(g, 'confirmed', m)).statusCode).toBe(403);
  expect((await assess(g, 'confirmed', a, { verified: false })).statusCode).toBe(400);
  expect((await assess(g, 'confirmed', a, { revisionId: id() })).statusCode).toBe(409);
  expect((await assess(g)).statusCode).toBe(200);
  expect((await req('GET', '/api/contents/' + p.cid)).json().honors.level.total).toBe(20);
});
test('提问者采纳才发分，排除自答和版主代采纳，取消再采纳只恢复一份', async () => {
  const p = await create('discussion');
  await approve(p);
  const self = await reply(p.cid, m);
  await accept(p.cid, self);
  expect(await contribution(p.cid, self)).toBeUndefined();
  const cm = await reply(p.cid);
  await accept(p.cid, cm, a);
  expect((await contribution(p.cid, cm)).points).toBe(0);
  await accept(p.cid, cm);
  let g = await contribution(p.cid, cm);
  expect(g.points).toBe(20);
  await accept(p.cid, cm);
  expect(
    (
      await db.query('SELECT count(*)::int n FROM points_ledger WHERE contribution_id=$1', [g.id])
    )[0].n,
  ).toBe(1);
  await accept(p.cid, null);
  expect((await contribution(p.cid, cm)).points).toBe(0);
  await accept(p.cid, cm);
  expect((await contribution(p.cid, cm)).points).toBe(20);
  expect(
    (
      await db.query('SELECT sum(delta)::int n FROM points_ledger WHERE contribution_id=$1', [g.id])
    )[0].n,
  ).toBe(20);
  const comments = (await req('GET', '/api/contents/' + p.cid + '/comments')).json();
  expect(
    comments.items.find((c: any) => c.id === cm).honors.badges.map((b: any) => b.id),
  ).toContain('first-answer');
});
test('免审回答即使被采纳也等待资格确认，删除回答撤分并撤销勋章', async () => {
  const p = await create('discussion');
  await approve(p);
  await db.query('UPDATE users SET moderation_exempt=true WHERE id=$1', [other.id]);
  const cm = await reply(p.cid);
  await accept(p.cid, cm);
  let g = await contribution(p.cid, cm);
  expect(g.qualification).toBe('pending');
  expect(g.points).toBe(0);
  expect((await assess(g)).statusCode).toBe(200);
  expect((await req('DELETE', '/api/comments/' + cm, undefined, other)).statusCode).toBe(200);
  g = await contribution(p.cid, cm);
  expect(g.points).toBe(0);
  expect(
    (
      await db.query(
        "SELECT * FROM badge_awards WHERE user_id=$1 AND badge_id='first-answer' AND revoked_at IS NOT NULL",
        [other.id],
      )
    ).length,
  ).toBe(1);
});
test('公开修订改变须重新确认，同一内容累计只奖励一次；待审草稿保留旧奖励', async () => {
  const p = await create();
  await approve(p, true);
  const g = await contribution(p.cid);
  const r = await req('PUT', '/api/contents/' + p.cid, {
    data: { ...p.content, body: '更新后的实践 ' + id() },
    submit: true,
    baseRevisionId: p.rid,
  });
  expect(r.statusCode).toBe(200);
  expect((await contribution(p.cid)).points).toBe(20);
  const job = (
    await db.query('SELECT * FROM moderation_jobs WHERE revision_id=$1', [r.json().revisionId])
  )[0];
  await approve({ job });
  expect((await contribution(p.cid)).points).toBe(0);
  expect((await assess(g)).statusCode).toBe(409);
  expect((await assess(await contribution(p.cid))).statusCode).toBe(200);
  expect(
    (
      await db.query('SELECT sum(delta)::int n FROM points_ledger WHERE contribution_id=$1', [g.id])
    )[0].n,
  ).toBe(20);
});
test('相同正文换标题或重复资源链接不重复计分', async () => {
  const body = '原创案例的完整过程 ' + id();
  const p = await create('experience', m, { body });
  await approve(p, true);
  const copy = await create('experience', other, { body });
  await approve(copy);
  expect((await assess(await contribution(copy.cid))).statusCode).toBe(409);
  const fields = { demoUrl: 'https://example.com/' + id(), usage: '操作步骤' };
  const res = await create('project', m, { fields });
  await approve(res, true);
  const dup = await create('project', other, { fields });
  await approve(dup);
  expect((await assess(await contribution(dup.cid))).statusCode).toBe(409);
});
test('资源必须有可用链接或真实文件，文件隔离后撤分', async () => {
  const empty = await create('project');
  await approve(empty);
  expect((await assess(await contribution(empty.cid))).statusCode).toBe(409);
  const p = await create('project', m, { fields: { demoUrl: 'https://example.com/' + id() } });
  await approve(p);
  const fid = id(),
    key = id(),
    bytes = Buffer.from('可用资源 ' + id());
  await db.query(
    "INSERT INTO attachments(id,content_id,owner_id,original_name,storage_key,mime,size,kind,scan_status,content_hash) VALUES($1,$2,$3,'resource.txt',$4,'text/plain',$5,'resource','clean',$6)",
    [fid, p.cid, m.id, key, bytes.length, hash(bytes)],
  );
  await db.query('INSERT INTO revision_attachments VALUES($1,$2)', [p.rid, fid]);
  expect((await assess(await contribution(p.cid))).statusCode).toBe(409);
  await mkdir(ctx.dataDir + '/uploads', { recursive: true });
  await writeFile(ctx.dataDir + '/uploads/' + key, bytes);
  expect((await assess(await contribution(p.cid))).statusCode).toBe(200);
  const blocked = await req(
    'POST',
    '/api/admin/files/' + fid + '/review',
    { decision: 'blocked', reason: '资源经核实存在安全问题需要隔离' },
    a,
  );
  expect(blocked.statusCode, blocked.body).toBe(200);
  expect((await contribution(p.cid)).points).toBe(0);
});

test('完整资源包相同不重复计分，两个独立项目共用说明文件不误判', async () => {
  const shared = '通用说明 ' + id(),
    one = '项目一 ' + id(),
    two = '项目二 ' + id();
  async function resource(parts: string[]) {
    const p = await create('project');
    await mkdir(ctx.dataDir + '/uploads', { recursive: true });
    for (const part of parts) {
      const fid = id(),
        key = id(),
        bytes = Buffer.from(part);
      await writeFile(ctx.dataDir + '/uploads/' + key, bytes);
      await db.query(
        "INSERT INTO attachments(id,content_id,owner_id,original_name,storage_key,mime,size,kind,scan_status,content_hash) VALUES($1,$2,$3,'resource.txt',$4,'text/plain',$5,'resource','clean',$6)",
        [fid, p.cid, m.id, key, bytes.length, hash(bytes)],
      );
      await db.query('INSERT INTO revision_attachments VALUES($1,$2)', [p.rid, fid]);
    }
    await approve(p);
    return contribution(p.cid);
  }
  expect((await assess(await resource([shared, one]))).statusCode).toBe(200);
  expect((await assess(await resource([shared, two]))).statusCode).toBe(200);
  expect((await assess(await resource([one, shared]))).statusCode).toBe(409);
});
test('授权范围、历史内容不补分、提示词不参与，以及来源删除后明细不泄露标题', async () => {
  const p = await create();
  await approve(p);
  expect((await assess(await contribution(p.cid), 'confirmed', mod)).statusCode).toBe(404);
  await db.query('INSERT INTO moderator_scopes(id,user_id,category_id) VALUES($1,$2,$3)', [
    id(),
    mod.id,
    cat,
  ]);
  expect((await assess(await contribution(p.cid), 'confirmed', mod)).statusCode).toBe(200);
  await req('DELETE', '/api/contents/' + p.cid);
  const records = (await req('GET', '/api/honors/ledger')).json().items;
  expect(records.every((r: any) => r.content_id === null && r.title === null)).toBe(true);
  const old = await create();
  await db.query('UPDATE contents SET honors_eligible=false WHERE id=$1', [old.cid]);
  await approve(old, true);
  expect(await contribution(old.cid)).toBeUndefined();
  const prompt = await create('prompt', m, { fields: { prompt: '提示词正文' } });
  await approve(prompt, true);
  expect(await contribution(prompt.cid)).toBeUndefined();
});
test('人工勋章权限、理由、去重、依据失效复核和撤销全链路', async () => {
  const p = await create();
  await approve(p, true);
  const g = await contribution(p.cid),
    payload = { userId: m.id, reason: '持续提供可复用的优质实践', evidence: [g.id] };
  expect((await req('POST', '/api/admin/honors/badges', payload, mod)).statusCode).toBe(403);
  expect(
    (await req('POST', '/api/admin/honors/badges', { ...payload, reason: '短' }, a)).statusCode,
  ).toBe(400);
  expect((await req('POST', '/api/admin/honors/badges', payload, a)).statusCode).toBe(200);
  expect((await req('POST', '/api/admin/honors/badges', payload, a)).statusCode).toBe(409);
  await assess(g, 'rejected');
  let badge = (
    await db.query("SELECT * FROM badge_awards WHERE user_id=$1 AND badge_id='quality'", [m.id])
  )[0];
  expect(badge.needs_review).toBe(true);
  expect(
    (
      await req(
        'POST',
        '/api/admin/honors/badges/' + badge.id + '/review',
        { action: 'retain', reason: '综合其他长期贡献继续保留荣誉' },
        a,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await req(
        'POST',
        '/api/admin/honors/badges/' + badge.id + '/review',
        { action: 'revoke', reason: '重新复核后撤销本次人工荣誉' },
        a,
      )
    ).statusCode,
  ).toBe(200);
  expect((await req('GET', '/api/honors/me')).json().badges.map((b: any) => b.id)).not.toContain(
    'quality',
  );
  expect(
    (
      await db.query(
        "SELECT count(*)::int n FROM audit_logs WHERE target=$1 AND action LIKE 'honors.manual-%'",
        [badge.id],
      )
    )[0].n,
  ).toBe(3);
});
