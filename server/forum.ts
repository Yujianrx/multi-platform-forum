import type { FastifyInstance } from 'fastify';
import { recordContentView } from './views.js';
import { syncContentHonors } from './honors-engine.js';
import { z } from 'zod';
import { type AppContext, id, identifier, fail, pageQuery, audit } from './core.js';
import { getContent, canManage, publishedSQL, readSQL } from './permissions.js';

const kinds = z.enum(['discussion', 'question', 'feedback', 'chat']);
const replies = `(SELECT count(*)::int FROM comments cm WHERE cm.content_id=c.id AND cm.status='approved')`;
const activity = `GREATEST(COALESCE(r.approved_at,r.created_at),(SELECT max(COALESCE(cm.approved_at,cm.created_at)) FROM comments cm WHERE cm.content_id=c.id AND cm.status='approved'))`;
export async function forumRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  app.get('/api/forum/boards', async (req) => ({
    items: await db.query(
      `SELECT cat.id,cat.name,count(c.id)::int topics FROM categories cat LEFT JOIN contents c ON c.category_id=cat.id AND c.type='discussion' AND ${publishedSQL()} GROUP BY cat.id,cat.name ORDER BY cat.name`,
      [req.user.id],
    ),
  }));
  app.get('/api/forum/topics', async (req) => {
    const q = z
      .object({
        board: identifier.optional(),
        related: identifier.optional(),
        kind: kinds.optional(),
        q: z.string().max(100).default(''),
        sort: z.enum(['active', 'newest', 'popular', 'unanswered']).default('active'),
        scope: z.enum(['all', 'mine', 'participated', 'following']).default('all'),
        resolved: z.enum(['0', '1']).optional(),
      })
      .parse(req.query);
    const { page, limit } = pageQuery(req.query);
    if (q.related) await getContent(db, req.user, q.related);
    const values: any[] = [req.user.id];
    const bind = (v: any) => {
      values.push(v);
      return '$' + values.length;
    };
    let where = `c.type='discussion' AND ${q.scope === 'mine' ? `c.author_id=$1 AND ${readSQL()}` : publishedSQL()}`;
    if (q.board) where += ` AND c.category_id=${bind(q.board)}`;
    if (q.related) where += ` AND f.related_content_id=${bind(q.related)}`;
    if (q.kind) where += ` AND f.kind=${bind(q.kind)}`;
    if (q.resolved) where += ` AND f.resolved=${bind(q.resolved === '1')}`;
    if (q.scope === 'participated')
      where += ` AND EXISTS(SELECT 1 FROM comments mc WHERE mc.content_id=c.id AND mc.author_id=$1 AND mc.status<>'deleted')`;
    if (q.scope === 'following')
      where += ` AND EXISTS(SELECT 1 FROM forum_subscriptions fs WHERE fs.content_id=c.id AND fs.user_id=$1)`;
    if (q.sort === 'unanswered') where += ` AND ${replies}=0 AND NOT f.resolved`;
    if (q.q) {
      const p = bind('%' + q.q.replace(/[\\%_]/g, '\\$&') + '%');
      where += ` AND (r.data->>'title' ILIKE ${p} OR r.data->>'body' ILIKE ${p})`;
    }
    const from = `FROM contents c JOIN forum_topics f ON f.content_id=c.id LEFT JOIN revisions r ON r.id=${q.scope === 'mine' ? 'c.latest_revision_id' : 'c.published_revision_id'} JOIN users u ON u.id=c.author_id JOIN categories cat ON cat.id=c.category_id WHERE ${where}`;
    const total = (await db.query(`SELECT count(*)::int total ${from}`, values))[0].total;
    const order =
      q.sort === 'newest'
        ? 'c.published_at DESC NULLS LAST'
        : q.sort === 'popular'
          ? 'replies DESC,views DESC,last_activity DESC'
          : 'last_activity DESC';
    const items = await db.query(
      `SELECT c.id,c.type,c.author_id,c.state,c.pinned,c.featured,c.created_at,c.published_at,r.status,r.data->>'title' title,r.data->>'summary' summary,u.name author,u.avatar_version author_avatar_version,cat.name board,f.*,
      ${replies} replies,${activity} last_activity,(SELECT count(*)::int FROM forum_visits fv WHERE fv.content_id=c.id) views,
      (SELECT cu.name FROM comments cm JOIN users cu ON cu.id=cm.author_id WHERE cm.content_id=c.id AND cm.status='approved' ORDER BY COALESCE(cm.approved_at,cm.created_at) DESC,cm.id LIMIT 1) last_author,
      NOT EXISTS(SELECT 1 FROM forum_visits fv WHERE fv.content_id=c.id AND fv.user_id=$1 AND fv.last_seen_at>=${activity}) unread
      ${from} ORDER BY c.pinned DESC,${order},c.id LIMIT ${bind(limit)} OFFSET ${bind((page - 1) * limit)}`,
      values,
    );
    return { items, total, page, limit };
  });
  app.post(
    '/api/forum/topics',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const p = z
        .object({
          categoryId: identifier,
          kind: kinds,
          relatedContentId: identifier.nullable().optional(),
        })
        .strict()
        .parse(req.body);
      const cid = id();
      await db.transaction(async (tx) => {
        if (!(await tx.query('SELECT id FROM categories WHERE id=$1', [p.categoryId])).length)
          fail(400, '版块不存在');
        if (p.relatedContentId) {
          const parent = await getContent(tx, req.user, p.relatedContentId, 'published');
          if (parent.type === 'discussion') fail(400, '话题只能关联经验、项目、技能包或提示词');
        }
        await tx.query(
          "INSERT INTO contents(id,author_id,type,category_id) VALUES($1,$2,'discussion',$3)",
          [cid, req.user.id, p.categoryId],
        );
        await tx.query(
          'INSERT INTO forum_topics(content_id,kind,related_content_id) VALUES($1,$2,$3)',
          [cid, p.kind, p.relatedContentId || null],
        );
        await tx.query('INSERT INTO forum_subscriptions(content_id,user_id) VALUES($1,$2)', [
          cid,
          req.user.id,
        ]);
      });
      return reply.code(201).send({ id: cid });
    },
  );
  app.get('/api/forum/topics/:id', async (req) => {
    const cid = identifier.parse((req.params as any).id);
    await getContent(db, req.user, cid);
    const f = (
      await db.query(
        'SELECT f.*,EXISTS(SELECT 1 FROM forum_subscriptions fs WHERE fs.content_id=f.content_id AND fs.user_id=$2) following,(SELECT count(*)::int FROM forum_visits fv WHERE fv.content_id=f.content_id) views FROM forum_topics f WHERE f.content_id=$1',
        [cid, req.user.id],
      )
    )[0];
    if (!f) fail(404, '话题不存在');
    const related = f.related_content_id
      ? (
          await db.query(
            "SELECT c.id,c.type,r.data->>'title' title FROM contents c LEFT JOIN revisions r ON r.id=c.published_revision_id WHERE c.id=$1",
            [f.related_content_id],
          )
        )[0]
      : null;
    return { ...f, related };
  });
  app.post('/api/forum/topics/:id/visit', async (req) => {
    const cid = identifier.parse((req.params as any).id);
    await db.transaction(async (tx) => {
      const c = await recordContentView(tx, req.user, cid);
      if (c.type !== 'discussion') fail(404, '话题不存在');
      await tx.query(
        'INSERT INTO forum_visits(content_id,user_id) VALUES($1,$2) ON CONFLICT(content_id,user_id) DO UPDATE SET last_seen_at=now()',
        [cid, req.user.id],
      );
    });
    return { ok: true };
  });
  app.put('/api/forum/topics/:id/follow', async (req) => {
    const cid = identifier.parse((req.params as any).id),
      p = z.object({ active: z.boolean() }).strict().parse(req.body);
    const c = await getContent(db, req.user, cid, 'published');
    if (c.type !== 'discussion') fail(404, '话题不存在');
    if (p.active)
      await db.query(
        'INSERT INTO forum_subscriptions(content_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [cid, req.user.id],
      );
    else
      await db.query('DELETE FROM forum_subscriptions WHERE content_id=$1 AND user_id=$2', [
        cid,
        req.user.id,
      ]);
    return { ok: true };
  });
  app.patch('/api/forum/topics/:id/status', async (req) => {
    const cid = identifier.parse((req.params as any).id),
      p = z
        .object({
          locked: z.boolean().optional(),
          pinned: z.boolean().optional(),
          resolved: z.boolean().optional(),
          acceptedCommentId: identifier.nullable().optional(),
        })
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .parse(req.body);
    await db.transaction(async (tx) => {
      const c = await getContent(tx, req.user, cid, 'published'),
        manager = await canManage(tx, req.user, cid);
      await tx.query('SELECT id FROM contents WHERE id=$1 FOR UPDATE', [cid]);
      const f = (
        await tx.query('SELECT * FROM forum_topics WHERE content_id=$1 FOR UPDATE', [cid])
      )[0];
      if (!f) fail(404, '话题不存在');
      if ((p.locked !== undefined || p.pinned !== undefined) && !manager)
        fail(403, '只有版主或管理员可以锁帖和置顶');
      if (
        (p.resolved !== undefined || p.acceptedCommentId !== undefined) &&
        c.author_id !== req.user.id &&
        !manager
      )
        fail(403, '只有楼主或版主可以处理问题');
      if ((p.resolved !== undefined || p.acceptedCommentId !== undefined) && f.kind !== 'question')
        fail(400, '仅提问支持解决状态');
      if (
        p.acceptedCommentId &&
        !(
          await tx.query(
            "SELECT id FROM comments WHERE id=$1 AND content_id=$2 AND status='approved' FOR UPDATE",
            [p.acceptedCommentId, cid],
          )
        ).length
      )
        fail(400, '只能采纳本帖已通过审核的回复');
      const resolved = p.acceptedCommentId ? true : (p.resolved ?? f.resolved);
      const accepted = !resolved
        ? null
        : p.acceptedCommentId === undefined
          ? f.accepted_comment_id
          : p.acceptedCommentId;
      await tx.query(
        'UPDATE forum_topics SET locked=$2,resolved=$3,accepted_comment_id=$4 WHERE content_id=$1',
        [cid, p.locked ?? f.locked, resolved, accepted],
      );
      if (
        accepted !== f.accepted_comment_id ||
        (p.acceptedCommentId && req.user.id === c.author_id)
      ) {
        await tx.query(
          'UPDATE forum_topics SET accepted_by=$2,accepted_at=$3 WHERE content_id=$1',
          [
            cid,
            accepted ? req.user.id : null,
            accepted
              ? accepted === f.accepted_comment_id && f.accepted_at
                ? f.accepted_at
                : new Date()
              : null,
          ],
        );
      }
      if (p.pinned !== undefined)
        await tx.query('UPDATE contents SET pinned=$2 WHERE id=$1', [cid, p.pinned]);
      await audit(tx, req.user.id, 'forum.status', cid, p);
      await syncContentHonors(tx, cid, req.user.id);
    });
    return { ok: true };
  });
}
