import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { captchaRoutes, consumeCaptcha, type CaptchaSource } from './captcha.js';
import { authenticateApiKey, revokeUserApiKeys } from './api-keys.js';
import { acceptsMiniSession, createMiniSession } from './miniprogram.js';
import {
  type AppContext,
  type User,
  hash,
  token,
  id,
  passwordHash,
  verifyPassword,
  accountPassword,
  fail,
  userFields,
  audit,
} from './core.js';
export async function authRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  captchaSource?: CaptchaSource,
) {
  const { db } = ctx;
  const apiAuthBudget = app.createRateLimit({
    max: 600,
    timeWindow: '1 minute',
    keyGenerator: (req) => 'open-auth:' + req.ip,
  });
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: ctx.production,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7,
  };
  app.decorateRequest('user', null as unknown as User);
  app.decorateRequest('csrf', '');
  app.decorateRequest('sessionHash', '');
  app.decorateRequest('apiKeyId', '');
  app.decorateRequest('miniSession', false);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.routeOptions.url?.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store, private').header('Vary', 'Cookie');
    if (req.routeOptions.config.personalApiKey) {
      reply.header('Vary', 'Authorization');
      const budget = await apiAuthBudget(req);
      if (!budget.isAllowed && budget.isExceeded) {
        reply.header('Retry-After', budget.ttlInSeconds);
        fail(429, '接口请求过于频繁，请稍后重试');
      }
      await authenticateApiKey(ctx, req);
      return;
    }
    if (ctx.miniprogram && req.routeOptions.url === '/api/mini/bridge') return;
    if (ctx.miniprogram && ['/api/mini/auth/login', '/api/mini/auth/register', '/api/mini/auth/captcha'].includes(req.routeOptions.url)) return;
    const publicRoute = [
      '/api/auth/login',
      '/api/auth/captcha',
      '/api/auth/register',
      '/api/auth/reset',
      '/api/public',
      '/api/health',
    ].includes(req.routeOptions.url);
    const authorization = req.headers.authorization || '';
    const miniSession = Boolean(ctx.miniprogram && /^Bearer wx1_[\w-]{43}$/.test(authorization));
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (miniSession) {
      reply.header('Vary', 'Authorization');
      if (!acceptsMiniSession(req.method, req.routeOptions.url)) fail(403, '小程序不支持此操作');
    }
    if (write && !miniSession && req.headers.origin !== ctx.origin)
      fail(403, '请求来源验证失败');
    if (publicRoute) return;
    const raw = miniSession ? authorization.slice(7) : req.cookies.session;
    if (!raw) fail(401, '请先登录');
    const rows = await db.query(
      `SELECT ${userFields
        .split(',')
        .map((f) => 'u.' + f)
        .join(
          ',',
        )},s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active AND s.mini_app_id IS NOT DISTINCT FROM $2`,
      [hash(raw), miniSession ? ctx.miniprogram!.appId : null],
    );
    if (!rows.length) {
      reply.clearCookie('session', { path: '/' });
      fail(401, '登录已失效，请重新登录');
    }
    req.user = rows[0] as User;
    req.csrf = rows[0].csrf;
    req.sessionHash = hash(raw);
    req.miniSession = miniSession;
    if (
      req.user.must_reset &&
      !['/api/auth/me', '/api/auth/password', '/api/auth/logout'].includes(req.url.split('?')[0])
    )
      fail(403, '请先设置新密码');
    if (write && !miniSession && req.headers['x-csrf-token'] !== req.csrf)
      fail(403, '安全校验失败，请刷新页面');
  });
  const createSession = async (userId: string, reply: FastifyReply, mini = false, verifiedPassword?: string) => {
    const raw = token(),
      csrf = token();
    const { user, session } = await db.transaction(async (tx) => {
      const { password_hash, ...user } = (
        await tx.query(
          `SELECT ${userFields},password_hash FROM users WHERE id=$1 AND active AND deleted_at IS NULL FOR UPDATE`,
          [userId],
        )
      )[0] || {};
      if (!user.id || (verifiedPassword !== undefined && verifiedPassword !== password_hash)) fail(401, '账号已不可用，请重新登录');
      if (mini && ctx.miniprogram) {
        if (user.must_reset) fail(403, '请先在社区网页设置新密码');
        return { user, session: await createMiniSession(tx, userId, ctx.miniprogram.appId) };
      }
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
        [hash(raw), userId, csrf],
      );
      return { user };
    });
    if (session) return { user, session };
    reply.setCookie('session', raw, cookieOptions);
    return {
      user,
      csrf,
    };
  };
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  await captchaRoutes(app, ctx, captchaSource);
  const register = async (req: FastifyRequest, reply: FastifyReply, mini = false) => {
    const p = z
      .object({
        name: z.string().trim().min(1, '请填写姓名').max(50, '姓名最多 50 个字'),
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9._-]{3,40}$/, '账号为 3–40 位字母、数字或 ._-'),
        password: accountPassword,
        confirmPassword: z.string(),
        invite: z
          .string()
          .trim()
          .min(8, '邀请码不完整，请粘贴管理员提供的完整邀请码')
          .max(200, '邀请码格式不正确'),
      })
      .strict()
      .refine((v) => v.password === v.confirmPassword, '两次密码不一致')
      .parse(req.body);
    const encoded = await passwordHash(p.password);
    const uid = id();
    await db.transaction(async (tx) => {
      const invite = (
        await tx.query('SELECT * FROM invitations WHERE code_hash=$1 FOR UPDATE', [
          hash(p.invite.trim()),
        ])
      )[0];
      if (
        !invite ||
        invite.revoked ||
        new Date(invite.expires_at) <= new Date() ||
        invite.used_count >= invite.max_uses
      )
        fail(400, '邀请码无效、已到期或名额已用完，请联系管理员重新获取');
      await tx.query(
        'INSERT INTO users(id,username,name,password_hash,department_id) VALUES($1,$2,$3,$4,$5)',
        [uid, p.username, p.name, encoded, invite.department_id],
      );
      await tx.query('UPDATE invitations SET used_count=used_count+1 WHERE id=$1', [invite.id]);
      await tx.query('INSERT INTO invitation_uses(invitation_id,user_id) VALUES($1,$2)', [
        invite.id,
        uid,
      ]);
      await audit(tx, uid, 'account.register', uid);
    });
    return reply.code(201).send(await createSession(uid, reply, mini));
  };
  app.post('/api/auth/register', limited, (req, reply) => register(req, reply));
  if (ctx.miniprogram) app.post('/api/mini/auth/register', limited, (req, reply) => register(req, reply, true));
  // Fixed dummy hash prevents cheap account-enumeration through nonexistent users.
  const dummy = await passwordHash(token());
  const login = async (req: FastifyRequest, reply: FastifyReply, mini = false) => {
    const p = z
      .object({
        username: z.string().max(100),
        password: z.string().max(128),
        captchaId: z.string().max(100).default(''),
        captchaCode: z.string().max(20).default(''),
      })
      .parse(req.body);
    const challenge = mini ? req.headers['x-captcha-token'] : req.cookies.login_challenge;
    await consumeCaptcha(db, typeof challenge === 'string' ? challenge : undefined, p.captchaId, p.captchaCode);
    const u = (
      await db.query('SELECT * FROM users WHERE username=$1', [p.username.trim().toLowerCase()])
    )[0];
    const valid = await verifyPassword(p.password, u?.password_hash || dummy);
    if (!u || !valid || !u.active) fail(401, '账号或密码错误，或账号已停用');
    return createSession(u.id, reply, mini, u.password_hash);
  };
  app.post('/api/auth/login', limited, (req, reply) => login(req, reply));
  if (ctx.miniprogram) app.post('/api/mini/auth/login', limited, (req, reply) => login(req, reply, true));
  app.get('/api/auth/me', async (req) => ({ user: req.user, csrf: req.csrf }));
  app.post('/api/auth/logout', async (req, reply) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [req.sessionHash]);
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
  app.patch('/api/auth/profile', async (req) => {
    const p = z
      .object({
        name: z.string().trim().min(1, '请填写姓名').max(50, '姓名最多 50 个字'),
        bio: z.string().max(300),
      })
      .strict()
      .parse(req.body);
    const changed = await db.query(
      'UPDATE users SET name=$1,bio=$2 WHERE id=$3 AND active AND deleted_at IS NULL RETURNING id',
      [p.name, p.bio, req.user.id],
    );
    if (!changed.length) fail(401, '账号已不可用');
    return { ok: true };
  });
  app.post('/api/auth/password', limited, async (req, reply) => {
    const p = z
      .object({ currentPassword: z.string().max(128), password: accountPassword })
      .parse(req.body);
    const u = (await db.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]))[0];
    if (!(await verifyPassword(p.currentPassword, u.password_hash))) fail(400, '当前密码错误');
    if (p.currentPassword === p.password) fail(400, '新密码不能与旧密码相同');
    const encoded = await passwordHash(p.password);
    await db.transaction(async (tx) => {
      if (
        !(
          await tx.query(
            'SELECT id FROM users WHERE id=$1 AND active AND deleted_at IS NULL FOR UPDATE',
            [req.user.id],
          )
        ).length
      )
        fail(401, '账号已不可用');
      await tx.query('UPDATE users SET password_hash=$1,must_reset=false WHERE id=$2', [
        encoded,
        req.user.id,
      ]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [req.user.id]);
      await tx.query('DELETE FROM mini_identities WHERE user_id=$1', [req.user.id]);
      await revokeUserApiKeys(tx, req.user.id);
      await audit(tx, req.user.id, 'account.password', req.user.id);
    });
    return createSession(req.user.id, reply);
  });
  app.post('/api/auth/reset', limited, async (req, reply) => {
    const p = z.object({ token: z.string().max(200), password: accountPassword }).parse(req.body);
    const encoded = await passwordHash(p.password);
    const uid = await db.transaction(async (tx) => {
      const candidate = (
        await tx.query('SELECT user_id FROM password_resets WHERE token_hash=$1', [hash(p.token)])
      )[0];
      if (
        !candidate ||
        !(
          await tx.query(
            'SELECT id FROM users WHERE id=$1 AND active AND deleted_at IS NULL FOR UPDATE',
            [candidate.user_id],
          )
        ).length
      )
        fail(400, '重置凭证无效或已过期');
      const r = (
        await tx.query(
          'SELECT r.* FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.expires_at>now() AND u.active FOR UPDATE OF r',
          [hash(p.token)],
        )
      )[0];
      if (!r) fail(400, '重置凭证无效或已过期');
      await tx.query('UPDATE password_resets SET used_at=now() WHERE token_hash=$1', [
        hash(p.token),
      ]);
      await tx.query('UPDATE users SET password_hash=$1,must_reset=false WHERE id=$2', [
        encoded,
        r.user_id,
      ]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [r.user_id]);
      await tx.query('DELETE FROM mini_identities WHERE user_id=$1', [r.user_id]);
      await revokeUserApiKeys(tx, r.user_id);
      await audit(tx, r.user_id, 'account.reset', r.user_id);
      return r.user_id;
    });
    return createSession(uid, reply);
  });
}
