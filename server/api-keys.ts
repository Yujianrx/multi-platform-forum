import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  type AppContext,
  type User,
  hash,
  token,
  id,
  identifier,
  fail,
  audit,
  userFields,
} from './core.js';
import type { Queryable } from './db.js';

const fields = 'id,name,prefix,created_at,expires_at,revoked_at,last_used_at';
export async function revokeUserApiKeys(db: Queryable, userId: string) {
  await db.query('UPDATE api_keys SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [
    userId,
  ]);
}
export async function authenticateApiKey(ctx: AppContext, req: FastifyRequest) {
  const match = /^Bearer (aic_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
  if (!match) fail(401, '请使用个人接口密钥');
  const row = (
    await ctx.db.query(
      `SELECT ${userFields
        .split(',')
        .map((f) => 'u.' + f)
        .join(
          ',',
        )},k.id AS api_key_id FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.token_hash=$1 AND k.revoked_at IS NULL AND k.expires_at>now() AND u.active AND NOT u.must_reset`,
      [hash(match[1])],
    )
  )[0];
  if (!row) fail(401, '接口密钥无效、已过期或账号不可用');
  req.user = row as User;
  req.apiKeyId = row.api_key_id;
  await ctx.db.query(
    "UPDATE api_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<now()-interval '1 minute')",
    [req.apiKeyId],
  );
}
export async function apiKeyRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/auth/api-keys', async (req) => ({
    items: await ctx.db.query(
      `SELECT ${fields} FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT 100`,
      [req.user.id],
    ),
  }));
  app.post(
    '/api/auth/api-keys',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const p = z
        .object({
          name: z.string().trim().min(1).max(60),
          expiresInDays: z.number().int().min(1).max(365).default(90),
        })
        .strict()
        .parse(req.body);
      const raw = 'aic_' + token(),
        keyId = id();
      const key = await ctx.db.transaction(async (tx) => {
        const user = (
          await tx.query('SELECT active,must_reset FROM users WHERE id=$1 FOR UPDATE', [
            req.user.id,
          ])
        )[0];
        if (!user?.active || user.must_reset) fail(403, '请先确认账号状态并设置密码');
        const count = (
          await tx.query(
            'SELECT count(*)::int n FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()',
            [req.user.id],
          )
        )[0].n;
        if (count >= 5) fail(409, '最多保留 5 把有效密钥，请先撤销不再使用的密钥');
        const row = (
          await tx.query(
            `INSERT INTO api_keys(id,user_id,name,token_hash,prefix,expires_at) VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 day') RETURNING ${fields}`,
            [keyId, req.user.id, p.name, hash(raw), raw.slice(0, 12), p.expiresInDays],
          )
        )[0];
        await audit(tx, req.user.id, 'api-key.create', keyId, {
          name: p.name,
          expiresInDays: p.expiresInDays,
        });
        return row;
      });
      return reply.code(201).send({ ...key, token: raw });
    },
  );
  app.delete('/api/auth/api-keys/:id', async (req) => {
    const keyId = identifier.parse((req.params as any).id);
    await ctx.db.transaction(async (tx) => {
      const key = (
        await tx.query('SELECT revoked_at FROM api_keys WHERE id=$1 AND user_id=$2 FOR UPDATE', [
          keyId,
          req.user.id,
        ])
      )[0];
      if (!key) fail(404, '密钥不存在');
      if (!key.revoked_at) {
        await tx.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [keyId]);
        await audit(tx, req.user.id, 'api-key.revoke', keyId);
      }
    });
    return { ok: true };
  });
}
