import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type AppContext, pageQuery, identifier, fail } from './core.js';
import { publishedSQL, readSQL } from './permissions.js';
const metrics = `(SELECT count(*)::int FROM likes l WHERE l.content_id=c.id AND l.active) AS likes,(SELECT count(*)::int FROM download_events d WHERE d.content_id=c.id AND d.counted) AS downloads,(SELECT count(*)::int FROM comments cm WHERE cm.content_id=c.id AND cm.status='approved') AS comments`;
const card = `c.id,c.type,c.state,c.author_id,c.featured,c.pinned,c.published_at,c.updated_at,r.id AS revision_id,r.status,r.reason,r.data->>'title' AS title,r.data->>'summary' AS summary,r.data->>'coverId' AS cover_id,r.data->'tags' AS tags,r.data->'fields'->>'tool' AS tool,r.data->'fields'->>'version' AS version,EXISTS(SELECT 1 FROM revision_attachments ra JOIN attachments at ON at.id=ra.attachment_id WHERE ra.revision_id=r.id AND at.kind='resource' AND NOT at.deleted AND at.scan_status='clean') has_download,u.name AS author,u.avatar_version AS author_avatar_version,cat.name AS category,${metrics}`;
export async function discoveryRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  app.get('/api/taxonomy', async () => ({
    departments: await db.query('SELECT * FROM departments ORDER BY sort_order,name'),
    categories: await db.query('SELECT * FROM categories ORDER BY name'),
    tags: await db.query('SELECT * FROM tags ORDER BY name'),
    tools: await db.query('SELECT * FROM tool_names ORDER BY name'),
  }));
  app.get('/api/contents', async (req) => {
    const q = z
      .object({
        q: z.string().max(100).default(''),
        type: z.enum(['experience', 'project', 'skill', 'prompt', 'discussion']).optional(),
        resources: z.enum(['1']).optional(),
        category: identifier.optional(),
        tag: z.string().max(30).optional(),
        sort: z.enum(['latest', 'likes', 'downloads']).default('latest'),
        author: identifier.optional(),
        mine: z
          .enum(['all', 'draft', 'review', 'rejected', 'published', 'bookmarks', 'downloads'])
          .optional(),
        featured: z.enum(['1']).optional(),
      })
      .parse(req.query);
    const { page, limit } = pageQuery(req.query);
    const params: any[] = [req.user.id];
    const bind = (v: any) => {
      params.push(v);
      return '$' + params.length;
    };
    let where = publishedSQL(),
      rev = 'c.published_revision_id';
    if (q.mine && !['bookmarks', 'downloads'].includes(q.mine)) {
      where = `c.author_id=$1 AND ${readSQL()}`;
      rev = 'c.latest_revision_id';
      if (q.mine === 'published') where += " AND c.state='published'";
      if (q.mine === 'draft')
        where += " AND (r.status='draft' OR r.id IS NULL OR c.state='withdrawn')";
      if (q.mine === 'review') where += " AND r.status IN ('queued','review')";
      if (q.mine === 'rejected') where += " AND r.status='rejected'";
    }
    if (q.mine === 'bookmarks')
      where += ' AND EXISTS(SELECT 1 FROM bookmarks b WHERE b.content_id=c.id AND b.user_id=$1)';
    if (q.mine === 'downloads')
      where +=
        ' AND EXISTS(SELECT 1 FROM download_events e WHERE e.content_id=c.id AND e.user_id=$1)';
    if (q.type) where += ` AND c.type=${bind(q.type)}`;
    if (q.resources) where += " AND c.type<>'discussion'";
    if (q.category) where += ` AND c.category_id=${bind(q.category)}`;
    if (q.tag) where += ` AND r.data->'tags' @> ${bind(JSON.stringify([q.tag]))}::jsonb`;
    if (q.author) where += ` AND c.author_id=${bind(q.author)}`;
    if (q.featured) where += ' AND c.featured';
    if (q.q) {
      const p = bind('%' + q.q.replace(/[\\%_]/g, '\\$&') + '%');
      where += ` AND (r.data->>'title' ILIKE ${p} OR r.data->>'summary' ILIKE ${p} OR r.data->>'body' ILIKE ${p} OR r.data->'fields'->>'prompt' ILIKE ${p} OR (r.data->'tags')::text ILIKE ${p})`;
    }
    const from = `FROM contents c LEFT JOIN revisions r ON r.id=${rev} JOIN users u ON u.id=c.author_id JOIN categories cat ON cat.id=c.category_id WHERE ${where}`;
    const count = (await db.query(`SELECT count(*)::int total ${from}`, params))[0].total;
    const order =
      q.sort === 'likes'
        ? 'likes DESC'
        : q.sort === 'downloads'
          ? 'downloads DESC'
          : 'c.pinned DESC,c.updated_at DESC';
    const items = await db.query(
      `SELECT ${card} ${from} ORDER BY ${order},c.id LIMIT ${bind(limit)} OFFSET ${bind((page - 1) * limit)}`,
      params,
    );
    return { items, total: count, page, limit };
  });
  app.get('/api/rankings', async (req) => {
    const q = z
      .object({
        metric: z.enum(['likes', 'views', 'downloads']).default('likes'),
        period: z.enum(['week', 'month', 'all']).default('week'),
      })
      .parse(req.query);
    const { page, limit } = pageQuery(req.query);
    const interval = q.period === 'week' ? '7 days' : '30 days';
    const timing =
      q.period === 'all'
        ? ''
        : `AND ${q.metric === 'likes' ? 'e.first_at' : 'e.created_at'} >= now()-interval '${interval}'`;
    const score =
      q.metric === 'likes'
        ? `(SELECT count(*)::int FROM likes e WHERE e.content_id=c.id AND e.active ${timing})`
        : q.metric === 'views'
          ? `(SELECT count(*)::int FROM content_view_events e WHERE e.content_id=c.id ${timing})`
          : `(SELECT count(*)::int FROM download_events e WHERE e.content_id=c.id AND e.counted ${timing})`;
    const items = await db.query(
      `SELECT ${card},${score} score FROM contents c JOIN revisions r ON r.id=c.published_revision_id JOIN users u ON u.id=c.author_id JOIN categories cat ON cat.id=c.category_id WHERE ${publishedSQL()} ORDER BY score DESC,c.published_at DESC,c.id LIMIT $2 OFFSET $3`,
      [req.user.id, limit, (page - 1) * limit],
    );
    return {
      items,
      total: (
        await db.query(`SELECT count(*)::int total FROM contents c WHERE ${publishedSQL()}`, [
          req.user.id,
        ])
      )[0].total,
      page,
      limit,
    };
  });
  app.get('/api/home', async (req) => {
    const stats = (
      await db.query(
        `SELECT count(*)::int contents,count(*) FILTER(WHERE type IN ('project','skill'))::int resources,count(DISTINCT author_id)::int authors FROM contents c WHERE ${publishedSQL()}`,
        [req.user.id],
      )
    )[0];
    const banners = await db.query(
      `SELECT b.*,r.data->>'title' AS content_title,c.type FROM banners b LEFT JOIN contents c ON c.id=b.content_id LEFT JOIN revisions r ON r.id=c.published_revision_id WHERE b.enabled AND (b.starts_at IS NULL OR b.starts_at<=now()) AND (b.ends_at IS NULL OR b.ends_at>now()) AND (b.content_id IS NULL OR ${publishedSQL()}) AND (b.image_id IS NULL OR EXISTS(SELECT 1 FROM revision_attachments ra JOIN attachments a ON a.id=ra.attachment_id WHERE ra.revision_id=c.published_revision_id AND a.id=b.image_id AND a.scan_status='clean' AND NOT a.deleted)) ORDER BY b.position,b.id LIMIT 10`,
      [req.user.id],
    );
    return { stats, banners };
  });
  app.get('/api/authors/:id', async (req) => {
    const uid = identifier.parse((req.params as any).id);
    const u = (
      await db.query('SELECT id,name,bio,avatar_version FROM users WHERE id=$1', [uid])
    )[0];
    if (!u) fail(404, '作者不存在');
    return u;
  });
  app.get('/api/notifications', async (req) => {
    const { page, limit } = pageQuery(req.query);
    const where = `n.user_id=$1 AND (n.content_id IS NULL OR ${readSQL()})`;
    const items = await db.query(
      `SELECT n.* FROM notifications n LEFT JOIN contents c ON c.id=n.content_id WHERE ${where} ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.id, limit, (page - 1) * limit],
    );
    const totals = (
      await db.query(
        `SELECT count(*)::int total,count(*) FILTER(WHERE n.read_at IS NULL)::int unread FROM notifications n LEFT JOIN contents c ON c.id=n.content_id WHERE ${where}`,
        [req.user.id],
      )
    )[0];
    return { items, ...totals };
  });
  app.post('/api/notifications/read', async (req) => {
    await db.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [
      req.user.id,
    ]);
    return { ok: true };
  });
}
