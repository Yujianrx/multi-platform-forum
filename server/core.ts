import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as _scrypt,
  timingSafeEqual,
} from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database, Queryable, Row } from './db.js';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from './account-policy.js';
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString('base64url');
export const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(code: number, message: string): never {
  throw new HttpError(code, message);
}
export const identifier = z.string().uuid();
export const safeUrl = z
  .string()
  .max(2000)
  .refine((s) => !s || /^https?:\/\//i.test(s), '仅支持 http/https 链接')
  .refine((s) => {
    if (!s) return true;
    try {
      const u = new URL(s);
      return !u.username && !u.password;
    } catch {
      return false;
    }
  }, '链接格式错误');
export type User = {
  id: string;
  username: string;
  name: string;
  role: 'member' | 'moderator' | 'admin';
  department_id: string | null;
  active: boolean;
  must_reset: boolean;
  bio: string;
  avatar_version?: string | null;
  moderation_exempt?: boolean;
};
declare module 'fastify' {
  interface FastifyRequest {
    user: User;
    csrf: string;
    sessionHash: string;
    apiKeyId: string;
    miniSession: boolean;
  }
  interface FastifyContextConfig {
    personalApiKey?: boolean;
  }
}
export type AppContext = {
  db: Database;
  dataDir: string;
  production: boolean;
  origin: string;
  provider: string;
  clamHost?: string;
  clamPort: number;
  miniprogram?: { appId: string; bridgeSecret: string };
};
export const userFields =
  'id,username,name,role,department_id,active,must_reset,bio,avatar_version,moderation_exempt';
export async function passwordHash(password: string) {
  const salt = randomBytes(16);
  const result = await new Promise<Buffer>((resolve, reject) =>
    _scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, b) =>
      e ? reject(e) : resolve(b),
    ),
  );
  return `scrypt$${salt.toString('hex')}$${result.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [alg, salt, digest] = encoded.split('$');
  if (alg !== 'scrypt') return false;
  const result = await new Promise<Buffer>((resolve, reject) =>
    _scrypt(
      password,
      Buffer.from(salt, 'hex'),
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, b) => (e ? reject(e) : resolve(b)),
    ),
  );
  const expected = Buffer.from(digest, 'hex');
  return expected.length === result.length && timingSafeEqual(result, expected);
}
export const accountPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(PASSWORD_MAX_LENGTH, `密码最多 ${PASSWORD_MAX_LENGTH} 位`)
  .refine((s) => s.trim().length > 0, '密码不能全为空格');
export async function audit(
  db: Queryable,
  actor: string | null,
  action: string,
  target: string,
  details: Row = {},
  result = 'success',
) {
  await db.query(
    'INSERT INTO audit_logs(id,actor_id,action,target,result,details) VALUES($1,$2,$3,$4,$5,$6)',
    [id(), actor, action, target, result, JSON.stringify(details)],
  );
}
export async function notify(
  db: Queryable,
  userId: string,
  contentId: string | null,
  kind: string,
  message: string,
) {
  await db.query(
    'INSERT INTO notifications(id,user_id,content_id,kind,message) VALUES($1,$2,$3,$4,$5)',
    [id(), userId, contentId, kind, message],
  );
}
export async function siteSettings(db: Queryable) {
  return (await db.query("SELECT value FROM settings WHERE key='site'"))[0].value;
}
export function admin(req: FastifyRequest) {
  if (req.user.role !== 'admin') fail(403, '需要超级管理员权限');
}
export function staff(req: FastifyRequest) {
  if (req.user.role === 'member') fail(403, '需要管理权限');
}
export function pageQuery(query: unknown) {
  return z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(12),
    })
    .parse(query);
}
export function registerErrors(app: FastifyInstance) {
  app.setErrorHandler((error: any, req, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；') });
    if (error.code === '23505')
      return reply.code(409).send({ error: '记录已存在，请检查账号或名称' });
    if (error.code === '23503')
      return reply.code(400).send({ error: '引用的记录不存在或仍在使用' });
    const status = error.statusCode || 500;
    if (status >= 500)
      req.log.error(
        { name: error.name, code: error.code, message: error.message },
        'request failed',
      );
    reply
      .code(status)
      .send({ error: status >= 500 ? '服务暂时不可用，请稍后重试' : error.message });
  });
}
