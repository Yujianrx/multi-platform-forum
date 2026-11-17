import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  type AppContext,
  id,
  token,
  hash,
  fail,
  identifier,
  admin,
  staff,
  audit,
  notify,
  pageQuery,
  siteSettings,
  userFields,
  safeUrl,
  passwordHash,
} from './core.js';
import {
  manageSQL,
  getContent,
  revisionManageSQL,
  moderationJobScope as jobScope,
} from './permissions.js';
import { manualReview } from './moderation.js';
import { revokeUserApiKeys } from './api-keys.js';
import { HttpError } from './core.js';
import { syncContentHonors } from './honors-engine.js';
const reviewInput = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().max(2000).default(''),
  confirmContribution: z.boolean().default(false),
});
const validReviewReason = (p: { decision: string; reason: string }) =>
  p.decision === 'approved' || p.reason.length >= 5;
export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  app.get('/api/admin/overview', async (req) => {
    staff(req);
    const counts = (
      await db.query(
        `SELECT count(*)::int contents,count(*) FILTER(WHERE c.state='published')::int published,(SELECT count(*)::int FROM moderation_jobs j LEFT JOIN revisions r ON r.id=j.revision_id LEFT JOIN comments cm ON cm.id=j.comment_id JOIN contents c ON c.id=COALESCE(r.content_id,cm.content_id) WHERE j.status IN ('pending','running','review','failed') AND ${jobScope()}) pending FROM contents c WHERE ${manageSQL()}`,
        [req.user.id],
      )
    )[0];
    if (req.user.role === 'admin')
      Object.assign(
        counts,
        (
          await db.query(
            'SELECT (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) users,(SELECT count(*)::int FROM likes WHERE active) likes,(SELECT count(*)::int FROM download_events WHERE counted) downloads,(SELECT COALESCE(sum(size),0)::float FROM attachments WHERE NOT deleted) storage',
          )
        )[0],
      );
    return {
      ...counts,
      provider: ctx.provider,
      production: ctx.production,
      scanner: ctx.clamHost ? 'configured' : 'not-configured',
    };
  });
  app.get('/api/admin/users', async (req) => {
    admin(req);
    const { page, limit } = pageQuery(req.query);
    return {
      items: await db.query(
        `SELECT ${userFields
          .split(',')
          .map((f) => 'u.' + f)
          .join(
            ',',
          )},d.name department,(SELECT jsonb_agg(jsonb_build_object('departmentId',s.department_id,'categoryId',s.category_id)) FROM moderator_scopes s WHERE s.user_id=u.id) scopes FROM users u LEFT JOIN departments d ON u.department_id=d.id WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit],
      ),
      total: (await db.query('SELECT count(*)::int total FROM users WHERE deleted_at IS NULL'))[0]
        .total,
    };
  });
  app.patch('/api/admin/users/:id', async (req) => {
    admin(req);
    const uid = identifier.parse((req.params as any).id);
    const p = z
      .object({
        departmentId: identifier.nullable(),
        role: z.enum(['member', 'moderator', 'admin']),
        active: z.boolean(),
        moderationExempt: z.boolean().optional(),
        scopes: z
          .array(
            z
              .object({ departmentId: identifier.nullable(), categoryId: identifier.nullable() })
              .refine((s) => s.departmentId || s.categoryId, '授权至少包含一个范围'),
          )
          .max(50)
          .default([]),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      const admins = await tx.query(
        "SELECT id FROM users WHERE role='admin' AND active ORDER BY id FOR UPDATE",
      );
      const u = (await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [uid]))[0];
      if (!u || u.deleted_at) fail(404, '用户不存在或已删除');
      if (u.role === 'admin' && u.active && (p.role !== 'admin' || !p.active) && admins.length <= 1)
        fail(400, '必须保留至少一个有效管理员');
      if (uid === req.user.id && !p.active) fail(400, '不能停用当前账号');
      await tx.query('UPDATE users SET department_id=$1,role=$2,active=$3 WHERE id=$4', [
        p.departmentId,
        p.role,
        p.active,
        uid,
      ]);
      if (p.moderationExempt !== undefined) {
        await tx.query('UPDATE users SET moderation_exempt=$1 WHERE id=$2', [
          p.moderationExempt,
          uid,
        ]);
        if (u.moderation_exempt !== p.moderationExempt)
          await audit(tx, req.user.id, 'user.moderation-exemption', uid, {
            previous: u.moderation_exempt,
            enabled: p.moderationExempt,
          });
      }
      await tx.query('DELETE FROM moderator_scopes WHERE user_id=$1', [uid]);
      if (p.role === 'moderator')
        for (const s of p.scopes)
          await tx.query(
            'INSERT INTO moderator_scopes(id,user_id,department_id,category_id) VALUES($1,$2,$3,$4)',
            [id(), uid, s.departmentId, s.categoryId],
          );
      if (!p.active || u.role !== p.role)
        await tx.query('DELETE FROM sessions WHERE user_id=$1', [uid]);
      if (!p.active) await revokeUserApiKeys(tx, uid);
      await audit(tx, req.user.id, 'user.update', uid, p);
    });
    return { ok: true };
  });
  app.post('/api/admin/users/:id/reset', async (req) => {
    admin(req);
    const uid = identifier.parse((req.params as any).id),
      raw = token(),
      invalidPassword = await passwordHash(token());
    await db.transaction(async (tx) => {
      if (!(await tx.query('SELECT id FROM users WHERE id=$1 AND active FOR UPDATE', [uid])).length)
        fail(404, '有效账号不存在');
      await tx.query('DELETE FROM password_resets WHERE user_id=$1', [uid]);
      await tx.query(
        "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
        [hash(raw), uid],
      );
      await tx.query('UPDATE users SET password_hash=$1,must_reset=true WHERE id=$2', [
        invalidPassword,
        uid,
      ]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [uid]);
      await audit(tx, req.user.id, 'user.reset', uid);
      await revokeUserApiKeys(tx, uid);
    });
    return { token: raw, expiresInMinutes: 30 };
  });
  app.delete('/api/admin/users/:id', async (req) => {
    admin(req);
    const uid = identifier.parse((req.params as any).id),
      p = z
        .object({ username: z.string().trim().min(1).max(40) })
        .strict()
        .parse(req.body);
    if (uid === req.user.id) fail(400, '不能删除当前登录账号');
    const invalidPassword = await passwordHash(token());
    await db.transaction(async (tx) => {
      const admins = await tx.query(
        "SELECT id FROM users WHERE role='admin' AND active ORDER BY id FOR UPDATE",
      );
      if (!admins.some((a) => a.id === req.user.id)) fail(403, '当前管理员权限已失效');
      const u = (await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [uid]))[0];
      if (!u) fail(404, '成员不存在');
      if (u.username !== p.username) fail(409, '账号不匹配，请核对要删除的成员');
      if (u.deleted_at) return;
      if (u.role === 'admin' && u.active && admins.length <= 1)
        fail(400, '必须保留至少一个有效管理员');
      await tx.query(
        "UPDATE users SET deleted_at=now(),deleted_by=$2,active=false,moderation_exempt=false,name='已删除成员',bio='',avatar_version=NULL,password_hash=$3,must_reset=true WHERE id=$1",
        [uid, req.user.id, invalidPassword],
      );
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [uid]);
      await revokeUserApiKeys(tx, uid);
      await tx.query('DELETE FROM password_resets WHERE user_id=$1', [uid]);
      await tx.query('DELETE FROM moderator_scopes WHERE user_id=$1', [uid]);
      await tx.query('DELETE FROM user_avatars WHERE user_id=$1', [uid]);
      await audit(tx, req.user.id, 'user.delete', uid, {
        username: u.username,
        name: u.name,
        role: u.role,
        history: 'preserved',
      });
    });
    return { ok: true };
  });
  app.get('/api/admin/invitations', async (req) => {
    admin(req);
    const { page, limit } = pageQuery(req.query);
    return {
      items: await db.query(
        'SELECT i.id,i.label,i.department_id,d.name department,i.max_uses,i.used_count,i.expires_at,i.revoked,i.created_at FROM invitations i LEFT JOIN departments d ON d.id=i.department_id ORDER BY i.created_at DESC LIMIT $1 OFFSET $2',
        [limit, (page - 1) * limit],
      ),
      total: (await db.query('SELECT count(*)::int total FROM invitations'))[0].total,
    };
  });
  app.post('/api/admin/invitations', async (req) => {
    admin(req);
    const p = z
      .object({
        label: z.string().trim().min(1).max(80),
        departmentId: identifier.nullable(),
        maxUses: z.number().int().min(1).max(10000),
        expiresAt: z.iso.datetime(),
      })
      .parse(req.body);
    if (new Date(p.expiresAt) <= new Date()) fail(400, '有效期必须晚于当前时间');
    const raw = token(),
      iid = id();
    await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO invitations(id,code_hash,label,department_id,max_uses,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [iid, hash(raw), p.label, p.departmentId, p.maxUses, p.expiresAt, req.user.id],
      );
      await audit(tx, req.user.id, 'invitation.create', iid, { ...p });
    });
    return { id: iid, code: raw };
  });
  app.post('/api/admin/invitations/:id/revoke', async (req) => {
    admin(req);
    const iid = identifier.parse((req.params as any).id);
    await db.transaction(async (tx) => {
      await tx.query('UPDATE invitations SET revoked=true WHERE id=$1', [iid]);
      await audit(tx, req.user.id, 'invitation.revoke', iid);
    });
    return { ok: true };
  });
  app.get('/api/admin/invitations/:id/uses', async (req) => {
    admin(req);
    return {
      items: await db.query(
        'SELECT u.id,u.name,u.username,iu.used_at FROM invitation_uses iu JOIN users u ON u.id=iu.user_id WHERE iu.invitation_id=$1 ORDER BY iu.used_at DESC LIMIT 200',
        [identifier.parse((req.params as any).id)],
      ),
    };
  });
  const taxTables = {
    departments: 'departments',
    categories: 'categories',
    tags: 'tags',
    tools: 'tool_names',
  };
  app.post('/api/admin/taxonomy/:kind', async (req) => {
    admin(req);
    const table =
        taxTables[
          z.enum(['departments', 'categories', 'tags', 'tools']).parse((req.params as any).kind)
        ],
      p = z
        .object({ name: z.string().trim().min(1).max(50) })
        .strict()
        .parse(req.body),
      tid = id();
    await db.transaction(async (tx) => {
      await tx.query(`INSERT INTO ${table}(id,name) VALUES($1,$2)`, [tid, p.name]);
      await audit(tx, req.user.id, table + '.create', tid, p);
    });
    return { id: tid };
  });
  app.patch('/api/admin/taxonomy/:kind/:id', async (req) => {
    admin(req);
    const kind = z
        .enum(['departments', 'categories', 'tags', 'tools'])
        .parse((req.params as any).kind),
      table = taxTables[kind],
      tid = identifier.parse((req.params as any).id),
      p = z.object({ name: z.string().trim().min(1).max(50) }).parse(req.body);
    if (kind === 'tags') fail(400, '历史标签使用原名称，请新建标签代替重命名');
    await db.transaction(async (tx) => {
      await tx.query(`UPDATE ${table} SET name=$1 WHERE id=$2`, [p.name, tid]);
      await audit(tx, req.user.id, table + '.rename', tid, p);
    });
    return { ok: true };
  });
  app.delete('/api/admin/taxonomy/:kind/:id', async (req) => {
    admin(req);
    const table =
        taxTables[
          z.enum(['departments', 'categories', 'tags', 'tools']).parse((req.params as any).kind)
        ],
      tid = identifier.parse((req.params as any).id);
    await db.transaction(async (tx) => {
      await tx.query(`DELETE FROM ${table} WHERE id=$1`, [tid]);
      await audit(tx, req.user.id, table + '.delete', tid);
    });
    return { ok: true };
  });
  app.get('/api/admin/contents', async (req) => {
    staff(req);
    const { page, limit } = pageQuery(req.query),
      q = z
        .object({
          state: z.enum(['draft', 'published', 'withdrawn', 'deleted']).optional(),
          type: z.enum(['experience', 'project', 'skill', 'prompt', 'discussion']).optional(),
          q: z.string().max(100).default(''),
        })
        .parse(req.query);
    const params: any[] = [req.user.id];
    let where = manageSQL();
    if (q.state) {
      params.push(q.state);
      where += ` AND c.state=$${params.length}`;
    }
    if (q.type) {
      params.push(q.type);
      where += ` AND c.type=$${params.length}`;
    }
    if (q.q) {
      params.push('%' + q.q.replace(/[\\%_]/g, '\\$&') + '%');
      where += ` AND r.data->>'title' ILIKE $${params.length}`;
    }
    const from = `FROM contents c LEFT JOIN revisions r ON r.id=c.latest_revision_id AND (${revisionManageSQL()}) JOIN users u ON u.id=c.author_id WHERE ${where}`;
    const total = (await db.query(`SELECT count(*)::int total ${from}`, params))[0].total;
    params.push(limit, (page - 1) * limit);
    return {
      items: await db.query(
        `SELECT c.*,r.data->>'title' title,r.status,u.name author ${from} ORDER BY c.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      ),
      total,
    };
  });
  app.patch('/api/admin/contents/:id', async (req) => {
    staff(req);
    const cid = identifier.parse((req.params as any).id);
    await getContent(db, req.user, cid, 'manage');
    const p = z.object({ featured: z.boolean(), pinned: z.boolean() }).strict().parse(req.body);
    await db.transaction(async (tx) => {
      await tx.query('UPDATE contents SET featured=$1,pinned=$2 WHERE id=$3', [
        p.featured,
        p.pinned,
        cid,
      ]);
      await audit(tx, req.user.id, 'content.promote', cid, p);
    });
    return { ok: true };
  });
  app.get('/api/admin/moderation', async (req) => {
    staff(req);
    const { page, limit } = pageQuery(req.query);
    const status = z
      .enum(['open', 'done'])
      .default('open')
      .parse((req.query as any).status);
    const from = `FROM moderation_jobs j LEFT JOIN revisions r ON r.id=j.revision_id LEFT JOIN comments cm ON cm.id=j.comment_id JOIN contents c ON c.id=COALESCE(r.content_id,cm.content_id) WHERE ${jobScope()} AND j.status ${status === 'done' ? "='done'" : "<>'done'"}`;
    return {
      items: await db.query(
        `SELECT j.*,c.id content_id,c.type,r.data,r.status revision_status,cm.body comment_body,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'original_name',a.original_name,'kind',a.kind,'mime',a.mime,'size',a.size,'scan_status',a.scan_status,'scan_reason',a.scan_reason,'deleted',a.deleted) ORDER BY a.created_at,a.id) FROM (SELECT attachment_id FROM revision_attachments WHERE revision_id=j.revision_id UNION SELECT attachment_id FROM comment_attachments WHERE comment_id=j.comment_id) bound JOIN attachments a ON a.id=bound.attachment_id),'[]'::jsonb) files ${from} ORDER BY j.created_at DESC LIMIT $2 OFFSET $3`,
        [req.user.id, limit, (page - 1) * limit],
      ),
      total: (await db.query(`SELECT count(*)::int total ${from}`, [req.user.id]))[0].total,
    };
  });
  app.get('/api/admin/moderation/:id/records', async (req) => {
    staff(req);
    const jid = identifier.parse((req.params as any).id);
    const rows = await db.query(
      `SELECT j.id FROM moderation_jobs j LEFT JOIN revisions r ON r.id=j.revision_id LEFT JOIN comments cm ON cm.id=j.comment_id JOIN contents c ON c.id=COALESCE(r.content_id,cm.content_id) WHERE j.id=$2 AND ${jobScope()}`,
      [req.user.id, jid],
    );
    if (!rows.length) fail(404, '审核不存在');
    return {
      items: await db.query(
        'SELECT * FROM moderation_records WHERE job_id=$1 ORDER BY created_at DESC',
        [jid],
      ),
    };
  });
  app.post('/api/admin/moderation/:id/review', async (req) => {
    staff(req);
    const jid = identifier.parse((req.params as any).id),
      p = reviewInput.refine(validReviewReason, '请填写至少 5 个字的退回原因').parse(req.body);
    const result = await manualReview(
      ctx,
      req.user,
      jid,
      p.decision,
      p.reason,
      p.confirmContribution,
    );
    return { ok: true, ...result };
  });
  app.post('/api/admin/moderation/batch-review', async (req) => {
    staff(req);
    const p = reviewInput
      .extend({
        jobIds: z
          .array(identifier)
          .min(1)
          .max(50)
          .refine((ids) => new Set(ids).size === ids.length, '不能重复选择同一任务'),
      })
      .strict()
      .refine(validReviewReason, '请填写至少 5 个字的退回原因')
      .parse(req.body);
    const results = [];
    for (const jobId of p.jobIds) {
      try {
        const result = await manualReview(
          ctx,
          req.user,
          jobId,
          p.decision,
          p.reason,
          p.confirmContribution,
        );
        results.push({ id: jobId, ok: true, ...result });
      } catch (error) {
        if (!(error instanceof HttpError))
          req.log.error({ err: error, jobId }, 'Batch review item failed');
        results.push({
          id: jobId,
          ok: false,
          statusCode: error instanceof HttpError ? error.statusCode : 500,
          error: error instanceof HttpError ? error.message : '处理失败，请稍后重试',
        });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { results, succeeded, failed: results.length - succeeded };
  });
  app.post('/api/admin/moderation/:id/retry', async (req) => {
    staff(req);
    const jid = identifier.parse((req.params as any).id);
    const job = (
      await db.query(
        `SELECT j.* FROM moderation_jobs j LEFT JOIN revisions r ON r.id=j.revision_id LEFT JOIN comments cm ON cm.id=j.comment_id JOIN contents c ON c.id=COALESCE(r.content_id,cm.content_id) WHERE j.id=$2 AND ${jobScope()}`,
        [req.user.id, jid],
      )
    )[0];
    if (!job) fail(404, '任务不存在');
    if (!['failed', 'review', 'pending'].includes(job.status)) fail(409, '只能重试未完成任务');
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE moderation_jobs SET status='pending',attempts=0,available_at=now(),locked_until=NULL WHERE id=$1",
        [jid],
      );
      await audit(tx, req.user.id, 'moderation.retry', jid);
    });
    return { ok: true };
  });
  app.get('/api/admin/rules', async (req) => {
    admin(req);
    return { items: await db.query('SELECT * FROM moderation_rules ORDER BY name') };
  });
  app.post('/api/admin/rules', async (req) => {
    admin(req);
    const p = z
        .object({
          name: z.string().min(2).max(100),
          phrase: z
            .string()
            .trim()
            .min(2)
            .max(200)
            .refine(
              (s) => s.replace(/[\s\p{P}\p{S}\p{Cf}]/gu, '').length >= 2,
              '请填写至少两个有效字符',
            ),
          reason: z.string().min(10).max(1000),
          enabled: z.boolean().default(true),
          action: z.enum(['review', 'reject']).default('review'),
        })
        .parse(req.body),
      rid = id();
    await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO moderation_rules(id,name,phrase,reason,enabled,action) VALUES($1,$2,$3,$4,$5,$6)',
        [rid, p.name, p.phrase, p.reason, p.enabled, p.action],
      );
      await audit(tx, req.user.id, 'rule.create', rid, p);
    });
    return { id: rid };
  });
  app.delete('/api/admin/rules/:id', async (req) => {
    admin(req);
    const rid = identifier.parse((req.params as any).id);
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM moderation_rules WHERE id=$1', [rid]);
      await audit(tx, req.user.id, 'rule.delete', rid);
    });
    return { ok: true };
  });
  app.get('/api/admin/reports', async (req) => {
    staff(req);
    const { page, limit } = pageQuery(req.query);
    const from = `FROM reports rp JOIN contents c ON c.id=rp.content_id WHERE ${manageSQL()}`;
    return {
      items: await db.query(`SELECT rp.* ${from} ORDER BY rp.created_at DESC LIMIT $2 OFFSET $3`, [
        req.user.id,
        limit,
        (page - 1) * limit,
      ]),
      total: (await db.query(`SELECT count(*)::int total ${from}`, [req.user.id]))[0].total,
    };
  });
  app.patch('/api/admin/reports/:id', async (req) => {
    staff(req);
    const rid = identifier.parse((req.params as any).id),
      p = z.object({ resolution: z.string().min(5).max(2000) }).parse(req.body);
    const report = (
      await db.query(
        `SELECT rp.* FROM reports rp JOIN contents c ON c.id=rp.content_id WHERE rp.id=$2 AND ${manageSQL()}`,
        [req.user.id, rid],
      )
    )[0];
    if (!report) fail(404, '举报不存在');
    await db.transaction(async (tx) => {
      await tx.query("UPDATE reports SET status='resolved',resolution=$1 WHERE id=$2", [
        p.resolution,
        rid,
      ]);
      await audit(tx, req.user.id, 'report.resolve', rid, p);
      await notify(
        tx,
        report.reporter_id,
        report.content_id,
        'report',
        '举报已处理：' + p.resolution,
      );
    });
    return { ok: true };
  });
  app.get('/api/admin/comments', async (req) => {
    staff(req);
    const { page, limit } = pageQuery(req.query);
    const from = `FROM comments cm JOIN contents c ON c.id=cm.content_id JOIN users u ON u.id=cm.author_id WHERE ${manageSQL()}`;
    return {
      items: await db.query(
        `SELECT cm.*,u.name author ${from} ORDER BY cm.created_at DESC LIMIT $2 OFFSET $3`,
        [req.user.id, limit, (page - 1) * limit],
      ),
      total: (await db.query(`SELECT count(*)::int total ${from}`, [req.user.id]))[0].total,
    };
  });
  app.get('/api/admin/files', async (req) => {
    admin(req);
    const { page, limit } = pageQuery(req.query);
    return {
      items: await db.query(
        'SELECT a.id,a.content_id,a.original_name,a.size,a.kind,a.mime,a.scan_status,a.scan_reason,a.created_at,u.name owner FROM attachments a JOIN users u ON u.id=a.owner_id WHERE NOT a.deleted ORDER BY a.created_at DESC LIMIT $1 OFFSET $2',
        [limit, (page - 1) * limit],
      ),
      total: (await db.query('SELECT count(*)::int total FROM attachments WHERE NOT deleted'))[0]
        .total,
    };
  });
  app.post('/api/admin/files/:id/review', async (req) => {
    admin(req);
    const fid = identifier.parse((req.params as any).id),
      p = z
        .object({
          decision: z.enum(['clean', 'blocked']),
          reason: z.string().trim().max(1000).default(''),
        })
        .refine(
          (p) => p.decision === 'clean' || p.reason.length >= 10,
          '请填写至少 10 个字的阻止原因',
        )
        .parse(req.body);
    await db.transaction(async (tx) => {
      const f = (
        await tx.query('SELECT * FROM attachments WHERE id=$1 AND NOT deleted FOR UPDATE', [fid])
      )[0];
      if (!f) fail(404, '文件不存在');
      if (f.scan_status === 'blocked' && p.decision === 'clean')
        fail(409, '已阻止的文件不能解除，请重新上传安全版本');
      await tx.query('UPDATE attachments SET scan_status=$1,scan_reason=$2 WHERE id=$3', [
        p.decision,
        p.reason ? '人工审核：' + p.reason : '人工审核通过',
        fid,
      ]);
      await audit(tx, req.user.id, 'file.review', fid, p);
      await syncContentHonors(tx, f.content_id, req.user.id);
    });
    return { ok: true };
  });
  app.get('/api/admin/settings', async (req) => {
    admin(req);
    return siteSettings(db);
  });
  app.put('/api/admin/settings', async (req) => {
    admin(req);
    const p = z
      .object({
        name: z.string().min(1).max(40),
        description: z.string().max(200),
        logo: z.string().max(8),
        imageMaxMB: z.number().int().min(1).max(10),
        resourceMaxMB: z.number().int().min(1).max(100),
        quotaMB: z.number().int().min(10).max(102400),
        allowedTypes: z
          .array(
            z.enum([
              'png',
              'jpg',
              'jpeg',
              'webp',
              'gif',
              'txt',
              'md',
              'json',
              'csv',
              'zip',
              'pdf',
              'docx',
              'xlsx',
              'pptx',
            ]),
          )
          .min(1),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      await tx.query("UPDATE settings SET value=$1 WHERE key='site'", [JSON.stringify(p)]);
      await audit(tx, req.user.id, 'settings.update', 'site', p);
    });
    return p;
  });
  app.get('/api/admin/banners', async (req) => {
    admin(req);
    return { items: await db.query('SELECT * FROM banners ORDER BY position') };
  });
  app.post('/api/admin/banners', async (req) => {
    admin(req);
    const p = z
      .object({
        contentId: identifier.nullable(),
        title: z.string().min(1).max(100),
        description: z.string().max(300).default(''),
        externalUrl: safeUrl.default(''),
        imageId: identifier.nullable().default(null),
        position: z.number().int().default(0),
        enabled: z.boolean().default(true),
        startsAt: z.iso.datetime().nullable().default(null),
        endsAt: z.iso.datetime().nullable().default(null),
      })
      .refine((v) => v.contentId || v.externalUrl, '需要内容或外部链接')
      .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, '结束时间须晚于开始时间')
      .parse(req.body);
    if (
      p.imageId &&
      (!p.contentId ||
        !(
          await db.query(
            "SELECT id FROM attachments WHERE id=$1 AND content_id=$2 AND kind='image' AND NOT deleted",
            [p.imageId, p.contentId],
          )
        ).length)
    )
      fail(400, '轮播图片必须属于目标内容');
    const bid = id();
    await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO banners(id,content_id,title,description,external_url,image_id,position,enabled,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          bid,
          p.contentId,
          p.title,
          p.description,
          p.externalUrl || null,
          p.imageId,
          p.position,
          p.enabled,
          p.startsAt,
          p.endsAt,
        ],
      );
      await audit(tx, req.user.id, 'banner.create', bid, p);
    });
    return { id: bid };
  });
  app.patch('/api/admin/banners/:id', async (req) => {
    admin(req);
    const bid = identifier.parse((req.params as any).id);
    const old = (await db.query('SELECT * FROM banners WHERE id=$1', [bid]))[0];
    if (!old) fail(404, '轮播不存在');
    const p = z
      .object({
        contentId: identifier.nullable(),
        title: z.string().min(1).max(100),
        description: z.string().max(300),
        externalUrl: safeUrl,
        imageId: identifier.nullable(),
        position: z.number().int(),
        enabled: z.boolean(),
        startsAt: z.iso.datetime().nullable(),
        endsAt: z.iso.datetime().nullable(),
      })
      .strict()
      .refine((v) => v.contentId || v.externalUrl, '需要内容或外部链接')
      .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, '结束时间须晚于开始时间')
      .parse({
        contentId: old.content_id,
        title: old.title,
        description: old.description,
        externalUrl: old.external_url || '',
        imageId: old.image_id,
        position: old.position,
        enabled: old.enabled,
        startsAt: old.starts_at ? new Date(old.starts_at).toISOString() : null,
        endsAt: old.ends_at ? new Date(old.ends_at).toISOString() : null,
        ...z.record(z.string(), z.unknown()).parse(req.body),
      });
    if (
      p.imageId &&
      (!p.contentId ||
        !(
          await db.query(
            "SELECT id FROM attachments WHERE id=$1 AND content_id=$2 AND kind='image' AND NOT deleted",
            [p.imageId, p.contentId],
          )
        ).length)
    )
      fail(400, '轮播图片必须属于目标内容');
    await db.transaction(async (tx) => {
      await tx.query(
        'UPDATE banners SET content_id=$1,title=$2,description=$3,external_url=$4,image_id=$5,position=$6,enabled=$7,starts_at=$8,ends_at=$9 WHERE id=$10',
        [
          p.contentId,
          p.title,
          p.description,
          p.externalUrl || null,
          p.imageId,
          p.position,
          p.enabled,
          p.startsAt,
          p.endsAt,
          bid,
        ],
      );
      await audit(tx, req.user.id, 'banner.update', bid, p);
    });
    return { ok: true };
  });
  app.delete('/api/admin/banners/:id', async (req) => {
    admin(req);
    const bid = identifier.parse((req.params as any).id);
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM banners WHERE id=$1', [bid]);
      await audit(tx, req.user.id, 'banner.delete', bid);
    });
    return { ok: true };
  });
  app.get('/api/admin/audit', async (req) => {
    admin(req);
    const { page, limit } = pageQuery(req.query);
    return {
      items: await db.query(
        'SELECT a.*,u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT $1 OFFSET $2',
        [limit, (page - 1) * limit],
      ),
      total: (await db.query('SELECT count(*)::int total FROM audit_logs'))[0].total,
    };
  });
  app.post('/api/admin/announcement', async (req) => {
    admin(req);
    const p = z.object({ message: z.string().trim().min(1).max(1000) }).parse(req.body);
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO notifications(id,user_id,kind,message) SELECT gen_random_uuid()::text,id,'announcement',$1 FROM users WHERE active",
        [p.message],
      );
      await audit(tx, req.user.id, 'announcement.create', 'all', { message: p.message });
    });
    return { ok: true };
  });
}
