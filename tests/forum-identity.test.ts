import { afterEach, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import { openDatabase, migrate } from '../server/db';

const require = createRequire(import.meta.url);
const { communityOrigin } = require('../wechat/cloudfunctions/communityIdentity/config.js');
const { prepare, communityApi } = require('../wechat/cloudfunctions/communityIdentity/community-api.js');

afterEach(() => vi.unstubAllEnvs());

test('new installation has generic defaults and upgrade preserves custom settings and business records', async () => {
  const db = await openDatabase();
  const migration = '017_forum_identity.sql';
  try {
    await migrate(db);
    const site = async () => (await db.query("SELECT value FROM settings WHERE key='site'"))[0].value;
    expect(await site()).toMatchObject({ name: '多端论坛', description: '分享经验与资源，让每一次讨论都有收获。' });
    await db.query("INSERT INTO users(id,username,name,password_hash,moderation_exempt) VALUES('00000000-0000-4000-8000-000000000017','migration-member','原成员','unchanged',true)");
    const users = await db.query('SELECT * FROM users ORDER BY id');
    const otherSettings = await db.query("SELECT * FROM settings WHERE key<>'site' ORDER BY key");
    const custom = { ...(await site()), name: '团队自己的论坛', description: '保留简介', logo: '自定义标识', logoFileId: 'keep-original', uploadLimit: 3456 };
    await db.query("UPDATE settings SET value=$1::jsonb WHERE key='site'", [JSON.stringify(custom)]);
    await db.query('DELETE FROM schema_migrations WHERE name=$1', [migration]);
    await migrate(db);
    expect(await site()).toEqual(custom);
    expect(await db.query('SELECT * FROM users ORDER BY id')).toEqual(users);
    expect(await db.query("SELECT * FROM settings WHERE key<>'site' ORDER BY key")).toEqual(otherSettings);

    // Match both historical defaults without changing the historical SQL files.
    for (const legacy of ['\u5c0f\u9c7c\u53f7AI\u5171\u521b\u793e\u533a', 'AI 共创社区']) {
      await db.query("UPDATE settings SET value=$1::jsonb WHERE key='site'", [JSON.stringify({ ...custom, name: legacy, description: '让好想法被看见，让 AI 经验流动起来。' })]);
      await db.query('DELETE FROM schema_migrations WHERE name=$1', [migration]);
      await migrate(db);
      expect(await site()).toEqual({ ...custom, name: '多端论坛', description: '分享经验与资源，让每一次讨论都有收获。' });
    }
    await db.query("UPDATE settings SET value=$1::jsonb WHERE key='site'", [JSON.stringify(custom)]);
    await migrate(db);
    expect(await site()).toEqual(custom);
    expect(await db.query('SELECT name FROM schema_migrations WHERE name=$1', [migration])).toHaveLength(1);
  } finally {
    await db.close();
  }
});

test.each(['', 'http://forum.example.com', 'https://user:password@forum.example.com', 'https://forum.example.com/path', 'https://forum.example.com/?target=elsewhere', 'https://forum.example.com/#fragment', 'not-a-url'])('rejects unsafe or incomplete cloud origin %s', (origin) => {
  vi.stubEnv('COMMUNITY_ORIGIN', origin);
  expect(() => communityOrigin()).toThrow();
});

test('cloud requests use only the configured origin and retain endpoint and session restrictions', () => {
  vi.stubEnv('COMMUNITY_ORIGIN', 'https://forum.example.com:8443/');
  expect(communityOrigin()).toBe('https://forum.example.com:8443');
  const session = 'wx1_' + 'a'.repeat(43);
  const event = { path: '/api/contents?q=https://elsewhere.example', method: 'GET', session, origin: 'https://elsewhere.example', COMMUNITY_ORIGIN: 'https://elsewhere.example' };
  const request = prepare(event);
  expect(request.url.origin).toBe('https://forum.example.com:8443');
  expect(request.headers.Authorization).toBe(`Bearer ${session}`);
  for (const path of ['//elsewhere.example/api/contents', 'https://elsewhere.example/api/contents', '/api/admin/users', '/api/../admin/users', '/api/contents#fragment'])
    expect(prepare({ ...event, path })).toBeUndefined();
  expect(prepare({ ...event, session: '' })).toBeUndefined();
  expect(prepare({ ...event, path: '/api/mini/auth/captcha', session: '' }).headers.Authorization).toBeUndefined();
});

test('missing cloud origin fails clearly without attempting a remote request', async () => {
  vi.stubEnv('COMMUNITY_ORIGIN', '');
  const result = await communityApi({ path: '/api/contents', method: 'GET', session: 'wx1_' + 'a'.repeat(43) });
  expect(result.statusCode).toBe(503);
  expect(result.data.error).toContain('COMMUNITY_ORIGIN');
});
