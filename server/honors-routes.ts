import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  type AppContext,
  id,
  identifier,
  admin,
  staff,
  fail,
  audit,
  pageQuery,
  notify,
} from './core.js';
import { getContent, manageSQL, readSQL, revisionManageSQL } from './permissions.js';
import {
  honorSummaries,
  honorBoard,
  settleHonorWeeks,
  assessContribution,
  lockHonors,
  verifyContributionFiles,
  syncContentHonors,
} from './honors-engine.js';
import { honorWeek, validWeek } from './honors-policy.js';
const assessment = z
  .object({
    decision: z.enum(['confirmed', 'rejected']),
    reason: z.string().trim().min(5).max(1000),
    revisionId: identifier.nullable(),
    verified: z.boolean().default(false),
  })
  .strict();
export async function honorsRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  app.get('/api/admin/honors/members', async (req) => {
    admin(req);
    const q = z
      .string()
      .max(120)
      .default('')
      .parse((req.query as any).q);
    return {
      items: await db.query(
        'SELECT id,name,username FROM users WHERE active AND (name ILIKE $1 OR username ILIKE $1) ORDER BY name,id LIMIT 30',
        ['%' + q + '%'],
      ),
    };
  });
  app.get('/api/admin/honors/evidence', async (req) => {
    admin(req);
    const uid = identifier.parse((req.query as any).userId);
    return {
      items: await db.query(
        "SELECT g.id,g.category,r.data->>'title' title FROM contributions g JOIN contents c ON c.id=g.content_id JOIN revisions r ON r.id=c.published_revision_id WHERE g.user_id=$1 AND g.valid ORDER BY g.first_valid_at DESC LIMIT 200",
        [uid],
      ),
    };
  });
  app.get(
    '/api/honors/rules',
    async () => (await db.query("SELECT value FROM settings WHERE key='honors'"))[0].value,
  );
  app.get('/api/honors/board', async (req) => {
    const q = z
      .object({
        week: z.string().refine(validWeek).default(honorWeek()),
        board: z.enum(['all', 'case', 'resource', 'answer']).default('all'),
        version: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    if (q.week > honorWeek()) fail(400, '不能查看未来周榜');
    await db.transaction((tx) => settleHonorWeeks(tx));
    const board = await honorBoard(db, q.week, q.board, q.version),
      { page, limit } = pageQuery(req.query);
    const periods = await db.query(
      'SELECT week_start::text AS week, max(version)::int version FROM leaderboard_periods GROUP BY week_start ORDER BY week_start DESC',
    );
    const versions = await db.query(
      'SELECT version,reason,created_at FROM leaderboard_periods WHERE week_start=$1 ORDER BY version DESC',
      [q.week],
    );
    return {
      ...board,
      items: board.items.slice((page - 1) * limit, page * limit),
      total: board.items.length,
      myRank: board.items.find((r) => r.user_id === req.user.id) || null,
      periods,
      versions,
    };
  });
  app.get('/api/honors/users/:id', async (req) => {
    const uid = identifier.parse((req.params as any).id);
    if (!(await db.query('SELECT id FROM users WHERE id=$1', [uid])).length)
      fail(404, '成员不存在');
    const summary = (await honorSummaries(db, [uid]))[uid];
    const definitions = await db.query('SELECT * FROM badge_definitions ORDER BY position');
    return { ...summary, definitions };
  });
  app.get('/api/honors/me', async (req) => {
    const summary = (await honorSummaries(db, [req.user.id]))[req.user.id];
    const weeks = await db.query(
      'SELECT category,counted,points FROM weekly_contribution_buckets WHERE user_id=$1 AND week_start=$2',
      [req.user.id, honorWeek()],
    );
    const definitions = await db.query('SELECT * FROM badge_definitions ORDER BY position');
    const history = await db.query(
      'SELECT a.*,d.name,d.mode,d.image FROM badge_awards a JOIN badge_definitions d ON d.id=a.badge_id WHERE a.user_id=$1 ORDER BY a.awarded_at DESC LIMIT 100',
      [req.user.id],
    );
    return {
      ...summary,
      week: honorWeek(),
      weeks,
      definitions,
      history: history.map(({ evidence, ...r }) => r),
    };
  });
  app.get('/api/honors/ledger', async (req) => {
    const q = z
        .object({
          category: z.enum(['case', 'resource', 'answer']).optional(),
          kind: z.enum(['grant', 'revoke']).optional(),
        })
        .parse(req.query),
      { page, limit } = pageQuery(req.query);
    const from =
      'FROM points_ledger l JOIN contributions g ON g.id=l.contribution_id JOIN contents c ON c.id=g.content_id LEFT JOIN revisions r ON r.id=c.published_revision_id';
    const where =
      "l.user_id=$1 AND ($2::text IS NULL OR l.category=$2) AND ($3::text IS NULL OR ($3='grant' AND l.delta>0) OR ($3='revoke' AND l.delta<0))";
    const items = await db.query(
      `SELECT l.*,l.week_start::text week,CASE WHEN ${readSQL('c', '$1')} THEN c.id ELSE NULL END content_id,CASE WHEN ${readSQL('c', '$1')} THEN r.data->>'title' ELSE NULL END title ${from} WHERE ${where} ORDER BY l.created_at DESC,l.id LIMIT $4 OFFSET $5`,
      [req.user.id, q.category || null, q.kind || null, limit, (page - 1) * limit],
    );
    const total = (
      await db.query(`SELECT count(*)::int n ${from} WHERE ${where}`, [
        req.user.id,
        q.category || null,
        q.kind || null,
      ])
    )[0].n;
    return { items, total };
  });
  app.get('/api/honors/contributions', async (req) => {
    const { page, limit } = pageQuery(req.query);
    return {
      items: await db.query(
        `SELECT g.id,g.category,g.qualification,g.valid,g.reason,g.points,g.week_start::text week,g.first_valid_at,g.created_at,CASE WHEN ${readSQL()} THEN c.id ELSE NULL END content_id,CASE WHEN ${readSQL()} THEN r.data->>'title' ELSE NULL END title FROM contributions g JOIN contents c ON c.id=g.content_id LEFT JOIN revisions r ON r.id=c.published_revision_id WHERE g.user_id=$1 ORDER BY g.created_at DESC,g.id LIMIT $2 OFFSET $3`,
        [req.user.id, limit, (page - 1) * limit],
      ),
      total: (
        await db.query('SELECT count(*)::int n FROM contributions WHERE user_id=$1', [req.user.id])
      )[0].n,
    };
  });
  app.get('/api/admin/honors/contributions', async (req) => {
    staff(req);
    const q = z
        .object({
          status: z.enum(['all', 'pending', 'confirmed', 'rejected']).default('pending'),
          q: z.string().max(120).default(''),
        })
        .parse(req.query),
      { page, limit } = pageQuery(req.query);
    const from = `FROM contributions g JOIN contents c ON c.id=g.content_id JOIN users u ON u.id=g.user_id LEFT JOIN revisions r ON r.id=g.revision_id LEFT JOIN comments cm ON cm.id=g.comment_id WHERE ${manageSQL()} AND (g.revision_id IS NULL OR ${revisionManageSQL()}) AND ($2='all' OR g.qualification=$2) AND (u.name ILIKE $3 OR u.username ILIKE $3 OR COALESCE(r.data->>'title','') ILIKE $3)`;
    return {
      items: await db.query(
        `SELECT g.*,g.week_start::text week,u.name,u.username,r.data,cm.body,CASE WHEN g.comment_id IS NOT NULL THEN (SELECT pr.data->>'title' FROM revisions pr WHERE pr.id=c.published_revision_id) ELSE r.data->>'title' END title ${from} ORDER BY g.created_at DESC,g.id LIMIT $4 OFFSET $5`,
        [req.user.id, q.status, '%' + q.q + '%', limit, (page - 1) * limit],
      ),
      total: (
        await db.query(`SELECT count(*)::int n ${from}`, [req.user.id, q.status, '%' + q.q + '%'])
      )[0].n,
    };
  });
  app.post('/api/admin/honors/contributions/:id/assess', async (req) => {
    staff(req);
    const gid = identifier.parse((req.params as any).id),
      p = assessment.parse(req.body);
    await db.transaction(async (tx) => {
      const g = (await tx.query('SELECT * FROM contributions WHERE id=$1', [gid]))[0];
      if (!g) fail(404, '贡献记录不存在');
      await getContent(tx, req.user, g.content_id, 'manage');
      await tx.query('SELECT id FROM contents WHERE id=$1 FOR UPDATE', [g.content_id]);
      if (
        g.revision_id &&
        !(
          await tx.query(`SELECT r.id FROM revisions r WHERE r.id=$2 AND ${revisionManageSQL()}`, [
            req.user.id,
            g.revision_id,
          ])
        ).length
      )
        fail(404, '贡献记录不存在');
      await lockHonors(tx);
      const current = (await tx.query('SELECT * FROM contributions WHERE id=$1', [gid]))[0];
      if (current.revision_id !== p.revisionId) fail(409, '公开版本已变化，请刷新后重新确认');
      if (p.decision === 'confirmed') {
        if (!p.verified) fail(400, '请确认原创实用或资源完整可用，回答须确认内容有效');
        await verifyContributionFiles(tx, current, ctx.dataDir);
        await syncContentHonors(tx, g.content_id, req.user.id);
      }
      await assessContribution(tx, gid, req.user.id, p.decision, p.reason);
    });
    return { ok: true };
  });
  app.get('/api/admin/honors/ledger', async (req) => {
    admin(req);
    const q = z
        .object({ q: z.string().max(120).default(''), contributionId: identifier.optional() })
        .parse(req.query),
      { page, limit } = pageQuery(req.query);
    const from =
      'FROM points_ledger l JOIN users u ON u.id=l.user_id LEFT JOIN users a ON a.id=l.actor_id WHERE (u.name ILIKE $1 OR u.username ILIKE $1) AND ($2::text IS NULL OR l.contribution_id=$2)';
    return {
      items: await db.query(
        `SELECT l.*,l.week_start::text week,u.name,u.username,a.name actor ${from} ORDER BY l.created_at DESC,l.id LIMIT $3 OFFSET $4`,
        ['%' + q.q + '%', q.contributionId || null, limit, (page - 1) * limit],
      ),
      total: (
        await db.query(`SELECT count(*)::int n ${from}`, [
          '%' + q.q + '%',
          q.contributionId || null,
        ])
      )[0].n,
    };
  });
  app.get('/api/admin/honors/badges', async (req) => {
    admin(req);
    const { page, limit } = pageQuery(req.query);
    return {
      items: await db.query(
        "SELECT a.*,u.name,u.username,d.name badge_name,d.image,au.name issuer FROM badge_awards a JOIN users u ON u.id=a.user_id JOIN badge_definitions d ON d.id=a.badge_id LEFT JOIN users au ON au.id=a.awarded_by WHERE d.mode='manual' ORDER BY a.awarded_at DESC LIMIT $1 OFFSET $2",
        [limit, (page - 1) * limit],
      ),
      total: (
        await db.query("SELECT count(*)::int n FROM badge_awards WHERE badge_id='quality'")
      )[0].n,
    };
  });
  app.post('/api/admin/honors/badges', async (req) => {
    admin(req);
    const p = z
      .object({
        userId: identifier,
        reason: z.string().trim().min(5).max(1000),
        evidence: z.array(identifier).max(20).default([]),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (tx) => {
      await lockHonors(tx);
      if (!(await tx.query('SELECT id FROM users WHERE id=$1 AND active', [p.userId])).length)
        fail(404, '成员不存在或已停用');
      if (
        (
          await tx.query(
            "SELECT id FROM badge_awards WHERE user_id=$1 AND badge_id='quality' AND revoked_at IS NULL",
            [p.userId],
          )
        ).length
      )
        fail(409, '该成员已拥有此勋章');
      const valid = await tx.query(
        'SELECT id FROM contributions WHERE user_id=$1 AND valid AND id=ANY($2::text[])',
        [p.userId, p.evidence],
      );
      if (new Set(p.evidence).size !== valid.length) fail(400, '关联依据须为该成员的有效贡献');
      const aid = id();
      await tx.query(
        "INSERT INTO badge_awards(id,user_id,badge_id,awarded_by,reason,evidence) VALUES($1,$2,'quality',$3,$4,$5)",
        [aid, p.userId, req.user.id, p.reason, JSON.stringify(p.evidence)],
      );
      await audit(tx, req.user.id, 'honors.manual-award', aid, p);
      await notify(tx, p.userId, null, 'honors', '管理员授予你「优质贡献者」勋章');
    });
    return { ok: true };
  });
  app.post('/api/admin/honors/badges/:id/review', async (req) => {
    admin(req);
    const aid = identifier.parse((req.params as any).id),
      p = z
        .object({
          action: z.enum(['revoke', 'retain']),
          reason: z.string().trim().min(5).max(1000),
        })
        .strict()
        .parse(req.body);
    await db.transaction(async (tx) => {
      await lockHonors(tx);
      const a = (
        await tx.query(
          "SELECT * FROM badge_awards WHERE id=$1 AND badge_id='quality' AND revoked_at IS NULL",
          [aid],
        )
      )[0];
      if (!a) fail(404, '有效人工勋章不存在');
      if (p.action === 'revoke')
        await tx.query(
          'UPDATE badge_awards SET revoked_at=now(),revoke_reason=$2,revoked_by=$3 WHERE id=$1',
          [aid, p.reason, req.user.id],
        );
      else
        await tx.query(
          "UPDATE badge_awards SET needs_review=false,reason=$2,evidence='[]' WHERE id=$1",
          [aid, p.reason],
        );
      await audit(tx, req.user.id, 'honors.manual-' + p.action, aid, {
        ...p,
        previousReason: a.reason,
        previousEvidence: a.evidence,
      });
    });
    return { ok: true };
  });
}
