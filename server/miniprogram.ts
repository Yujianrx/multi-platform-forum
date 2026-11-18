import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, fail, hash, token, type AppContext } from './core.js';
import type { Queryable } from './db.js';
import { phoneNumber } from './phone.js';

const miniRoutes: Record<string, readonly string[]> = {
  GET: ['/auth/me', '/taxonomy', '/home', '/contents', '/contents/:id', '/contents/:id/versions',
    '/contents/:id/files', '/contents/:id/comments', '/forum/boards', '/forum/topics', '/forum/topics/:id',
    '/rankings', '/honors/board', '/honors/me', '/honors/ledger', '/notifications', '/files/:id', '/avatars/:userId'],
  POST: ['/auth/logout', '/notifications/read', '/contents', '/forum/topics', '/contents/:id/visit',
    '/forum/topics/:id/visit', '/contents/:id/comments', '/contents/:id/files', '/contents/:id/comment-files'],
  PUT: ['/contents/:id', '/contents/:id/like', '/contents/:id/bookmark', '/forum/topics/:id/follow'],
  DELETE: ['/contents/:id/draft'],
};

export function acceptsMiniSession(method: string, route: string) {
  return miniRoutes[method === 'HEAD' ? 'GET' : method]?.includes(route.slice(4)) ?? false;
}

export async function createMiniSession(tx: Queryable, userId: string, appId: string) {
  const session = `wx1_${token()}`;
  await tx.query('DELETE FROM sessions WHERE user_id=$1 AND mini_app_id=$2 AND expires_at<=now()', [userId, appId]);
  await tx.query(`INSERT INTO sessions(token_hash,user_id,csrf,expires_at,mini_app_id)
    VALUES($1,$2,'',now()+interval '12 hours',$3)`, [hash(session), userId, appId]);
  return session;
}

const bridgeIdentity = {
  appId: z.string().max(32),
  openId: z.string().regex(/^[\w-]{1,128}$/),
};
const bridgeInput = z.union([
  z.object({ ...bridgeIdentity, action: z.enum(['begin', 'exchange']) }).strict(),
  z.object({ ...bridgeIdentity, action: z.literal('phone'), phone: phoneNumber }).strict(),
]);

export async function miniprogramRoutes(
  app: FastifyInstance, ctx: AppContext, settings: NonNullable<AppContext['miniprogram']>,
) {
  const { db } = ctx;
  const { appId } = settings;
  const limited = { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } };
  app.post('/api/mini/bridge', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const credential = req.headers.authorization ?? '';
    if (!timingSafeEqual(Buffer.from(hash(credential)), Buffer.from(hash(`MiniBridge ${settings.bridgeSecret}`))))
      fail(401, '云函数身份验证失败');
    const input = bridgeInput.parse(req.body);
    if (input.appId !== appId) fail(403, '小程序身份不匹配');
    const identity = hash(`${appId}\n${input.openId}`);
    return db.transaction(async (tx) => {
      if (input.action === 'phone') {
        const user = (await tx.query(
          'SELECT id FROM users WHERE phone_e164=$1 AND active AND NOT must_reset AND deleted_at IS NULL FOR UPDATE',
          [input.phone],
        ))[0];
        if (!user) return { state: 'phone-unmatched' };
        const forUser = (await tx.query('SELECT identity_hash FROM mini_identities WHERE app_id=$1 AND user_id=$2', [appId, user.id]))[0];
        if (forUser && forUser.identity_hash !== identity) return { state: 'phone-conflict' };
        const created = await tx.query(`INSERT INTO mini_identities(app_id,identity_hash,user_id,binding_method)
          VALUES($1,$2,$3,'phone') ON CONFLICT(app_id,identity_hash) DO UPDATE
          SET user_id=excluded.user_id,binding_method='phone',code_hash=NULL,expires_at=NULL
          WHERE mini_identities.user_id IS NULL RETURNING user_id`, [appId, identity, user.id]);
        if (!created.length && !forUser) return { state: 'phone-conflict' };
        if (created.length) await audit(tx, user.id, 'miniprogram.bind-phone', user.id);
        return { state: 'signed-in', session: await createMiniSession(tx, user.id, appId) };
      }
      const bound = (await tx.query('SELECT user_id FROM mini_identities WHERE app_id=$1 AND identity_hash=$2', [appId, identity]))[0];
      if (bound?.user_id) {
        const user = (await tx.query('SELECT id, active, must_reset, deleted_at FROM users WHERE id=$1 FOR UPDATE', [bound.user_id]))[0];
        if (!user?.active || user.deleted_at || user.must_reset) fail(403, '请在社区网页核对账号状态');
        const stillBound = await tx.query('SELECT 1 FROM mini_identities WHERE app_id=$1 AND identity_hash=$2 AND user_id=$3', [appId, identity, user.id]);
        if (!stillBound.length) return { state: 'unbound' };
        return { state: 'signed-in', session: await createMiniSession(tx, user.id, appId) };
      }
      if (input.action === 'exchange') return { state: 'unbound' };
      await tx.query('DELETE FROM mini_identities WHERE user_id IS NULL AND expires_at<=now()');
      const code = randomBytes(8).toString('hex').toUpperCase();
      const rows = await tx.query(`INSERT INTO mini_identities(app_id,identity_hash,code_hash,expires_at)
        VALUES($1,$2,$3,now()+interval '5 minutes')
        ON CONFLICT(app_id,identity_hash) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at
        WHERE mini_identities.user_id IS NULL RETURNING expires_at`, [appId, identity, hash(code)]);
      return rows.length ? { state: 'pending', code, expiresAt: rows[0].expires_at } : { state: 'retry' };
    });
  });

  app.get('/api/mini/binding', async (req) => ({
    bound: Boolean((await db.query('SELECT 1 FROM mini_identities WHERE app_id=$1 AND user_id=$2', [appId, req.user.id])).length),
  }));

  app.post('/api/mini/binding', limited, async (req) => {
    const { code } = z.object({ code: z.string().max(24).transform((s) => s.replace(/[\s-]/g, '').toUpperCase()).pipe(z.string().regex(/^[0-9A-F]{16}$/)) }).strict().parse(req.body);
    await db.transaction(async (tx) => {
      const user = (await tx.query('SELECT id FROM users WHERE id=$1 AND active AND NOT must_reset AND deleted_at IS NULL FOR UPDATE', [req.user.id]))[0];
      if (!user) fail(403, '请核对账号状态');
      if ((await tx.query('SELECT 1 FROM mini_identities WHERE app_id=$1 AND user_id=$2', [appId, user.id])).length)
        fail(409, '该账号已绑定微信，请先解除原绑定');
      const rows = await tx.query(`UPDATE mini_identities SET user_id=$1,code_hash=NULL,expires_at=NULL
        WHERE app_id=$2 AND code_hash=$3 AND user_id IS NULL AND expires_at>now() RETURNING identity_hash`, [user.id, appId, hash(code)]);
      if (!rows.length) fail(400, '配对码已失效，请在小程序重新获取');
      await audit(tx, user.id, 'miniprogram.bind', user.id);
    });
    return { bound: true };
  });

  app.delete('/api/mini/binding', limited, async (req) => {
    await db.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
      const rows = await tx.query('DELETE FROM mini_identities WHERE app_id=$1 AND user_id=$2 RETURNING user_id', [appId, req.user.id]);
      await tx.query('DELETE FROM sessions WHERE mini_app_id=$1 AND user_id=$2', [appId, req.user.id]);
      if (rows.length) await audit(tx, req.user.id, 'miniprogram.unbind', req.user.id);
    });
    return { bound: false };
  });
}
