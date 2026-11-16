import type { Queryable } from './db.js';
import type { User } from './core.js';
import { getContent } from './permissions.js';

export const viewDay = (at: Date) =>
  new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Caller owns the transaction. Permissions are checked after locking the source,
// so a concurrent withdrawal cannot leave an event for an inaccessible source.
export async function recordContentView(tx: Queryable, user: User, cid: string, at = new Date()) {
  await tx.query('SELECT id FROM contents WHERE id=$1 FOR SHARE', [cid]);
  const c = await getContent(tx, user, cid, 'published');
  if (c.author_id !== user.id)
    await tx.query(
      'INSERT INTO content_view_events(content_id,user_id,day,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [cid, user.id, viewDay(at), at],
    );
  return c;
}
