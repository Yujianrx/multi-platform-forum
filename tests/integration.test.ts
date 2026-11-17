import { testRequest, testCaptchaSource } from './captcha-helper';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import sharp from 'sharp';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { id, hash, passwordHash, type AppContext, type User, notify } from '../server/core';
import {
  providerFor,
  processJobs,
  DevelopmentProvider,
  UnconfiguredProvider,
} from '../server/moderation';
import { contentData } from '../server/content';
import { inspectZip } from '../server/storage';
let db: Database, app: Awaited<ReturnType<typeof buildApp>>, ctx: AppContext;
const origin = 'http://127.0.0.1:3000',
  password = 'Integration-2026!',
  deps = [id(), id()],
  cat = id(),
  cat2 = id();
const users = {
  admin: { id: id(), username: 'admin', role: 'admin', dep: deps[0] },
  a: { id: id(), username: 'member.a', role: 'member', dep: deps[0] },
  b: { id: id(), username: 'member.b', role: 'member', dep: deps[1] },
  mod: { id: id(), username: 'moderator', role: 'moderator', dep: deps[0] },
};
type Session = { cookie: string; csrf: string; user: any };
let sessions: Record<string, Session> = {};
async function request(
  method: string,
  url: string,
  body?: any,
  who: Session | undefined = sessions.a,
  extra: any = {},
) {
  return testRequest(app, {
    method: method as any,
    url,
    headers: {
      origin,
      ...(who ? { cookie: who.cookie, 'x-csrf-token': who.csrf } : {}),
      ...extra.headers,
    },
    ...(body === undefined ? {} : { payload: body }),
    ...extra,
  });
}
async function login(username: string, pw = password) {
  const r = await request('POST', '/api/auth/login', { username, password: pw }, undefined);
  expect(r.statusCode, r.body).toBe(200);
  return {
    cookie:
      r.cookies.find((c) => c.name === 'session')!.name +
      '=' +
      r.cookies.find((c) => c.name === 'session')!.value,
    csrf: r.json().csrf,
    user: r.json().user,
  };
}
function data(overrides: any = {}) {
  return contentData.parse({
    title: '测试分享 ' + id().slice(0, 6),
    summary: '足够完整的测试摘要内容',
    body: '## 已核实的说明\n\n这是用于验证行为的真实持久化记录。',
    categoryId: cat,
    visibility: 'company',
    departments: [],
    ...overrides,
  });
}
async function create(type = 'experience', overrides: any = {}, who = sessions.a, submit = true) {
  const c = await request('POST', '/api/contents', { type, categoryId: cat }, who);
  expect(c.statusCode, c.body).toBe(201);
  const cid = c.json().id;
  const d = data(overrides);
  const r = await request(
    'PUT',
    '/api/contents/' + cid,
    { data: d, submit, baseRevisionId: null },
    who,
  );
  expect(r.statusCode, r.body).toBe(200);
  return { cid, rid: r.json().revisionId, data: d };
}
async function publish(type = 'experience', overrides: any = {}, who = sessions.a) {
  const c = await create(type, overrides, who);
  await processJobs(ctx, new DevelopmentProvider(), 100);
  return c;
}
async function upload(cid: string, name: string, bytes: Buffer, who = sessions.a) {
  const boundary = 'TestBoundary' + id();
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return request('POST', `/api/contents/${cid}/files`, body, who, {
    headers: {
      origin,
      cookie: who.cookie,
      'x-csrf-token': who.csrf,
      'content-type': 'multipart/form-data; boundary=' + boundary,
    },
  });
}
async function invitation(overrides: any = {}) {
  const r = await request(
    'POST',
    '/api/admin/invitations',
    {
      label: '验收邀请码',
      departmentId: deps[0],
      maxUses: 1,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      ...overrides,
    },
    sessions.admin,
  );
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
beforeAll(async () => {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp(path.resolve('work', 'test-'));
  db = await openDatabase();
  await migrate(db);
  ctx = {
    db,
    dataDir: directory,
    production: false,
    origin,
    provider: 'development',
    clamPort: 3310,
  };
  const encoded = await passwordHash(password);
  for (let i = 0; i < deps.length; i++)
    await db.query('INSERT INTO departments(id,name) VALUES($1,$2)', [deps[i], '部门' + i]);
  await db.query("INSERT INTO categories(id,name) VALUES($1,'研发'),($2,'设计')", [cat, cat2]);
  for (const u of Object.values(users))
    await db.query(
      'INSERT INTO users(id,username,name,role,password_hash,department_id) VALUES($1,$2,$2,$3,$4,$5)',
      [u.id, u.username, u.role, encoded, u.dep],
    );
  await db.query(
    'INSERT INTO moderator_scopes(id,user_id,department_id,category_id) VALUES($1,$2,$3,$4)',
    [id(), users.mod.id, deps[0], cat],
  );
  app = await buildApp(ctx, false, testCaptchaSource);
  await app.ready();
  for (const [k, u] of Object.entries(users)) sessions[k] = await login(u.username);
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});
describe('账号、邀请与安全边界', () => {
  it('拒绝无邀请码、错误邀请码及越权注册字段', async () => {
    const body = { name: '新人', username: 'new.user', password, confirmPassword: password };
    expect((await request('POST', '/api/auth/register', body, undefined)).statusCode).toBe(400);
    expect(
      (
        await request(
          'POST',
          '/api/auth/register',
          { ...body, invite: 'not-valid-code' },
          undefined,
        )
      ).statusCode,
    ).toBe(400);
    const inv = await invitation();
    expect(
      (
        await request(
          'POST',
          '/api/auth/register',
          { ...body, invite: inv.code, role: 'admin' },
          undefined,
        )
      ).statusCode,
    ).toBe(400);
  });
  it('邀请码最后名额并发注册仅成功一次，并记录事务使用', async () => {
    const inv = await invitation();
    const result = await Promise.all(
      ['concurrent.one', 'concurrent.two'].map((username) =>
        request(
          'POST',
          '/api/auth/register',
          { name: username, username, password, confirmPassword: password, invite: inv.code },
          undefined,
        ),
      ),
    );
    expect(result.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    expect(
      (await db.query('SELECT used_count FROM invitations WHERE id=$1', [inv.id]))[0].used_count,
    ).toBe(1);
    expect(
      (await db.query('SELECT * FROM invitation_uses WHERE invitation_id=$1', [inv.id])).length,
    ).toBe(1);
    expect(result.find((r) => r.statusCode === 201)!.json().user.role).toBe('member');
  });
  it('失效、撤销和耗尽的邀请码不能注册', async () => {
    for (const reason of ['expired', 'revoked', 'used']) {
      const inv = await invitation();
      await db.query(
        reason === 'expired'
          ? "UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=$1"
          : reason === 'revoked'
            ? 'UPDATE invitations SET revoked=true WHERE id=$1'
            : 'UPDATE invitations SET used_count=max_uses WHERE id=$1',
        [inv.id],
      );
      const r = await request(
        'POST',
        '/api/auth/register',
        {
          name: '测试',
          username: 'no.' + reason,
          password,
          confirmPassword: password,
          invite: inv.code,
        },
        undefined,
      );
      expect(r.statusCode).toBe(400);
    }
  });
  it('普通员工不能自行修改部门角色，也不能访问后台', async () => {
    expect(
      (
        await request('PATCH', '/api/auth/profile', {
          name: 'A',
          bio: '',
          role: 'admin',
          department_id: deps[1],
        })
      ).statusCode,
    ).toBe(400);
    expect((await request('GET', '/api/admin/users')).statusCode).toBe(403);
    expect(
      (
        await request('PATCH', '/api/admin/users/' + users.a.id, {
          role: 'admin',
          departmentId: deps[1],
          active: true,
        })
      ).statusCode,
    ).toBe(403);
  });
  it('缺少 CSRF、伪造 Origin 与匿名访问受阻', async () => {
    const a = await app.inject({
      method: 'POST',
      url: '/api/contents',
      headers: { cookie: sessions.a.cookie, origin },
      payload: { type: 'experience', categoryId: cat },
    });
    expect(a.statusCode).toBe(403);
    const b = await app.inject({
      method: 'POST',
      url: '/api/contents',
      headers: {
        cookie: sessions.a.cookie,
        origin: 'https://evil.test',
        'x-csrf-token': sessions.a.csrf,
      },
      payload: { type: 'experience', categoryId: cat },
    });
    expect(b.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/contents' })).statusCode).toBe(401);
  });
  it('敏感响应禁止缓存，令牌与密码只存摘要', async () => {
    const r = await request('GET', '/api/auth/me');
    expect(r.headers['cache-control']).toContain('no-store');
    const u = (await db.query('SELECT password_hash FROM users WHERE id=$1', [users.a.id]))[0];
    expect(u.password_hash).not.toContain(password);
    expect(u.password_hash).toMatch(/^scrypt\$/);
    const s = (await db.query('SELECT token_hash FROM sessions WHERE user_id=$1', [users.a.id]))[0];
    expect(s.token_hash).toHaveLength(64);
    expect(s.token_hash).not.toBe(sessions.a.cookie.split('=')[1]);
  });
  it('登录失败限流生效', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const r = await testRequest(app, {
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '127.0.0.99',
        headers: { origin },
        payload: { username: 'unknown', password: 'incorrect' },
      });
      statuses.push(r.statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
describe('权限覆盖与部门实时变更', () => {
  it('指定部门内容不泄露到搜索、详情、榜单、首页、主页或通知', async () => {
    const c = await publish('experience', {
      title: '研发机密隔离内容',
      visibility: 'departments',
      departments: [deps[0]],
    });
    await request(
      'PATCH',
      '/api/admin/contents/' + c.cid,
      { featured: true, pinned: true },
      sessions.admin,
    );
    await request(
      'POST',
      '/api/admin/banners',
      { contentId: c.cid, title: '研发内部轮播', description: '保密摘要' },
      sessions.admin,
    );
    await notify(db, users.b.id, c.cid, 'comment', '保密通知');
    for (const url of [
      '/api/contents?q=研发机密',
      '/api/contents?featured=1',
      '/api/rankings',
      '/api/home',
      '/api/notifications',
      '/api/contents?author=' + users.a.id,
    ]) {
      const r = await request('GET', url, undefined, sessions.b);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.body).not.toContain(c.cid);
      expect(r.body).not.toContain('研发机密');
      expect(r.body).not.toContain('保密通知');
    }
    for (const url of [
      `/api/contents/${c.cid}`,
      `/api/contents/${c.cid}/comments`,
      `/api/contents/${c.cid}/versions`,
    ])
      expect((await request('GET', url, undefined, sessions.b)).statusCode).toBe(404);
  });
  it('部门变更不需重新登录即可撤销旧部门权限', async () => {
    const c = await publish(
      'experience',
      { visibility: 'departments', departments: [deps[0]] },
      sessions.admin,
    );
    expect((await request('GET', '/api/contents/' + c.cid)).statusCode).toBe(200);
    await request(
      'PATCH',
      '/api/admin/users/' + users.a.id,
      { departmentId: deps[1], role: 'member', active: true },
      sessions.admin,
    );
    expect((await request('GET', '/api/contents/' + c.cid)).statusCode).toBe(404);
    await request(
      'PATCH',
      '/api/admin/users/' + users.a.id,
      { departmentId: deps[0], role: 'member', active: true },
      sessions.admin,
    );
  });
  it('版主仅管理明确授权的部门与分类，新修订不扩大其权限', async () => {
    const allowed = await publish('experience', {
      visibility: 'departments',
      departments: [deps[0]],
    });
    const denied = await publish(
      'experience',
      { visibility: 'departments', departments: [deps[1]] },
      sessions.b,
    );
    expect(
      (
        await request(
          'PATCH',
          '/api/admin/contents/' + allowed.cid,
          { featured: true, pinned: false },
          sessions.mod,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(
          'PATCH',
          '/api/admin/contents/' + denied.cid,
          { featured: true, pinned: false },
          sessions.mod,
        )
      ).statusCode,
    ).toBe(404);
    const r = await request('PUT', '/api/contents/' + allowed.cid, {
      data: { ...allowed.data, title: '超出分类授权的修订', categoryId: cat2 },
      submit: true,
      baseRevisionId: allowed.rid,
    });
    expect(r.statusCode, r.body).toBe(200);
    const rid = r.json().revisionId;
    expect(
      (await request('GET', '/api/admin/moderation', undefined, sessions.mod)).body,
    ).not.toContain(rid);
    expect(
      (
        await request(
          'GET',
          `/api/contents/${allowed.cid}?revision=${rid}`,
          undefined,
          sessions.mod,
        )
      ).statusCode,
    ).toBe(404);
  });
  it('收窄范围立即生效，历史版本同样不可绕过', async () => {
    const c = await publish();
    expect((await request('GET', '/api/contents/' + c.cid, undefined, sessions.b)).statusCode).toBe(
      200,
    );
    const r = await request('PUT', '/api/contents/' + c.cid, {
      data: { ...c.data, visibility: 'departments', departments: [deps[0]] },
      submit: true,
      baseRevisionId: c.rid,
    });
    expect(r.statusCode).toBe(200);
    expect((await request('GET', '/api/contents/' + c.cid, undefined, sessions.b)).statusCode).toBe(
      404,
    );
    expect(
      (await request('GET', `/api/contents/${c.cid}?revision=${c.rid}`, undefined, sessions.b))
        .statusCode,
    ).toBe(404);
  });
});
describe('修订、审核与互动', () => {
  it('扩大可见范围后仍保留历史修订原有的部门限制', async () => {
    const c = await publish('project', { visibility: 'departments', departments: [deps[0]] });
    await request('PUT', '/api/contents/' + c.cid, {
      data: { ...c.data, visibility: 'company', departments: [], title: '面向全公司的新版' },
      submit: true,
      baseRevisionId: c.rid,
    });
    await processJobs(ctx, new DevelopmentProvider(), 100);
    expect((await request('GET', '/api/contents/' + c.cid, undefined, sessions.b)).statusCode).toBe(
      200,
    );
    expect(
      (await request('GET', `/api/contents/${c.cid}?revision=${c.rid}`, undefined, sessions.b))
        .statusCode,
    ).toBe(404);
    const history = (
      await request('GET', `/api/contents/${c.cid}/versions`, undefined, sessions.b)
    ).json();
    expect(history.total).toBe(1);
    expect(history.items[0].data.title).toBe('面向全公司的新版');
  });
  it('经验、项目、提示词可以草稿、发布、编辑并下架', async () => {
    for (const type of ['experience', 'project', 'prompt']) {
      const c = await create(
        type,
        { fields: type === 'prompt' ? { prompt: '请根据事实总结' } : {} },
        sessions.a,
        false,
      );
      expect((await request('GET', '/api/contents/' + c.cid)).json().revision.status).toBe('draft');
      let r = await request('PUT', '/api/contents/' + c.cid, {
        data: c.data,
        submit: true,
        baseRevisionId: c.rid,
      });
      await processJobs(ctx, new DevelopmentProvider(), 100);
      expect((await request('GET', '/api/contents/' + c.cid)).json().state).toBe('published');
      expect((await request('POST', '/api/contents/' + c.cid + '/withdraw')).statusCode).toBe(200);
      expect(
        (await request('GET', '/api/contents/' + c.cid, undefined, sessions.b)).statusCode,
      ).toBe(404);
    }
  });
  it('审核通过、拒绝、疑似、异常、重试均绑定具体修订', async () => {
    const reject = await create('experience', { body: '[dev:reject]' }),
      review = await create('experience', { body: '[dev:review]' }),
      timeout = await create('experience', { body: '[dev:timeout]' });
    await processJobs(ctx, new DevelopmentProvider(), 100);
    expect((await request('GET', '/api/contents/' + reject.cid)).json().revision.status).toBe(
      'rejected',
    );
    expect((await request('GET', '/api/contents/' + review.cid)).json().revision.status).toBe(
      'review',
    );
    let job = (
      await db.query('SELECT * FROM moderation_jobs WHERE revision_id=$1', [timeout.rid])
    )[0];
    expect(job.status).toBe('pending');
    for (let i = 0; i < 2; i++) {
      await db.query('UPDATE moderation_jobs SET available_at=now() WHERE id=$1', [job.id]);
      await processJobs(ctx, new DevelopmentProvider(), 100);
    }
    expect(
      (await db.query('SELECT status FROM moderation_jobs WHERE id=$1', [job.id]))[0].status,
    ).toBe('failed');
    expect(
      (await request('POST', '/api/admin/moderation/' + job.id + '/retry', {}, sessions.admin))
        .statusCode,
    ).toBe(200);
    await processJobs(
      ctx,
      {
        name: 'recovered-test-provider',
        review: async () => ({ decision: 'approved', reason: '测试供应商恢复', categories: [] }),
      },
      100,
    );
    expect((await request('GET', '/api/contents/' + timeout.cid)).json().state).toBe('published');
  });
  it('生产禁止模拟器，未配置服务必然待人工复核', async () => {
    expect(() => providerFor('development', true)).toThrow();
    const c = await create();
    await processJobs(
      { ...ctx, production: true, provider: 'none' },
      new UnconfiguredProvider(),
      100,
    );
    expect((await request('GET', '/api/contents/' + c.cid)).json().revision.status).toBe('review');
    expect((await request('GET', '/api/contents/' + c.cid, undefined, sessions.b)).statusCode).toBe(
      404,
    );
  });
  it('旧任务晚到不能发布新修订；编辑期间保持已审核版本', async () => {
    const c = await publish('project');
    await request('PUT', '/api/contents/' + c.cid, {
      data: { ...c.data, title: '等待审核的新标题' },
      submit: true,
      baseRevisionId: c.rid,
    });
    let current = (await request('GET', '/api/contents/' + c.cid + '?edit=1')).json();
    const oldQueued = current.latest_revision_id;
    const draft = await request('PUT', '/api/contents/' + c.cid, {
      data: { ...c.data, title: '第三版草稿' },
      submit: false,
      baseRevisionId: oldQueued,
    });
    await processJobs(ctx, new DevelopmentProvider(), 100);
    const publicVersion = (
      await request('GET', '/api/contents/' + c.cid, undefined, sessions.b)
    ).json();
    expect(publicVersion.revision.data.title).toBe(c.data.title);
    expect(publicVersion.published_revision_id).toBe(c.rid);
    expect(
      (await db.query('SELECT status FROM revisions WHERE id=$1', [draft.json().revisionId]))[0]
        .status,
    ).toBe('draft');
  });
  it('乐观并发保存阻止覆盖他人或旧浏览器修订', async () => {
    const c = await create('experience', {}, sessions.a, false);
    const body = { data: c.data, submit: false, baseRevisionId: c.rid };
    const result = await Promise.all([
      request('PUT', '/api/contents/' + c.cid, body),
      request('PUT', '/api/contents/' + c.cid, body),
    ]);
    expect(result.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });
  it('点赞、收藏、评论、回复刷新保持；取消再点赞不能刷新榜单时间', async () => {
    const c = await publish('project');
    for (const active of [true, false, true, true])
      expect(
        (await request('PUT', '/api/contents/' + c.cid + '/like', { active }, sessions.b))
          .statusCode,
      ).toBe(200);
    await request('PUT', '/api/contents/' + c.cid + '/bookmark', { active: true }, sessions.b);
    const comment = await request(
      'POST',
      '/api/contents/' + c.cid + '/comments',
      { body: '这是一条值得讨论的评论' },
      sessions.b,
    );
    expect(comment.statusCode).toBe(201);
    await processJobs(ctx, new DevelopmentProvider(), 100);
    const reply = await request('POST', '/api/contents/' + c.cid + '/comments', {
      body: '感谢建议，我会补充说明',
      parentId: comment.json().id,
    });
    expect(reply.statusCode).toBe(201);
    await processJobs(ctx, new DevelopmentProvider(), 100);
    let detail = (await request('GET', '/api/contents/' + c.cid, undefined, sessions.b)).json();
    expect(detail.metrics).toMatchObject({ likes: 1, liked: true, bookmarked: true, comments: 2 });
    await db.query("UPDATE likes SET first_at=now()-interval '40 days' WHERE content_id=$1", [
      c.cid,
    ]);
    await request('PUT', '/api/contents/' + c.cid + '/like', { active: false }, sessions.b);
    await request('PUT', '/api/contents/' + c.cid + '/like', { active: true }, sessions.b);
    expect(
      (
        await db.query(
          "SELECT first_at<now()-interval '30 days' AS old FROM likes WHERE content_id=$1",
          [c.cid],
        )
      )[0].old,
    ).toBe(true);
    await request('PUT', '/api/contents/' + c.cid, {
      data: {
        ...c.data,
        title: '更新版本，保持讨论关系',
        fields: { version: '2.0.0', changelog: '第二版' },
      },
      submit: true,
      baseRevisionId: c.rid,
    });
    await processJobs(ctx, new DevelopmentProvider(), 100);
    detail = (await request('GET', '/api/contents/' + c.cid, undefined, sessions.b)).json();
    expect(detail.metrics).toMatchObject({ likes: 1, bookmarked: true, comments: 2 });
    expect((await request('GET', '/api/contents/' + c.cid + '/versions')).json().total).toBe(2);
  });
  it('规则命中返回可解释人工复核，不用关键词直接拒绝', async () => {
    await request(
      'POST',
      '/api/admin/rules',
      {
        name: '示例内部约束',
        phrase: '内部禁止外传',
        reason: '涉及未发布项目计划，需要负责人确认后再共享。',
      },
      sessions.admin,
    );
    const c = await create('experience', { body: '本文包含“内部禁止外传”标识，需检查。' });
    await processJobs(ctx, new DevelopmentProvider(), 100);
    const r = (await request('GET', '/api/contents/' + c.cid)).json().revision;
    expect(r.status).toBe('review');
    expect(r.reason).toContain('负责人确认');
  });
});
describe('文件、下载与运营', () => {
  it('真实 ZIP 技能包完成上传、发布、授权下载与每日去重', async () => {
    const c = await create('skill', {}, sessions.a, false);
    const bytes = Buffer.from(
      zipSync({ 'SKILL.md': strToU8('# Skill\n仅分析输入，不执行代码。') }),
    );
    const f = await upload(c.cid, 'skill.zip', bytes);
    expect(f.statusCode, f.body).toBe(201);
    const fid = f.json().id;
    const r = await request('PUT', '/api/contents/' + c.cid, {
      data: { ...c.data, attachments: [fid] },
      submit: true,
      baseRevisionId: c.rid,
    });
    await processJobs(ctx, new DevelopmentProvider(), 100);
    const rid = r.json().revisionId;
    for (let i = 0; i < 2; i++) {
      const dl = await request(
        'GET',
        `/api/files/${fid}?revision=${rid}&download=1`,
        undefined,
        sessions.b,
      );
      expect(dl.statusCode, dl.body).toBe(200);
      expect(Buffer.from(dl.rawPayload)).toEqual(bytes);
    }
    await request('GET', `/api/files/${fid}?revision=${rid}&download=1`);
    const events = await db.query('SELECT * FROM download_events WHERE content_id=$1', [c.cid]);
    expect(events.length).toBe(3);
    expect(events.filter((e) => e.counted)).toHaveLength(1);
    await request('PUT', '/api/contents/' + c.cid, {
      data: { ...c.data, attachments: [fid], visibility: 'departments', departments: [deps[0]] },
      submit: true,
      baseRevisionId: rid,
    });
    const denied = await request('GET', `/api/files/${fid}?revision=${rid}`, undefined, sessions.b);
    expect(denied.statusCode).toBe(404);
    expect(
      (await db.query('SELECT * FROM download_events WHERE content_id=$1', [c.cid])).length,
    ).toBe(3);
  });
  it('类型伪装被拒绝、图片重编码、未配置扫描时隔离', async () => {
    const c = await create('experience', {}, sessions.a, false);
    const bad = await upload(c.cid, 'fake.png', Buffer.from('<script>alert(1)</script>'));
    expect(bad.statusCode).toBe(400);
    const png = await sharp({
      create: { width: 80, height: 50, channels: 3, background: '#e77956' },
    })
      .png()
      .toBuffer();
    const good = await upload(c.cid, 'cover.png', png);
    expect(good.statusCode, good.body).toBe(201);
    expect(good.json().mime).toBe('image/webp');
    ctx.provider = 'none';
    const pending = await upload(c.cid, 'manual.md', Buffer.from('说明文档'));
    ctx.provider = 'development';
    expect(pending.json().scan_status).toBe('review');
    expect((await request('GET', '/api/files/' + pending.json().id)).statusCode).toBe(423);
    expect(
      (await request('GET', '/api/admin/files/' + pending.json().id + '/quarantine')).statusCode,
    ).toBe(403);
    expect(
      (
        await request(
          'GET',
          '/api/admin/files/' + pending.json().id + '/quarantine',
          undefined,
          sessions.admin,
        )
      ).statusCode,
    ).toBe(200);
  });
  it('ZIP 路径穿越和压缩炸弹不可视为安全', async () => {
    const traversal = Buffer.from(zipSync({ '../escape.md': strToU8('bad path') }));
    await expect(inspectZip(traversal)).rejects.toThrow();
    const bomb = Buffer.from(zipSync({ 'large.txt': strToU8('A'.repeat(1000000)) }, { level: 9 }));
    await expect(inspectZip(bomb)).rejects.toThrow();
    const c = await create('skill', {}, sessions.a, false);
    const r = await upload(c.cid, 'danger.zip', traversal);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('ZIP 结构无效');
    expect((await upload(c.cid, 'bomb.zip', bomb)).statusCode).toBe(400);
  });
  it('隔离附件阻止自动发布，人工通过同时放行绑定附件', async () => {
    const c = await create('skill', {}, sessions.a, false);
    ctx.provider = 'none';
    const f = await upload(c.cid, 'instructions.md', Buffer.from('# 操作说明'));
    ctx.provider = 'development';
    const saved = await request('PUT', '/api/contents/' + c.cid, {
      data: { ...c.data, attachments: [f.json().id] },
      submit: true,
      baseRevisionId: c.rid,
    });
    await processJobs(ctx, new DevelopmentProvider(), 100);
    const job = (
      await db.query('SELECT id FROM moderation_jobs WHERE revision_id=$1', [
        saved.json().revisionId,
      ])
    )[0];
    expect((await request('GET', '/api/contents/' + c.cid)).json().revision.status).toBe('review');
    const records = (
      await request(
        'GET',
        '/api/admin/moderation/' + job.id + '/records',
        undefined,
        sessions.admin,
      )
    ).json().items;
    expect(records.every((r: any) => r.decision !== 'approved')).toBe(true);
    const reviewed = await request(
      'POST',
      '/api/admin/moderation/' + job.id + '/review',
      { decision: 'approved' },
      sessions.admin,
    );
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(reviewed.json().approvedFiles).toBe(1);
    expect(
      (
        await db.query('SELECT scan_status,scan_reason FROM attachments WHERE id=$1', [f.json().id])
      )[0],
    ).toMatchObject({ scan_status: 'clean', scan_reason: '随内容人工审核通过' });
    expect((await request('GET', '/api/files/' + f.json().id)).statusCode).toBe(200);
    expect((await request('GET', '/api/contents/' + c.cid)).json().state).toBe('published');
  });
  it('外部链接只记录跳转，不计为下载', async () => {
    const c = await publish('project', { fields: { demoUrl: 'https://example.com/demo' } });
    const r = await request(
      'GET',
      '/api/contents/' + c.cid + '/external/demoUrl',
      undefined,
      sessions.b,
    );
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('https://example.com/demo');
    expect(
      (await db.query('SELECT * FROM external_events WHERE content_id=$1', [c.cid])).length,
    ).toBe(1);
    expect(
      (await db.query('SELECT * FROM download_events WHERE content_id=$1', [c.cid])).length,
    ).toBe(0);
  });
  it('站点配置改变前台，关键操作写入无密钥日志', async () => {
    const s = (await request('GET', '/api/admin/settings', undefined, sessions.admin)).json();
    await request(
      'PUT',
      '/api/admin/settings',
      { ...s, name: '测试共创空间', quotaMB: 2048 },
      sessions.admin,
    );
    expect((await app.inject('/api/public')).json().name).toBe('测试共创空间');
    const logs = (
      await request('GET', '/api/admin/audit?limit=50', undefined, sessions.admin)
    ).json();
    expect(logs.items.some((l: any) => l.action === 'settings.update')).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(password);
    expect(JSON.stringify(logs)).not.toContain(sessions.admin.csrf);
  });
});
describe('会话撤销与重启恢复', () => {
  it('图片 Logo 由管理员直接更新，无需审核理由，鉴权访问且记录审计', async () => {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#e86946' },
    })
      .png()
      .toBuffer();
    const boundary = 'Logo' + id();
    const bytes = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const headers = {
      origin,
      cookie: sessions.admin.cookie,
      'x-csrf-token': sessions.admin.csrf,
      'content-type': 'multipart/form-data; boundary=' + boundary,
    };
    expect(
      (await app.inject({ method: 'POST', url: '/api/admin/logo', headers, payload: bytes }))
        .statusCode,
    ).toBe(200);
    expect((await app.inject('/api/public')).json().hasLogo).toBe(true);
    expect((await app.inject('/api/logo')).statusCode).toBe(401);
    const response = await request('GET', '/api/logo');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/webp');
    expect((await request('DELETE', '/api/admin/logo')).statusCode).toBe(403);
    expect((await request('DELETE', '/api/admin/logo', undefined, sessions.admin)).statusCode).toBe(
      200,
    );
  });
  it('轮播标题、链接、时间与启用配置真实影响首页', async () => {
    const c = await publish();
    const created = await request(
      'POST',
      '/api/admin/banners',
      { contentId: c.cid, title: '轮播配置验收', description: '旧说明' },
      sessions.admin,
    );
    expect(created.statusCode).toBe(200);
    const bid = created.json().id;
    const updated = await request(
      'PATCH',
      '/api/admin/banners/' + bid,
      { title: '更新后的轮播', description: '新说明', enabled: true, position: 3 },
      sessions.admin,
    );
    expect(updated.statusCode, updated.body).toBe(200);
    expect(
      (await request('GET', '/api/home'))
        .json()
        .banners.some((b: any) => b.title === '更新后的轮播'),
    ).toBe(true);
    await request(
      'PATCH',
      '/api/admin/banners/' + bid,
      { startsAt: new Date(Date.now() + 86400000).toISOString() },
      sessions.admin,
    );
    expect((await request('GET', '/api/home')).json().banners.some((b: any) => b.id === bid)).toBe(
      false,
    );
  });
  it('停用账号使已有会话和登录立即失效，历史作者保留', async () => {
    await request(
      'PATCH',
      '/api/admin/users/' + users.b.id,
      { role: 'member', departmentId: deps[1], active: false },
      sessions.admin,
    );
    expect((await request('GET', '/api/auth/me', undefined, sessions.b)).statusCode).toBe(401);
    const r = await request(
      'POST',
      '/api/auth/login',
      { username: users.b.username, password },
      undefined,
    );
    expect(r.statusCode).toBe(401);
    expect(
      (await db.query('SELECT id FROM contents WHERE author_id=$1', [users.b.id])).length,
    ).toBeGreaterThan(0);
    await request(
      'PATCH',
      '/api/admin/users/' + users.b.id,
      { role: 'member', departmentId: deps[1], active: true },
      sessions.admin,
    );
    sessions.b = await login(users.b.username);
  });
  it('管理员一次性重置撤销旧密码会话，凭证只能用一次', async () => {
    const r = await request(
      'POST',
      '/api/admin/users/' + users.b.id + '/reset',
      {},
      sessions.admin,
    );
    expect(r.statusCode).toBe(200);
    expect((await request('GET', '/api/auth/me', undefined, sessions.b)).statusCode).toBe(401);
    const resetBody = { token: r.json().token, password: 'New-password-2026!' };
    const reset = await request('POST', '/api/auth/reset', resetBody, undefined);
    expect(reset.statusCode, reset.body).toBe(200);
    expect((await request('POST', '/api/auth/reset', resetBody, undefined)).statusCode).toBe(400);
    expect(
      (await db.query('SELECT must_reset FROM users WHERE id=$1', [users.b.id]))[0].must_reset,
    ).toBe(false);
  });
  it('文件数据库重启后记录、会话、附件和审核任务可恢复', async () => {
    const directory = await mkdtemp(path.resolve('work', 'restart-'));
    let persistent = await openDatabase(undefined, path.join(directory, 'pg'));
    await migrate(persistent);
    const uid = id(),
      cid = id(),
      rid = id(),
      dep = id(),
      category = id(),
      key = id();
    await mkdir(path.join(directory, 'uploads'));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(directory, 'uploads', key), 'durable attachment');
    await persistent.query("INSERT INTO departments(id,name) VALUES($1,'重启部门')", [dep]);
    await persistent.query("INSERT INTO categories(id,name) VALUES($1,'重启分类')", [category]);
    await persistent.query(
      "INSERT INTO users(id,username,name,password_hash) VALUES($1,'persist','持久化','unused')",
      [uid],
    );
    await persistent.query(
      "INSERT INTO contents(id,author_id,type,category_id) VALUES($1,$2,'experience',$3)",
      [cid, uid, category],
    );
    await persistent.query(
      "INSERT INTO revisions(id,content_id,number,data,digest,status) VALUES($1,$2,1,$3,'hash','queued')",
      [rid, cid, JSON.stringify(data({ categoryId: category }))],
    );
    await persistent.query('UPDATE contents SET latest_revision_id=$1 WHERE id=$2', [rid, cid]);
    await persistent.query(
      "INSERT INTO attachments(id,content_id,owner_id,original_name,storage_key,mime,size,kind,scan_status) VALUES($1,$2,$3,'persistent.txt',$4,'text/plain',18,'resource','clean')",
      [id(), cid, uid, key],
    );
    await persistent.query(
      "INSERT INTO moderation_jobs(id,revision_id,digest,status,locked_until) VALUES($1,$2,'hash','running',now()-interval '1 second')",
      [id(), rid],
    );
    await persistent.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES('tokenhash',$1,'csrf',now()+interval '1 day')",
      [uid],
    );
    await persistent.close();
    persistent = await openDatabase(undefined, path.join(directory, 'pg'));
    expect((await persistent.query('SELECT * FROM users')).length).toBe(1);
    expect((await persistent.query('SELECT * FROM sessions')).length).toBe(1);
    expect(
      (
        await persistent.query(
          "SELECT * FROM moderation_jobs WHERE status='running' AND locked_until<now()",
        )
      ).length,
    ).toBe(1);
    expect(await readFile(path.join(directory, 'uploads', key), 'utf8')).toBe('durable attachment');
    expect((await persistent.query('SELECT * FROM attachments')).length).toBe(1);
    await processJobs(
      { ...ctx, db: persistent, dataDir: directory },
      new DevelopmentProvider(),
      10,
    );
    expect((await persistent.query('SELECT state FROM contents WHERE id=$1', [cid]))[0].state).toBe(
      'published',
    );
    expect((await persistent.query('SELECT status FROM moderation_jobs'))[0].status).toBe('done');
    await persistent.close();
  });
  it('同一出口 IP 的不同成员不会相互挤占普通请求额度', async () => {
    let limited = false;
    for (let n = 0; n < 310; n++) {
      const result = await request('GET', '/api/auth/me', undefined, sessions.admin);
      if (result.statusCode === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
    expect((await request('GET', '/api/auth/me', undefined, sessions.a)).statusCode).toBe(200);
  });
});
