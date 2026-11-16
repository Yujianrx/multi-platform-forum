import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type AppContext, id, hash, fail, audit, identifier } from './core.js';
import type { Queryable } from './db.js';
import { contentData, saveContentRevision } from './content.js';

const postInput = z
  .object({
    type: z.enum(['experience', 'project', 'prompt', 'discussion']).default('experience'),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(150000),
    summary: z.string().trim().min(5).max(400).optional(),
    categoryId: identifier,
    tags: z.array(z.string().max(30)).max(10).default([]),
    visibility: z.enum(['company', 'departments']).default('company'),
    departments: z.array(identifier).max(50).default([]),
    kind: z.enum(['discussion', 'question', 'feedback', 'chat']).default('discussion'),
  })
  .strict();
const requestKey = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{8,100}$/, 'Idempotency-Key 应为 8–100 位字母、数字或 ._:-');

async function statusFor(db: Queryable, userId: string, contentId: string, origin: string) {
  const row = (
    await db.query(
      `SELECT c.id,c.state,r.status,r.reason FROM api_posts p JOIN contents c ON c.id=p.content_id LEFT JOIN revisions r ON r.id=c.latest_revision_id WHERE p.user_id=$1 AND c.author_id=$1 AND c.id=$2 AND c.state<>'deleted'`,
      [userId, contentId],
    )
  )[0];
  if (!row) fail(404, '接口投稿不存在或无权访问');
  return {
    id: row.id,
    status:
      row.state === 'published'
        ? 'published'
        : row.state === 'withdrawn'
          ? 'withdrawn'
          : row.status,
    url: origin + '/content/' + row.id,
    reason: row.reason || '',
  };
}
export async function openApiRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/open/v1/taxonomy', { config: { personalApiKey: true } }, async () => ({
    categories: await ctx.db.query('SELECT id,name FROM categories ORDER BY name'),
    tags: await ctx.db.query('SELECT name FROM tags ORDER BY name'),
    departments: await ctx.db.query('SELECT id,name FROM departments ORDER BY sort_order,name'),
  }));
  app.get('/api/open/v1/posts/:id', { config: { personalApiKey: true } }, async (req) =>
    statusFor(ctx.db, req.user.id, identifier.parse((req.params as any).id), ctx.origin),
  );
  app.post(
    '/api/open/v1/posts',
    { config: { personalApiKey: true, rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const key = requestKey.parse(req.headers['idempotency-key']);
      const p = postInput.parse(req.body);
      if (p.type !== 'discussion' && p.kind !== 'discussion') fail(400, '只有论坛话题可指定 kind');
      // The same schema and revision transaction used by the website handle all publication rules.
      const data = contentData.parse({
        title: p.title,
        summary: p.summary ?? p.body.replace(/\s+/g, ' ').slice(0, 160),
        body: p.type === 'prompt' ? '' : p.body,
        categoryId: p.categoryId,
        tags: p.tags,
        visibility: p.visibility,
        departments: p.departments,
        fields: p.type === 'prompt' ? { prompt: p.body } : {},
      });
      const digest = hash(JSON.stringify({ type: p.type, kind: p.kind, data }));
      const result = await ctx.db.transaction(async (tx) => {
        // Serialize a user's creation requests, including simultaneous retries across different keys.
        const user = (
          await tx.query('SELECT active,must_reset FROM users WHERE id=$1 FOR UPDATE', [
            req.user.id,
          ])
        )[0];
        if (!user?.active || user.must_reset) fail(401, '账号不可用，请重新确认账号状态');
        const activeKey = await tx.query(
          'SELECT id FROM api_keys WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',
          [req.apiKeyId, req.user.id],
        );
        if (!activeKey.length) fail(401, '接口密钥已失效');
        const previous = (
          await tx.query(
            'SELECT content_id,request_digest FROM api_posts WHERE user_id=$1 AND idempotency_key=$2',
            [req.user.id, key],
          )
        )[0];
        if (previous) {
          if (previous.request_digest !== digest)
            fail(409, '同一个 Idempotency-Key 已用于其他内容，请为新内容使用新键');
          return {
            ...(await statusFor(tx, req.user.id, previous.content_id, ctx.origin)),
            replayed: true,
          };
        }
        const recent = (
          await tx.query(
            "SELECT count(*)::int n FROM api_posts WHERE user_id=$1 AND created_at>now()-interval '24 hours'",
            [req.user.id],
          )
        )[0].n;
        if (recent >= 100) fail(429, '每个账号 24 小时最多通过接口投稿 100 篇');
        if (!(await tx.query('SELECT id FROM categories WHERE id=$1', [p.categoryId])).length)
          fail(400, '分类不存在，请先获取分类列表');
        const cid = id();
        await tx.query('INSERT INTO contents(id,author_id,type,category_id) VALUES($1,$2,$3,$4)', [
          cid,
          req.user.id,
          p.type,
          p.categoryId,
        ]);
        if (p.type === 'discussion') {
          await tx.query('INSERT INTO forum_topics(content_id,kind) VALUES($1,$2)', [cid, p.kind]);
          await tx.query('INSERT INTO forum_subscriptions(content_id,user_id) VALUES($1,$2)', [
            cid,
            req.user.id,
          ]);
        }
        await saveContentRevision(tx, req.user, cid, { data, submit: true, baseRevisionId: null });
        await tx.query(
          'INSERT INTO api_posts(content_id,user_id,api_key_id,idempotency_key,request_digest) VALUES($1,$2,$3,$4,$5)',
          [cid, req.user.id, req.apiKeyId, key, digest],
        );
        await audit(tx, req.user.id, 'api.post.submit', cid, {
          apiKeyId: req.apiKeyId,
          type: p.type,
        });
        return { ...(await statusFor(tx, req.user.id, cid, ctx.origin)), replayed: false };
      });
      return reply.code(result.replayed ? 200 : 201).send(result);
    },
  );
}
