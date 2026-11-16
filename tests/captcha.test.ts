import { beforeAll, afterAll, test, expect } from 'vitest';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { hash, id, passwordHash, type AppContext } from '../server/core';
import { generateCaptcha } from '../server/captcha';
import { testCaptchaSource } from './captcha-helper';

let db: Database, app: Awaited<ReturnType<typeof buildApp>>, ctx: AppContext;
const origin = 'http://127.0.0.1:3000';
let counter = 0;
beforeAll(async () => {
  db = await openDatabase();
  await migrate(db);
  await db.query(
    "INSERT INTO users(id,username,name,password_hash) VALUES($1,'captcha.user','验证码验收',$2)",
    [id(), await passwordHash('123456')],
  );
  ctx = {
    db,
    dataDir: 'work/captcha-test',
    production: false,
    origin,
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
async function challenge(cookie?: string) {
  const r = await app.inject({ url: '/api/auth/captcha', headers: cookie ? { cookie } : {} });
  expect(r.statusCode).toBe(200);
  const c = r.cookies.find((c) => c.name === 'login_challenge')!;
  return { ...r.json(), cookie: `${c.name}=${c.value}`, secret: c.value, response: r };
}
function login(c: any, captchaCode = 'AB7K', password = '123456') {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    remoteAddress: '127.20.0.' + ++counter,
    headers: { origin, cookie: c.cookie || '' },
    payload: { username: 'captcha.user', password, captchaId: c.id, captchaCode },
  });
}
test('只返回 PNG 图像和随机标识，数据库无明文答案或浏览器凭证', async () => {
  const c = await challenge();
  expect(Object.keys(c.response.json()).sort()).toEqual(['expiresAt', 'id', 'image']);
  expect(Buffer.from(c.image.split(',')[1], 'base64').subarray(1, 4).toString()).toBe('PNG');
  const row = (await db.query('SELECT * FROM login_captchas WHERE id=$1', [c.id]))[0];
  expect(Object.keys(row).sort()).toEqual(['answer_digest', 'binding_hash', 'expires_at', 'id']);
  expect(row.answer_digest).toHaveLength(64);
  expect(row.binding_hash).toBe(hash(c.secret));
  expect(JSON.stringify(row)).not.toContain('AB7K');
  expect(JSON.stringify(row)).not.toContain(c.secret);
  expect(c.response.cookies[0].httpOnly).toBe(true);
  expect(c.response.headers['cache-control']).toContain('no-store');
  const a = await generateCaptcha(),
    b = await generateCaptcha();
  expect(a.answer).toMatch(/^[A-Z2-9]{4}$/);
  expect(a.image.equals(b.image)).toBe(false);
});
test('缺失验证码或跨浏览器凭证不能登录，正确码不区分大小写', async () => {
  const c = await challenge();
  expect((await login({})).statusCode).toBe(400);
  expect((await login({ ...c, cookie: 'login_challenge=another-browser' })).statusCode).toBe(400);
  expect((await login(c, 'ab7k')).statusCode).toBe(200);
  expect((await login(c)).statusCode).toBe(400);
});
test('错误码或密码尝试都会消耗验证码，不能再次使用', async () => {
  const a = await challenge();
  expect((await login(a, 'ZZZZ')).json().error).toContain('验证码不正确');
  expect((await login(a)).statusCode).toBe(400);
  const b = await challenge();
  expect((await login(b, 'AB7K', 'wrong-password')).statusCode).toBe(401);
  expect((await login(b)).statusCode).toBe(400);
});
test('过期和点击刷新后的旧码均失效，新码可以使用', async () => {
  const old = await challenge();
  await db.query("UPDATE login_captchas SET expires_at=now()-interval '1 second' WHERE id=$1", [
    old.id,
  ]);
  expect((await login(old)).json().error).toContain('失效');
  const a = await challenge(),
    b = await challenge(a.cookie);
  expect((await login(a)).statusCode).toBe(400);
  expect((await login(b)).statusCode).toBe(200);
});
test('同一个验证码并发提交只允许一次成功', async () => {
  const c = await challenge();
  const responses = await Promise.all([login(c), login(c)]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 400]);
});
test('正式环境使用安全 Cookie，验证码生成限流', async () => {
  ctx.production = true;
  const c = await challenge();
  expect(c.response.cookies[0].secure).toBe(true);
  expect(c.response.cookies[0].sameSite).toBe('Strict');
  ctx.production = false;
  for (let i = 0; i < 30; i++)
    expect(
      (await app.inject({ url: '/api/auth/captcha', remoteAddress: '127.30.0.1' })).statusCode,
    ).toBe(200);
  expect(
    (await app.inject({ url: '/api/auth/captcha', remoteAddress: '127.30.0.1' })).statusCode,
  ).toBe(429);
});
