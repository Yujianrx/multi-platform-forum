import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { id, hash, token, passwordHash } from '../server/core';
import { miniBodyBlocks } from '../server/mini-markdown';
import { renderCaptcha } from '../server/captcha';

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let dataDir: string;
const appId = 'wx0000000000000001';
const bridgeSecret = token();
const origin = 'https://community.example';
const categoryId = id();
const departmentId = id();
const binding = '/api/mini/binding';

beforeAll(async () => {
  db = await openDatabase();
  await migrate(db);
  dataDir = await mkdtemp(join(tmpdir(), 'community-miniprogram-'));
  app = await buildApp({ db, dataDir, origin, production: true, provider: 'none', clamPort: 3310, miniprogram: { appId, bridgeSecret } }, false,
    async () => ({ answer: 'WXYZ', image: await renderCaptcha('WXYZ') }));
  await db.query('INSERT INTO categories(id,name) VALUES($1,$1)', [categoryId]);
  await db.query('INSERT INTO departments(id,name) VALUES($1,$1)', [departmentId]);
});

afterAll(async () => {
  await app?.close();
  await db?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

async function webAccount(department: string | null = null, exempt = false) {
  const userId = id(), raw = token(), csrf = token();
  await db.query('INSERT INTO users(id,username,name,password_hash,department_id,moderation_exempt) VALUES($1,$1,$1,$2,$3,$4)',
    [userId, await passwordHash('original-password'), department, exempt]);
  await db.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [hash(raw), userId, csrf]);
  return { userId, headers: { origin, cookie: 'session=' + raw, 'x-csrf-token': csrf } };
}

function cloud(openId: string, action: 'begin' | 'exchange', credential = bridgeSecret, client = appId) {
  return app.inject({ method: 'POST', url: '/api/mini/bridge', headers: { authorization: 'MiniBridge ' + credential },
    payload: { appId: client, openId, action } });
}

async function pair(openId: string, account: Awaited<ReturnType<typeof webAccount>>) {
  const pending = await cloud(openId, 'begin');
  expect(pending.json().state).toBe('pending');
  expect((await app.inject({ method: 'POST', url: binding, headers: account.headers, payload: { code: pending.json().code } })).statusCode).toBe(200);
  const exchanged = await cloud(openId, 'exchange');
  expect(exchanged.json().state).toBe('signed-in');
  return { authorization: `Bearer ${exchanged.json().session}` };
}

test('requires the trusted bridge, consumes the code once, and isolates mini sessions from web credentials', async () => {
  const user = await webAccount();
  const other = await webAccount();
  expect((await cloud('member-a', 'begin', token())).statusCode).toBe(401);
  expect((await cloud('member-a', 'begin', bridgeSecret, 'wx0000000000000002')).statusCode).toBe(403);
  const { code } = (await cloud('member-a', 'begin')).json();
  expect((await cloud('member-a', 'exchange')).json()).toEqual({ state: 'unbound' });
  const withoutCsrf = { ...user.headers, 'x-csrf-token': '' };
  expect((await app.inject({ method: 'POST', url: binding, headers: withoutCsrf, payload: { code } })).statusCode).toBe(403);
  const contenders = await Promise.all([user, other].map(({ headers }) => app.inject({ method: 'POST', url: binding, headers, payload: { code } })));
  expect(contenders.map((response) => response.statusCode).sort()).toEqual([200, 400]);
  const winner = contenders[0].statusCode === 200 ? user : other;
  const { session } = (await cloud('member-a', 'exchange')).json();
  const mini = { authorization: `Bearer ${session}` };
  expect((await app.inject({ url: '/api/auth/me', headers: mini })).json().user.id).toBe(winner.userId);
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie: 'session=' + session } })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/admin/honors/members', headers: mini })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/auth/password', headers: mini, payload: {} })).statusCode).toBe(403);
  expect((await app.inject({ method: 'DELETE', url: binding, headers: winner.headers })).statusCode).toBe(200);
  expect((await app.inject({ url: '/api/auth/me', headers: mini })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/auth/me', headers: winner.headers })).statusCode).toBe(200);
});

test('rechecks private file permissions and uses the same content, author, exemption and interactions as the web', async () => {
  const author = await webAccount(departmentId, true);
  const peer = await webAccount(departmentId, true);
  const outsider = await webAccount();
  const authorMini = await pair('mini-author', author);
  const peerMini = await pair('mini-peer', peer);
  const outsiderMini = await pair('mini-outsider', outsider);
  const created = await app.inject({ method: 'POST', url: '/api/contents', headers: authorMini, payload: { type: 'experience', categoryId } });
  expect(created.statusCode).toBe(201);
  const cid = created.json().id;
  const boundary = token();
  const bytes = 'Private attachment verification';
  const upload = await app.inject({ method: 'POST', url: `/api/contents/${cid}/files`, headers: { ...authorMini, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="verified.txt"\r\nContent-Type: text/plain\r\n\r\n${bytes}\r\n--${boundary}--\r\n` });
  expect(upload.statusCode, upload.body).toBe(201);
  expect(upload.json().scan_status).toBe('clean');
  const file = upload.json().id;
  const save = await app.inject({ method: 'PUT', url: `/api/contents/${cid}`, headers: authorMini, payload: {
    submit: true, baseRevisionId: null, data: { categoryId, title: '同一数据来源验收', summary: '指定部门可见的内容', body: '## 正文\n\n**内容**', visibility: 'departments', departments: [departmentId], attachments: [file] },
  } });
  expect(save.statusCode, save.body).toBe(200);
  const detail = await app.inject({ url: `/api/contents/${cid}`, headers: peerMini });
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().author.id).toBe(author.userId);
  expect(detail.json().bodyBlocks[0].html).toContain('<strong>内容</strong>');
  expect((await app.inject({ url: `/api/files/${file}`, headers: peerMini })).body).toBe(bytes);
  expect((await app.inject({ url: `/api/files/${file}`, headers: outsiderMini })).statusCode).toBe(404);
  expect((await app.inject({ url: `/api/files/${file}` })).statusCode).toBe(401);
  const like = await app.inject({ method: 'PUT', url: `/api/contents/${cid}/like`, headers: peerMini, payload: { active: true } });
  expect(like.json().metrics).toEqual({ likes: 1, liked: true });
  const reply = await app.inject({ method: 'POST', url: `/api/contents/${cid}/comments`, headers: peerMini, payload: { body: '同一条评论' } });
  expect(reply.statusCode, reply.body).toBe(201);
  expect(reply.json().status).toBe('approved');
  const parentId = reply.json().id;
  const stickerBody = '![收到](/stickers/received.svg)';
  const stickerReply = await app.inject({ method: 'POST', url: `/api/contents/${cid}/comments`, headers: authorMini,
    payload: { body: stickerBody, parentId, attachments: [] } });
  expect(stickerReply.statusCode, stickerReply.body).toBe(201);
  const stickerReplyId = stickerReply.json().id;
  const miniComments = (await app.inject({ url: `/api/contents/${cid}/comments`, headers: peerMini })).json().items;
  const miniSticker = miniComments.find((item: any) => item.id === stickerReplyId);
  expect(miniSticker.parent_id).toBe(parentId);
  expect(miniSticker.bodyBlocks).toContainEqual({ path: '/stickers/received.svg', alt: '收到' });
  const webComments = (await app.inject({ url: `/api/contents/${cid}/comments`, headers: peer.headers })).json().items;
  expect(webComments.find((item: any) => item.id === stickerReplyId).body).toBe(stickerBody);
  const webDetail = (await app.inject({ url: `/api/contents/${cid}`, headers: author.headers })).json();
  expect(webDetail.metrics).toMatchObject({ likes: 1, comments: 2 });
  expect(webDetail.bodyBlocks).toBeUndefined();
  await db.query('UPDATE users SET department_id=NULL WHERE id=$1', [peer.userId]);
  expect((await app.inject({ url: `/api/files/${file}`, headers: peerMini })).statusCode).toBe(404);
});

test('expires pairing codes and revokes mini login when the web account changes password', async () => {
  const user = await webAccount();
  const { code } = (await cloud('mini-stale', 'begin')).json();
  await db.query("UPDATE mini_identities SET expires_at=now()-interval '1 second' WHERE code_hash=$1", [hash(code)]);
  expect((await app.inject({ method: 'POST', url: binding, headers: user.headers, payload: { code } })).statusCode).toBe(400);
  const headers = await pair('mini-stale', user);
  const changed = await app.inject({ method: 'POST', url: '/api/auth/password', headers: user.headers,
    payload: { currentPassword: 'original-password', password: 'updated-password' } });
  expect(changed.statusCode, changed.body).toBe(200);
  expect((await app.inject({ url: '/api/auth/me', headers })).statusCode).toBe(401);
  expect((await cloud('mini-stale', 'exchange')).json()).toEqual({ state: 'unbound' });
});

test('rich text only embeds local authorized file and sticker references', () => {
  const file = id();
  const blocks = miniBodyBlocks(`| A | B |\n| - | - |\n| 一 | 二 |\n\n<img src=x onerror=alert(1)>\n\n![外部](https://example.com/p.png)\n\n![照片](/api/files/${file}?download=1)`);
  expect(blocks.filter((block) => 'path' in block)).toEqual([{ path: `/api/files/${file}`, alt: '照片' }]);
  const text = JSON.stringify(blocks);
  expect(text).toContain('<table>');
  expect(text).toContain('&lt;img');
  expect(text).not.toContain('https://example.com');
});

test('mini registration shares invite limits and account login requires a fresh picture challenge', async () => {
  const admin = await webAccount(departmentId);
  const invite = token();
  await db.query("INSERT INTO invitations(id,label,code_hash,department_id,max_uses,expires_at,created_by) VALUES($1,'mini',$2,$3,1,now()+interval '1 day',$4)",
    [id(), hash(invite), departmentId, admin.userId]);
  const member = { username: 'mini.new.user', name: '小程序注册', password: 'new-password', confirmPassword: 'new-password', invite };
  const registration = await app.inject({ method: 'POST', url: '/api/mini/auth/register', payload: member });
  expect(registration.statusCode, registration.body).toBe(201);
  expect(registration.json().user.department_id).toBe(departmentId);
  expect(registration.headers['set-cookie']).toBeUndefined();
  expect((await app.inject({ method: 'POST', url: '/api/auth/register', headers: { origin }, payload: { ...member, username: 'mini.invite.reuse' } })).statusCode).toBe(400);

  const captcha = (await app.inject({ url: '/api/mini/auth/captcha' })).json();
  expect(captcha.image).toMatch(/^data:image\/png;base64,/);
  const input = { username: member.username, password: member.password, captchaId: captcha.id, captchaCode: 'WXYZ' };
  expect((await app.inject({ method: 'POST', url: '/api/mini/auth/login', payload: input })).statusCode).toBe(400);
  const login = await app.inject({ method: 'POST', url: '/api/mini/auth/login', headers: { 'x-captcha-token': captcha.captchaToken }, payload: input });
  expect(login.statusCode, login.body).toBe(200);
  expect(login.json().user.id).toBe(registration.json().user.id);
  expect(login.json().session).toMatch(/^wx1_/);
  expect((await app.inject({ method: 'POST', url: '/api/mini/auth/login', headers: { 'x-captcha-token': captcha.captchaToken }, payload: input })).statusCode).toBe(400);
});

test('verified phones match existing records and changing the phone revokes the phone binding', async () => {
  const admin = await webAccount();
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [admin.userId]);
  const member = await webAccount(departmentId);
  const other = await webAccount();
  const patch = (id: string, phone: string | null, headers = admin.headers) => app.inject({ method: 'PATCH', url: `/api/admin/users/${id}`, headers,
    payload: { departmentId, role: 'member', active: true, phone } });
  expect((await patch(member.userId, '13800138000', member.headers)).statusCode).toBe(403);
  expect((await patch(member.userId, '13800138000')).statusCode).toBe(200);
  expect((await patch(other.userId, '+86 13800138000')).statusCode).toBe(409);
  const viaPhone = (openId: string, auth = bridgeSecret) => app.inject({ method: 'POST', url: '/api/mini/bridge', headers: { authorization: `MiniBridge ${auth}` },
    payload: { appId, openId, action: 'phone', phone: '+8613800138000' } });
  expect((await viaPhone('phone-member', token())).statusCode).toBe(401);
  const login = (await viaPhone('phone-member')).json();
  expect(login.state).toBe('signed-in');
  const headers = { authorization: `Bearer ${login.session}` };
  const me = (await app.inject({ url: '/api/auth/me', headers })).json().user;
  expect(me.id).toBe(member.userId);
  expect(me.phone_e164).toBeUndefined();
  expect((await viaPhone('phone-other')).json()).toEqual({ state: 'phone-conflict' });
  expect((await patch(member.userId, null)).statusCode).toBe(200);
  expect((await viaPhone('phone-member')).json()).toEqual({ state: 'phone-unmatched' });
  expect((await app.inject({ url: '/api/auth/me', headers })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/auth/me', headers: member.headers })).statusCode).toBe(200);
});
