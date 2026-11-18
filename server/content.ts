import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  type AppContext,
  id,
  hash,
  fail,
  identifier,
  safeUrl,
  audit,
  notify,
  pageQuery,
} from './core.js';
import { getContent, canReadRevision, canManage } from './permissions.js';
import { enqueue } from './moderation.js';
import { syncContentHonors, honorSummaries } from './honors-engine.js';
import { recordContentView } from './views.js';
import { miniBodyBlocks } from './mini-markdown.js';
import type { Queryable } from './db.js';
import type { User } from './core.js';
export const contentData = z
  .object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().max(400).default(''),
    body: z.string().max(150000).default(''),
    categoryId: identifier,
    tags: z.array(z.string().max(30)).max(10).default([]),
    visibility: z.enum(['company', 'departments']),
    departments: z.array(identifier).max(50).default([]),
    coverId: identifier.nullable().default(null),
    attachments: z.array(identifier).max(30).default([]),
    fields: z
      .object({
        problem: z.string().max(10000).default(''),
        techStack: z.string().max(1000).default(''),
        usage: z.string().max(20000).default(''),
        members: z.string().max(1000).default(''),
        demoUrl: safeUrl.default(''),
        repoUrl: safeUrl.default(''),
        tool: z.string().max(200).default(''),
        dependencies: z.string().max(10000).default(''),
        installation: z.string().max(20000).default(''),
        example: z.string().max(30000).default(''),
        version: z.string().max(60).default('1.0.0'),
        changelog: z.string().max(10000).default(''),
        prompt: z.string().max(100000).default(''),
        scenario: z.string().max(10000).default(''),
        input: z.string().max(10000).default(''),
        result: z.string().max(30000).default(''),
      })
      .default({} as any),
  })
  .strict()
  .refine((v) => v.visibility !== 'departments' || v.departments.length > 0, '请选择可见部门');
export const contentSaveInput = z
  .object({
    data: contentData,
    submit: z.boolean().default(false),
    baseRevisionId: identifier.nullable(),
  })
  .strict();
export async function saveContentRevision(
  tx: Queryable,
  user: User,
  cid: string,
  p: z.infer<typeof contentSaveInput>,
) {
  let c = await getContent(tx, user, cid, 'edit');
  c = (await tx.query('SELECT * FROM contents WHERE id=$1 FOR UPDATE', [cid]))[0];
  if (c.latest_revision_id !== p.baseRevisionId) fail(409, '内容已有更新，请重新加载后编辑');
  if (c.state === 'deleted') fail(404, '内容已删除');
  if (p.submit) {
    if (p.data.summary.length < 5) fail(400, '发布时请填写至少 5 个字的摘要');
    if (c.type === 'prompt' && !p.data.fields.prompt.trim()) fail(400, '请填写提示词正文');
    if (c.type !== 'prompt' && !p.data.body.trim()) fail(400, '请填写正文');
    if (c.type === 'skill' && !p.data.attachments.length) fail(400, '技能包需要上传资源附件');
  }
  if (!(await tx.query('SELECT id FROM categories WHERE id=$1', [p.data.categoryId])).length)
    fail(400, '分类不存在');
  for (const dep of p.data.departments)
    if (!(await tx.query('SELECT id FROM departments WHERE id=$1', [dep])).length)
      fail(400, '部门不存在');
  if (p.data.visibility === 'company') p.data.departments = [];
  p.data.departments = [...new Set(p.data.departments)];
  p.data.tags = [...new Set(p.data.tags)];
  for (const tag of p.data.tags)
    if (!(await tx.query('SELECT id FROM tags WHERE name=$1', [tag])).length)
      fail(400, `标签「${tag}」尚未由管理员建立`);
  const bodyFileIds = [...p.data.body.matchAll(/\/api\/files\/([0-9a-f-]{36})/g)].map((m) => m[1]);
  const fileIds = [
    ...new Set([
      ...p.data.attachments,
      ...(p.data.coverId ? [p.data.coverId] : []),
      ...bodyFileIds,
    ]),
  ];
  for (const fid of fileIds) {
    const f = (
      await tx.query(
        "SELECT * FROM attachments WHERE id=$1 AND content_id=$2 AND purpose='content' AND NOT deleted",
        [fid, cid],
      )
    )[0];
    if (!f) fail(400, '附件必须属于当前内容');
    if (fid === p.data.coverId && f.kind !== 'image') fail(400, '封面必须为图片');
    if (f.scan_status === 'blocked') fail(400, '包含已阻止的文件，请移除');
  }
  const revisionId = id(),
    digest = hash(JSON.stringify(p.data));
  const num = (
    await tx.query('SELECT COALESCE(max(number),0)+1 AS n FROM revisions WHERE content_id=$1', [
      cid,
    ])
  )[0].n;
  await tx.query(
    'INSERT INTO revisions(id,content_id,number,data,digest,status) VALUES($1,$2,$3,$4,$5,$6)',
    [revisionId, cid, num, JSON.stringify(p.data), digest, p.submit ? 'queued' : 'draft'],
  );
  for (const fid of fileIds)
    await tx.query('INSERT INTO revision_attachments(revision_id,attachment_id) VALUES($1,$2)', [
      revisionId,
      fid,
    ]);
  // Intersect current audience immediately. Expansions apply only on approval.
  const previousDeps = (
    await tx.query('SELECT department_id FROM content_departments WHERE content_id=$1', [cid])
  ).map((r) => r.department_id);
  if (!c.published_revision_id || p.data.visibility === 'departments') {
    const deps =
      !c.published_revision_id || c.visibility === 'company'
        ? p.data.departments
        : p.data.departments.filter((d) => previousDeps.includes(d));
    await tx.query('UPDATE contents SET visibility=$1 WHERE id=$2', [p.data.visibility, cid]);
    await tx.query('DELETE FROM content_departments WHERE content_id=$1', [cid]);
    for (const dep of deps)
      await tx.query('INSERT INTO content_departments(content_id,department_id) VALUES($1,$2)', [
        cid,
        dep,
      ]);
  }
  await tx.query(
    "UPDATE contents SET latest_revision_id=$1,updated_at=now(),state=CASE WHEN state='withdrawn' AND $3 THEN 'draft' ELSE state END WHERE id=$2",
    [revisionId, cid, p.submit],
  );
  if (!c.published_revision_id)
    await tx.query('UPDATE contents SET category_id=$1 WHERE id=$2', [p.data.categoryId, cid]);
  const status = p.submit ? await enqueue(tx, revisionId, null, digest) : 'draft';
  return { id: cid, revisionId, status };
}
export async function contentRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  app.post('/api/contents', async (req, reply) => {
    const p = z
      .object({
        type: z.enum(['experience', 'project', 'skill', 'prompt']),
        categoryId: identifier,
      })
      .strict()
      .parse(req.body);
    const cid = id();
    await db.query('INSERT INTO contents(id,author_id,type,category_id) VALUES($1,$2,$3,$4)', [
      cid,
      req.user.id,
      p.type,
      p.categoryId,
    ]);
    return reply.code(201).send({ id: cid });
  });
  app.get('/api/contents/:id', async (req) => {
    const cid = identifier.parse((req.params as any).id),
      c = await getContent(db, req.user, cid);
    const editing = (req.query as any).edit === '1';
    if (editing && c.author_id !== req.user.id && req.user.role !== 'admin')
      fail(403, '只能编辑自己的内容');
    const requested = (req.query as any).revision;
    const rid = requested
      ? identifier.parse(requested)
      : editing || !c.published_revision_id
        ? c.latest_revision_id
        : c.published_revision_id;
    const r = rid
      ? (await db.query('SELECT * FROM revisions WHERE id=$1 AND content_id=$2', [rid, cid]))[0]
      : null;
    if (requested && !r) fail(404, '版本不存在');
    if (r && !(await canReadRevision(db, req.user, c, r))) fail(404, '内容不存在或无权访问');
    const author = (
      await db.query(
        'SELECT u.id,u.name,u.bio,u.avatar_version,d.name AS department FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=$1',
        [c.author_id],
      )
    )[0];
    const metrics = (
      await db.query(
        "SELECT (SELECT count(*)::int FROM likes WHERE content_id=$1 AND active) likes,(SELECT count(*)::int FROM download_events WHERE content_id=$1 AND counted) downloads,(SELECT count(*)::int FROM comments WHERE content_id=$1 AND status='approved') comments,EXISTS(SELECT 1 FROM likes WHERE content_id=$1 AND user_id=$2 AND active) liked,EXISTS(SELECT 1 FROM bookmarks WHERE content_id=$1 AND user_id=$2) bookmarked",
        [cid, req.user.id],
      )
    )[0];
    const files = r
      ? await db.query(
          'SELECT a.id,a.original_name,a.size,a.mime,a.kind,a.scan_status,a.scan_reason,a.created_at FROM attachments a JOIN revision_attachments ra ON a.id=ra.attachment_id WHERE ra.revision_id=$1 AND NOT a.deleted',
          [r.id],
        )
      : [];
    let latest = null;
    if (c.author_id === req.user.id || (await canManage(db, req.user, cid))) {
      const lr = (await db.query('SELECT * FROM revisions WHERE id=$1', [c.latest_revision_id]))[0];
      if (lr && (await canReadRevision(db, req.user, c, lr)))
        latest = { id: lr.id, status: lr.status, reason: lr.reason, number: lr.number };
    }
    return {
      ...c,
      revision: r,
      ...(req.miniSession ? { bodyBlocks: miniBodyBlocks(r?.data?.body || '') } : {}),
      author,
      honors: (await honorSummaries(db, [c.author_id]))[c.author_id],
      metrics,
      files,
      latest,
      canManage: await canManage(db, req.user, cid),
    };
  });
  app.put('/api/contents/:id', async (req) => {
    const cid = identifier.parse((req.params as any).id);
    const p = contentSaveInput.parse(req.body);
    return db.transaction((tx) => saveContentRevision(tx, req.user, cid, p));
  });
  app.post('/api/contents/:id/withdraw', async (req) => {
    const cid = identifier.parse((req.params as any).id);
    let c;
    try {
      c = await getContent(db, req.user, cid, 'edit');
    } catch {
      c = await getContent(db, req.user, cid, 'manage');
    }
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE contents SET state='withdrawn',featured=false,pinned=false,updated_at=now() WHERE id=$1",
        [cid],
      );
      await audit(tx, req.user.id, 'content.withdraw', cid);
      await syncContentHonors(tx, cid, req.user.id);
      await notify(tx, c.author_id, cid, 'withdrawn', '内容已下架，可修改后重新提交');
    });
    return { ok: true };
  });
  app.delete('/api/contents/:id', async (req) => {
    const cid = identifier.parse((req.params as any).id);
    await getContent(db, req.user, cid, 'edit');
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE contents SET state='deleted',featured=false,pinned=false WHERE id=$1",
        [cid],
      );
      await audit(tx, req.user.id, 'content.delete', cid);
      await syncContentHonors(tx, cid, req.user.id);
    });
    return { ok: true };
  });
  app.delete('/api/contents/:id/draft', async (req) => {
    const cid = identifier.parse((req.params as any).id),
      p = z.object({ revisionId: identifier.nullable() }).strict().parse(req.body);
    return db.transaction(async (tx) => {
      await tx.query('SELECT id FROM contents WHERE id=$1 FOR UPDATE', [cid]);
      const c = await getContent(tx, req.user, cid, 'edit');
      if (c.latest_revision_id !== p.revisionId) fail(409, '草稿已有更新，请刷新后再删除');
      const r = c.latest_revision_id
        ? (await tx.query('SELECT * FROM revisions WHERE id=$1', [c.latest_revision_id]))[0]
        : null;
      if (
        r &&
        r.status !== 'draft' &&
        !(c.state === 'withdrawn' && !['queued', 'review'].includes(r.status))
      )
        fail(409, '该版本已提交或发布，不能作为草稿删除');
      const keptPublished = c.state === 'published' && !!c.published_revision_id;
      if (keptPublished && c.latest_revision_id === c.published_revision_id)
        fail(409, '没有可删除的未发布草稿');
      await tx.query(
        "UPDATE revisions SET discarded_at=now() WHERE content_id=$1 AND status='draft' AND discarded_at IS NULL",
        [cid],
      );
      if (keptPublished)
        await tx.query(
          'UPDATE contents SET latest_revision_id=published_revision_id,updated_at=now() WHERE id=$1',
          [cid],
        );
      else {
        await tx.query(
          "UPDATE contents SET state='deleted',featured=false,pinned=false,updated_at=now() WHERE id=$1",
          [cid],
        );
        await syncContentHonors(tx, cid, req.user.id);
      }
      await audit(tx, req.user.id, 'content.draft-delete', cid, {
        revisionId: p.revisionId,
        keptPublished,
      });
      return { ok: true, keptPublished };
    });
  });
  app.post('/api/contents/:id/visit', async (req) => {
    const cid = identifier.parse((req.params as any).id);
    await db.transaction((tx) => recordContentView(tx, req.user, cid));
    return { ok: true };
  });
  app.get('/api/contents/:id/versions', async (req) => {
    const cid = identifier.parse((req.params as any).id),
      c = await getContent(db, req.user, cid);
    const { page, limit } = pageQuery(req.query);
    const rows = await db.query(
      'SELECT r.* FROM revisions r WHERE content_id=$1 ORDER BY number DESC',
      [cid],
    );
    const allowed = [];
    for (const r of rows) if (await canReadRevision(db, req.user, c, r)) allowed.push(r);
    return { items: allowed.slice((page - 1) * limit, page * limit), total: allowed.length };
  });
  app.get('/api/contents/:id/files', async (req) => {
    const cid = identifier.parse((req.params as any).id);
    await getContent(db, req.user, cid, 'edit');
    return {
      items: await db.query(
        "SELECT id,original_name,size,kind,mime,scan_status,scan_reason,created_at FROM attachments WHERE content_id=$1 AND purpose='content' AND NOT deleted ORDER BY created_at DESC",
        [cid],
      ),
    };
  });
  app.get('/api/contents/:id/external/:field', async (req, reply) => {
    const cid = identifier.parse((req.params as any).id),
      field = z.enum(['demoUrl', 'repoUrl']).parse((req.params as any).field);
    const c = await getContent(db, req.user, cid, 'published');
    const r = (
      await db.query('SELECT data FROM revisions WHERE id=$1', [c.published_revision_id])
    )[0];
    const url = safeUrl.parse(r.data.fields[field]);
    if (!url) fail(404, '外部链接不存在');
    await db.query('INSERT INTO external_events(id,user_id,content_id,field) VALUES($1,$2,$3,$4)', [
      id(),
      req.user.id,
      cid,
      field,
    ]);
    return reply.redirect(url);
  });
}
