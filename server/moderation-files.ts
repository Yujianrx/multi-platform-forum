import { audit } from './core.js';
import type { Queryable, Row } from './db.js';

// Run inside the same transaction as the publication decision. Never release a
// partial set when another bound file has been blocked or removed.
export async function approveLinkedFiles(
  tx: Queryable,
  job: Row,
  actor: string,
  exempt = false,
): Promise<number | null> {
  const files = await tx.query(
    job.revision_id
      ? 'SELECT a.* FROM attachments a JOIN revision_attachments ra ON ra.attachment_id=a.id WHERE ra.revision_id=$1 ORDER BY a.id FOR UPDATE OF a'
      : 'SELECT a.* FROM attachments a JOIN comment_attachments ca ON ca.attachment_id=a.id WHERE ca.comment_id=$1 ORDER BY a.id FOR UPDATE OF a',
    [job.revision_id || job.comment_id],
  );
  if (files.some((f) => f.deleted || f.scan_status === 'blocked')) return null;
  const reason = exempt ? '随账号免审内容放行' : '随内容人工审核通过';
  let approved = 0;
  for (const f of files) {
    if (f.scan_status === 'clean') continue;
    await tx.query("UPDATE attachments SET scan_status='clean',scan_reason=$2 WHERE id=$1", [
      f.id,
      reason,
    ]);
    await audit(tx, actor, exempt ? 'file.exempt' : 'file.review', f.id, {
      decision: 'clean',
      reason,
      jobId: job.id,
      previousStatus: f.scan_status,
    });
    approved++;
  }
  return approved;
}
