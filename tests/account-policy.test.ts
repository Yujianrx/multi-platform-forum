import { testRequest, testCaptchaSource } from './captcha-helper';
import { beforeAll, afterAll, test, expect } from 'vitest';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { hash, id, passwordHash, type AppContext } from '../server/core';

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const origin = 'http://127.0.0.1:3000',
  invitation = 'Account-policy-invitation-' + id();
function request(url: string, payload: any, session?: any, method = 'POST') {
  return testRequest(app, { method: method as any, url, headers: { origin, ...session }, payload });
}
const sessionFor = (response: any) => ({
  cookie: 'session=' + response.cookies[0].value,
  'x-csrf-token': response.json().csrf,
});
beforeAll(async () => {
  db = await openDatabase();
  await migrate(db);
  const adminId = id();
  await db.query(
    "INSERT INTO users(id,username,name,role,password_hash) VALUES($1,'policy.admin','测试管理员','admin',$2)",
    [adminId, await passwordHash(id())],
  );
  await db.query(
    "INSERT INTO invitations(id,code_hash,label,max_uses,expires_at,created_by) VALUES($1,$2,'密码规则验收',20,now()+interval '1 day',$3)",
    [id(), hash(invitation), adminId],
  );
  const ctx: AppContext = {
    db,
    dataDir: 'work/account-policy-test',
    origin,
    production: false,
    provider: 'none',
    clamPort: 3310,
  };
  app = await buildApp(ctx, false, testCaptchaSource);
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

test('注册接受 6 位纯数字或纯字母，拒绝不足 6 位、全空白、超长与密码不一致', async () => {
  const cases = [
    { password: '12345', status: 400, error: '密码至少 6 位' },
    { password: '827364', status: 201 },
    { password: 'abcdef', status: 201 },
    { password: 'x'.repeat(20), status: 201 },
    { password: 'x'.repeat(21), status: 400, error: '密码最多 20 位' },
    { password: ' '.repeat(8), status: 400, error: '密码不能全为空格' },
    { password: 'abcdef', confirm: 'abcdzzzz', status: 400, error: '两次密码不一致' },
  ];
  for (const [index, entry] of cases.entries()) {
    const response = await request('/api/auth/register', {
      name: '规则验收',
      username: 'policy.' + index,
      password: entry.password,
      confirmPassword: entry.confirm ?? entry.password,
      invite: invitation,
    });
    expect(response.statusCode, response.body).toBe(entry.status);
    if (entry.error) expect(response.json().error).toContain(entry.error);
  }
  expect(
    (await db.query('SELECT used_count FROM invitations WHERE code_hash=$1', [hash(invitation)]))[0]
      .used_count,
  ).toBe(3);
});

test('修改与一次性重置使用同样的 6 位规则，旧密码和旧会话随更新失效', async () => {
  const created = await request('/api/auth/register', {
    name: '密码流程',
    username: 'policy.flow',
    password: '876543',
    confirmPassword: '876543',
    invite: invitation,
  });
  expect(created.statusCode).toBe(201);
  const originalSession = sessionFor(created),
    uid = created.json().user.id;
  const short = await request(
    '/api/auth/password',
    { currentPassword: '876543', password: 'abc12' },
    originalSession,
  );
  expect(short.statusCode).toBe(400);
  const changed = await request(
    '/api/auth/password',
    { currentPassword: '876543', password: 'abcdef' },
    originalSession,
  );
  expect(changed.statusCode, changed.body).toBe(200);
  expect((await app.inject({ url: '/api/auth/me', headers: originalSession })).statusCode).toBe(
    401,
  );
  expect(
    (await request('/api/auth/login', { username: 'policy.flow', password: '876543' })).statusCode,
  ).toBe(401);
  expect(
    (await request('/api/auth/login', { username: 'policy.flow', password: 'abcdef' })).statusCode,
  ).toBe(200);
  const resetToken = 'reset-' + id();
  await db.query(
    "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
    [hash(resetToken), uid],
  );
  expect(
    (await request('/api/auth/reset', { token: resetToken, password: '12345' })).statusCode,
  ).toBe(400);
  const reset = await request('/api/auth/reset', { token: resetToken, password: '******' });
  expect(reset.statusCode, reset.body).toBe(200);
  expect(
    (await request('/api/auth/reset', { token: resetToken, password: '876543' })).statusCode,
  ).toBe(400);
  expect(
    (await request('/api/auth/login', { username: 'policy.flow', password: '******' })).statusCode,
  ).toBe(200);
});

test('注册姓名和资料简介直接生效，不创建内容审核任务', async () => {
  const created = await request('/api/auth/register', {
    name: '同事姓名',
    username: 'policy.profile',
    password: 'profile8',
    confirmPassword: 'profile8',
    invite: invitation,
  });
  expect(created.statusCode).toBe(201);
  const session = sessionFor(created);
  const response = await request(
    '/api/auth/profile',
    { name: '修改后的姓名', bio: '我的新简介' },
    session,
    'PATCH',
  );
  expect(response.statusCode).toBe(200);
  expect((await app.inject({ url: '/api/auth/me', headers: session })).json().user).toMatchObject({
    name: '修改后的姓名',
    bio: '我的新简介',
  });
  expect(await db.query('SELECT id FROM moderation_jobs')).toEqual([]);
});
