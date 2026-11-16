import { testRequest, testCaptchaSource } from './captcha-helper';
import { beforeAll, afterAll, test, expect } from 'vitest';
import sharp from 'sharp';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { id, passwordHash, type AppContext } from '../server/core';
let db: Database, app: Awaited<ReturnType<typeof buildApp>>, ctx: AppContext;
const users = { a: id(), b: id(), admin: id() },
  sessions: Record<string, any> = {};
const origin = 'http://127.0.0.1:3000';
let png: Buffer;
function request(method: string, url: string, body?: any, who = 'a') {
  return testRequest(app, {
    method: method as any,
    url,
    headers: { origin, ...sessions[who] },
    ...(body === undefined ? {} : { payload: body }),
  });
}
function upload(bytes = png, who = 'a', filename = 'avatar.png', crop?: any) {
  const boundary = 'AvatarTest' + id();
  return app.inject({
    method: 'POST',
    url: '/api/auth/avatar',
    headers: {
      origin,
      ...sessions[who],
      'content-type': 'multipart/form-data; boundary=' + boundary,
    },
    payload: Buffer.concat([
      ...(crop === undefined
        ? []
        : [
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="crop"\r\n\r\n${JSON.stringify(crop)}\r\n`,
            ),
          ]),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}
beforeAll(async () => {
  db = await openDatabase();
  await migrate(db);
  const encoded = await passwordHash('Avatar-test-password-2026');
  for (const [name, uid] of Object.entries(users))
    await db.query(
      'INSERT INTO users(id,username,name,role,password_hash) VALUES($1,$2,$2,$3,$4)',
      [uid, 'avatar.' + name, name === 'admin' ? 'admin' : 'member', encoded],
    );
  ctx = {
    db,
    dataDir: 'work/avatar-test',
    origin,
    production: false,
    provider: 'development',
    clamPort: 3310,
  };
  app = await buildApp(ctx, false, testCaptchaSource);
  await app.ready();
  for (const name of Object.keys(users)) {
    const r = await request(
      'POST',
      '/api/auth/login',
      { username: 'avatar.' + name, password: 'Avatar-test-password-2026' },
      'none',
    );
    sessions[name] = { cookie: 'session=' + r.cookies[0].value, 'x-csrf-token': r.json().csrf };
  }
  png = await sharp({ create: { width: 420, height: 280, channels: 4, background: '#5ba8c9' } })
    .png()
    .toBuffer();
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

test('头像按真实类型处理、裁切为正方形、会话与作者返回版本并需要登录读取', async () => {
  const result = await upload();
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().status).toBe('approved');
  const me = (await request('GET', '/api/auth/me')).json().user;
  expect(me.avatar_version).toBe(result.json().version);
  const otherView = await request('GET', '/api/avatars/' + users.a, undefined, 'b');
  expect(otherView.statusCode).toBe(200);
  expect(await sharp(otherView.rawPayload).metadata()).toMatchObject({
    format: 'webp',
    width: 256,
    height: 256,
  });
  expect((await app.inject('/api/avatars/' + users.a)).statusCode).toBe(401);
  expect((await request('GET', '/api/auth/avatar')).body).not.toContain('base64');
  expect((await request('GET', '/api/auth/avatar/preview')).statusCode).toBe(404);
  expect(
    (await request('GET', '/api/auth/me', undefined, 'b')).json().user.avatar_version,
  ).toBeNull();
});

test('伪图片、超大小和像素限制不覆盖已有头像，扫描服务失败保留原图', async () => {
  const before = (await request('GET', '/api/auth/me')).json().user.avatar_version;
  expect((await upload(Buffer.from('<svg onload="alert(1)"></svg>'))).statusCode).toBe(400);
  expect((await upload(Buffer.alloc(5 * 1024 * 1024 + 100))).statusCode).toBe(413);
  const tooLarge = await sharp({
    create: { width: 4600, height: 4600, channels: 3, background: '#fff' },
  })
    .png()
    .toBuffer();
  expect((await upload(tooLarge)).statusCode).toBe(400);
  ctx.clamHost = '127.0.0.1';
  ctx.clamPort = 1;
  expect((await upload()).statusCode).toBe(423);
  ctx.clamHost = undefined;
  expect((await request('GET', '/api/auth/me')).json().user.avatar_version).toBe(before);
});

test('未配置内容审核和正式环境均立即更新头像，不产生待审任务', async () => {
  const old = (await request('GET', '/api/avatars/' + users.a)).rawPayload;
  ctx.provider = 'none';
  ctx.production = true;
  const next = await upload(
    await sharp({ create: { width: 30, height: 50, channels: 3, background: '#ee3311' } })
      .png()
      .toBuffer(),
  );
  expect(next.statusCode, next.body).toBe(200);
  expect(next.json().status).toBe('approved');
  expect((await request('GET', '/api/auth/me')).json().user.avatar_version).toBe(
    next.json().version,
  );
  expect(
    (await request('GET', '/api/avatars/' + users.a, undefined, 'b')).rawPayload.equals(old),
  ).toBe(false);
  expect((await request('GET', '/api/auth/avatar')).json().pending_version).toBeNull();
  expect(await db.query('SELECT id FROM moderation_jobs')).toEqual([]);
  expect((await request('GET', '/api/admin/avatars', undefined, 'admin')).statusCode).toBe(404);
  ctx.production = false;
});

test('连续替换头像直接切换版本，移除后旧审核接口不能恢复图片', async () => {
  const oldVersion = (await request('GET', '/api/auth/me')).json().user.avatar_version;
  const next = await upload();
  expect(next.json().version).not.toBe(oldVersion);
  expect((await request('GET', '/api/auth/me')).json().user.avatar_version).toBe(
    next.json().version,
  );
  expect((await request('DELETE', '/api/auth/avatar')).statusCode).toBe(200);
  expect((await request('GET', '/api/avatars/' + users.a)).statusCode).toBe(404);
  expect(
    (
      await request(
        'POST',
        `/api/admin/avatars/${users.a}/review`,
        { version: oldVersion, decision: 'approved', reason: '旧版本操作' },
        'admin',
      )
    ).statusCode,
  ).toBe(404);
  expect((await request('GET', '/api/auth/me')).json().user.avatar_version).toBeNull();
});

test('升级将旧待审头像应用一次，清除等待状态并保留审计', async () => {
  const version = id();
  const stored = (await sharp(png).resize(256, 256).webp().toBuffer()).toString('base64');
  await db.query(
    "INSERT INTO user_avatars(user_id,pending_data,pending_version,status,reason) VALUES($1,$2,$3,'review','旧版等待复核')",
    [users.b, stored, version],
  );
  await db.query("DELETE FROM schema_migrations WHERE name='007_profile_without_review.sql'");
  await migrate(db);
  expect((await request('GET', '/api/auth/me', undefined, 'b')).json().user.avatar_version).toBe(
    version,
  );
  expect((await request('GET', '/api/avatars/' + users.b)).statusCode).toBe(200);
  expect((await request('GET', '/api/auth/avatar', undefined, 'b')).json()).toMatchObject({
    status: 'approved',
    reason: '',
    pending_version: null,
  });
  await migrate(db);
  expect(
    (
      await db.query(
        "SELECT id FROM audit_logs WHERE action='profile.avatar-policy-change' AND target=$1",
        [users.b],
      )
    ).length,
  ).toBe(1);
});

test('停用账号不能上传头像，其他成员也不能再读取该账号头像', async () => {
  await upload();
  await db.query('UPDATE users SET active=false WHERE id=$1', [users.a]);
  expect((await request('GET', '/api/avatars/' + users.a, undefined, 'b')).statusCode).toBe(404);
  expect((await request('GET', '/api/auth/avatar')).statusCode).toBe(401);
  expect((await upload()).statusCode).toBe(401);
});

test('按用户裁剪坐标保存真实选区，越界或非法坐标不覆盖原头像', async () => {
  const colored = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="200" height="200" fill="red"/><rect x="200" width="200" height="200" fill="blue"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const r = await upload(colored, 'b', 'crop.png', { left: 200, top: 0, size: 200 });
  expect(r.statusCode, r.body).toBe(200);
  const image = await request('GET', '/api/avatars/' + users.b, undefined, 'b');
  const { data, info } = await sharp(image.rawPayload).raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(256);
  expect(info.height).toBe(256);
  expect(data[0]).toBeLessThan(10);
  expect(data[2]).toBeGreaterThan(240);
  for (const crop of [
    { left: 201, top: 0, size: 200 },
    { left: -1, top: 0, size: 20 },
    { left: 0, top: 0, size: 0 },
    { left: 0.5, top: 0, size: 20 },
    { left: 0, top: 0, size: 20, extra: 1 },
  ]) {
    expect((await upload(colored, 'b', 'invalid.png', crop)).statusCode).toBe(400);
  }
  expect((await request('GET', '/api/avatars/' + users.b, undefined, 'b')).rawPayload).toEqual(
    image.rawPayload,
  );
  const phonePhoto = await sharp(colored).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  expect((await upload(phonePhoto, 'b', 'phone.jpg', { left: 0, top: 200, size: 200 })).statusCode).toBe(200);
  const rotated = await request('GET', '/api/avatars/' + users.b, undefined, 'b');
  const pixels = await sharp(rotated.rawPayload).raw().toBuffer({ resolveWithObject: true });
  const center = (128 * 256 + 128) * pixels.info.channels;
  expect(pixels.data[center]).toBeLessThan(10);
  expect(pixels.data[center + 2]).toBeGreaterThan(240);
});
