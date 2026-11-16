import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type AppContext, id, hash, fail, identifier, audit, pageQuery } from './core.js';
import { getContent, canManage } from './permissions.js';
import { enqueue } from './moderation.js';
import { syncContentHonors, honorSummaries } from './honors-engine.js';
export async function socialRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  app.put('/api/contents/:id/like', async (req) => {
    const cid = identifier.parse((req.params as any).id);
    await getContent(db, req.user, cid, 'published');
    const p = z.object({ active: z.boolean() }).strict().parse(req.body);
    await db.query(
      'INSERT INTO likes(content_id,user_id,active) VALUES($1,$2,$3) ON CONFLICT(content_id,user_id) DO UPDATE SET active=EXCLUDED.active',
      [cid, req.user.id, p.active],
    );
    return { ok: true };
  });
  app.put('/api/contents/:id/bookmark', async (req) => {
    const cid = identifier.parse((req.params as any).id);
    await getContent(db, req.user, cid, 'published');
    const p = z.object({ active: z.boolean() }).strict().parse(req.body);
    if (p.active)
      await db.query(
        'INSERT INTO bookmarks(content_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [cid, req.user.id],
      );
    else
      await db.query('DELETE FROM bookmarks WHERE content_id=$1 AND user_id=$2', [
        cid,
        req.user.id,
      ]);
    return { ok: true };
  });
  app.get('/api/contents/:id/comments', async (req) => {
    const cid = identifier.parse((req.params as any).id);
    const content = await getContent(db, req.user, cid);
    const manager = await canManage(db, req.user, cid),
      { page, limit } = pageQuery(req.query);
    const onlyAuthor = (req.query as any).author === '1';
    const where =
      "cm.content_id=$1 AND cm.status<>'deleted' AND (cm.status='approved' OR cm.author_id=$2 OR $3)" +
      (onlyAuthor ? ' AND cm.author_id=(SELECT author_id FROM contents WHERE id=$1)' : '');
    const items = await db.query(
      `SELECT cm.*,u.name AS author,u.avatar_version AS author_avatar_version,pu.name parent_author,pc.body parent_body,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'original_name',a.original_name,'size',a.size,'kind',a.kind,'mime',a.mime,'scan_status',a.scan_status)) FROM comment_attachments ca JOIN attachments a ON a.id=ca.attachment_id WHERE ca.comment_id=cm.id AND NOT a.deleted),'[]'::jsonb) files,(SELECT count(*)::int+1 FROM comments fc WHERE fc.content_id=cm.content_id AND fc.status='approved' AND (fc.created_at,fc.id)<=(cm.created_at,cm.id)) floor FROM comments cm JOIN users u ON u.id=cm.author_id LEFT JOIN comments pc ON pc.id=cm.parent_id AND pc.status='approved' LEFT JOIN users pu ON pu.id=pc.author_id WHERE ${where} ORDER BY cm.created_at,cm.id LIMIT $4 OFFSET $5`,
      [cid, req.user.id, manager, limit, (page - 1) * limit],
    );
    const honors = await honorSummaries(
      db,
      items.map((i) => i.author_id),
    );
    return {
      items: items.map((i) => ({ ...i, honors: honors[i.author_id] })),
      total: (
        await db.query(`SELECT count(*)::int total FROM comments cm WHERE ${where}`, [
          cid,
          req.user.id,
          manager,
        ])
      )[0].total,
    };
  });
  app.post(
    '/api/contents/:id/comments',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const cid = identifier.parse((req.params as any).id);
      await getContent(db, req.user, cid, 'published');
      const p = z
        .object({
          body: z.string().trim().max(5000),
          parentId: identifier.nullable().optional(),
          attachments: z.array(identifier).max(10).default([]),
        })
        .strict()
        .parse(req.body);
      if (
        p.parentId &&
        !(
          await db.query(
            "SELECT id FROM comments WHERE id=$1 AND content_id=$2 AND status='approved'",
            [p.parentId, cid],
          )
        ).length
      )
        fail(400, '回复的评论不存在或未通过审核');
      const commentId = id(),
        digest = hash(
          JSON.stringify({ body: p.body, attachments: [...new Set(p.attachments)].sort() }),
        );
      const status = await db.transaction(async (tx) => {
        await getContent(tx, req.user, cid, 'published');
        const topic = (
          await tx.query('SELECT locked FROM forum_topics WHERE content_id=$1 FOR UPDATE', [cid])
        )[0];
        if (topic?.locked && !(await canManage(tx, req.user, cid)))
          fail(403, '此话题已锁定，暂时不能回复');
        const fileIds = [
          ...new Set([
            ...p.attachments,
            ...Array.from(p.body.matchAll(/\/api\/files\/([0-9a-f-]{36})/g), (m) => m[1]),
          ]),
        ];
        if (!p.body && !fileIds.length) fail(400, '请填写评论或添加图片、附件');
        if (fileIds.length > 10) fail(400, '每条评论最多添加 10 个文件');
        for (const fid of [...fileIds].sort()) {
          const file = (
            await tx.query(
              "SELECT * FROM attachments WHERE id=$1 AND content_id=$2 AND owner_id=$3 AND purpose='comment' AND NOT deleted FOR UPDATE",
              [fid, cid, req.user.id],
            )
          )[0];
          if (!file) fail(400, '评论附件必须是你在当前内容下上传的文件');
          if (file.scan_status === 'blocked') fail(400, '附件已被隔离，请移除后重试');
          if (
            (await tx.query('SELECT 1 FROM comment_attachments WHERE attachment_id=$1', [fid]))
              .length
          )
            fail(409, '附件已经提交，请重新上传');
        }
        await tx.query(
          'INSERT INTO comments(id,content_id,author_id,parent_id,body,digest) VALUES($1,$2,$3,$4,$5,$6)',
          [commentId, cid, req.user.id, p.parentId || null, p.body, digest],
        );
        for (const fid of fileIds)
          await tx.query(
            'INSERT INTO comment_attachments(comment_id,attachment_id) VALUES($1,$2)',
            [commentId, fid],
          );
        return enqueue(tx, null, commentId, digest);
      });
      return reply.code(201).send({ id: commentId, status });
    },
  );
  app.delete('/api/comments/:id', async (req) => {
    const cm = (
      await db.query('SELECT * FROM comments WHERE id=$1', [
        identifier.parse((req.params as any).id),
      ])
    )[0];
    if (!cm) fail(404, '评论不存在');
    await getContent(db, req.user, cm.content_id);
    if (cm.author_id !== req.user.id && !(await canManage(db, req.user, cm.content_id)))
      fail(403, '无权处理该评论');
    await db.transaction(async (tx) => {
      await tx.query("UPDATE comments SET status='deleted' WHERE id=$1", [cm.id]);
      await tx.query(
        'UPDATE forum_topics SET accepted_comment_id=NULL,resolved=false WHERE accepted_comment_id=$1',
        [cm.id],
      );
      await audit(tx, req.user.id, 'comment.remove', cm.id);
      await syncContentHonors(tx, cm.content_id, req.user.id);
    });
    return { ok: true };
  });
  app.post(
    '/api/contents/:id/reports',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const cid = identifier.parse((req.params as any).id);
      await getContent(db, req.user, cid, 'published');
      const p = z
        .object({
          reason: z.string().trim().min(5).max(2000),
          commentId: identifier.nullable().optional(),
        })
        .parse(req.body);
      if (
        p.commentId &&
        !(
          await db.query(
            "SELECT id FROM comments WHERE id=$1 AND content_id=$2 AND status='approved'",
            [p.commentId, cid],
          )
        ).length
      )
        fail(400, '评论不存在');
      await db.query(
        'INSERT INTO reports(id,content_id,comment_id,reporter_id,reason) VALUES($1,$2,$3,$4,$5)',
        [id(), cid, p.commentId || null, req.user.id, p.reason],
      );
      return { ok: true };
    },
  );
}
