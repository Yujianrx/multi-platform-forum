import { fail, type User } from './core.js';
import type { Queryable, Row } from './db.js';
// Alias is always a literal supplied by server code. User values are bound parameters.
function baseManageSQL(alias = 'c', userParam = '$1') {
  return `(EXISTS(SELECT 1 FROM users au WHERE au.id=${userParam} AND au.active AND (au.role='admin' OR (au.role='moderator' AND EXISTS(SELECT 1 FROM moderator_scopes ms WHERE ms.user_id=au.id AND (ms.category_id IS NULL OR ms.category_id=${alias}.category_id) AND (ms.department_id IS NULL OR (${alias}.visibility='departments' AND EXISTS(SELECT 1 FROM content_departments md WHERE md.content_id=${alias}.id AND md.department_id=ms.department_id))))))))`;
}
// Related topics always inherit the current resource boundary, including for their author.
// A topic can only link to a resource, so this check is deliberately non-recursive.
export function relatedAccessSQL(alias = 'c', userParam = '$1') {
  return `NOT EXISTS(SELECT 1 FROM forum_topics ft WHERE ft.content_id=${alias}.id AND ft.related_content_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contents rc WHERE rc.id=ft.related_content_id AND rc.type<>'discussion' AND rc.state<>'deleted' AND (rc.author_id=${userParam} OR ${baseManageSQL('rc', userParam)} OR (rc.state='published' AND ${visibleSQL('rc', userParam)}))))`;
}
export function manageSQL(alias = 'c', userParam = '$1') {
  return `(${baseManageSQL(alias, userParam)} AND ${relatedAccessSQL(alias, userParam)})`;
}
export function visibleSQL(alias = 'c', userParam = '$1') {
  return `(${alias}.visibility='company' OR EXISTS(SELECT 1 FROM content_departments cd JOIN users vu ON vu.department_id=cd.department_id WHERE cd.content_id=${alias}.id AND vu.id=${userParam} AND vu.active))`;
}
export function readSQL(alias = 'c', userParam = '$1') {
  return `(${alias}.state<>'deleted' AND ${relatedAccessSQL(alias, userParam)} AND (${alias}.author_id=${userParam} OR ${baseManageSQL(alias, userParam)} OR (${alias}.state='published' AND ${visibleSQL(alias, userParam)})))`;
}
export function publishedSQL(alias = 'c', userParam = '$1') {
  return `(${alias}.state='published' AND ${alias}.published_revision_id IS NOT NULL AND ${relatedAccessSQL(alias, userParam)} AND (${alias}.author_id=${userParam} OR ${baseManageSQL(alias, userParam)} OR ${visibleSQL(alias, userParam)}))`;
}
export function revisionManageSQL(alias = 'r', userParam = '$1') {
  return `EXISTS(SELECT 1 FROM users ru WHERE ru.id=${userParam} AND ru.active AND (ru.role='admin' OR (ru.role='moderator' AND EXISTS(SELECT 1 FROM moderator_scopes rs WHERE rs.user_id=ru.id AND (rs.category_id IS NULL OR rs.category_id=${alias}.data->>'categoryId') AND (rs.department_id IS NULL OR (${alias}.data->>'visibility'='departments' AND ${alias}.data->'departments' ? rs.department_id))))))`;
}
export async function getContent(
  db: Queryable,
  user: User,
  contentId: string,
  mode: 'read' | 'manage' | 'edit' | 'published' = 'read',
): Promise<Row> {
  const rows = await db.query(
    `SELECT c.* FROM contents c WHERE c.id=$2 AND ${mode === 'manage' ? manageSQL() : mode === 'published' ? publishedSQL() : readSQL()}`,
    [user.id, contentId],
  );
  if (!rows[0]) fail(404, '内容不存在或无权访问');
  if (mode === 'edit' && rows[0].author_id !== user.id && user.role !== 'admin')
    fail(403, '只能编辑自己的内容');
  return rows[0];
}
export async function canManage(db: Queryable, user: User, cid: string) {
  return !!(
    await db.query(`SELECT c.id FROM contents c WHERE c.id=$2 AND ${manageSQL()}`, [user.id, cid])
  ).length;
}
export async function canReadRevision(db: Queryable, user: User, c: Row, r: Row) {
  if (r.discarded_at) return false;
  if (c.author_id === user.id || user.role === 'admin') return true;
  const scoped = !!(
    await db.query(`SELECT r.id FROM revisions r WHERE r.id=$2 AND ${revisionManageSQL()}`, [
      user.id,
      r.id,
    ])
  ).length;
  if (r.status !== 'approved') return scoped && (await canManage(db, user, c.id));
  return (
    scoped || r.data.visibility === 'company' || r.data.departments?.includes(user.department_id)
  );
}
