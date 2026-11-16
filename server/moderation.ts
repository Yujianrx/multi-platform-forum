import { id, notify, hash, type AppContext, fail, type User, audit } from './core.js';
import type { Row, Queryable } from './db.js';
import { canManage, revisionManageSQL } from './permissions.js';
import { syncContentHonors, assessContribution, verifyContributionFiles } from './honors-engine.js';
export type Decision = {
  decision: 'approved' | 'rejected' | 'review';
  reason: string;
  categories: string[];
};
export interface ModerationProvider {
  name: string;
  review(input: {
    text: string;
    images: { id: string; mime: string }[];
    unparsedFiles: boolean;
    revisionDigest: string;
  }): Promise<Decision>;
}
export class UnconfiguredProvider implements ModerationProvider {
  name = 'unconfigured';
  async review(): Promise<Decision> {
    return {
      decision: 'review',
      reason: '未配置真实内容审核服务，需人工检查文字、图片及附件内容',
      categories: ['coverage'],
    };
  }
}
export class DevelopmentProvider implements ModerationProvider {
  name = 'development-simulator';
  async review(input: { text: string }): Promise<Decision> {
    if (input.text.includes('[dev:timeout]')) throw new Error('开发模拟：审核超时');
    if (input.text.includes('[dev:reject]'))
      return { decision: 'rejected', reason: '开发模拟：明确违规测试标记', categories: ['test'] };
    if (input.text.includes('[dev:review]'))
      return { decision: 'review', reason: '开发模拟：待复核测试标记', categories: ['test'] };
    return {
      decision: 'approved',
      reason: '仅开发模拟审核通过，不代表真实审核能力',
      categories: [],
    };
  }
}
export function providerFor(name: string, production: boolean): ModerationProvider {
  if (name === 'development') {
    if (production) throw new Error('生产环境禁止使用开发审核模拟器');
    return new DevelopmentProvider();
  }
  if (name !== 'none') throw new Error('未知审核供应商；先实现 ModerationProvider 并完成覆盖验证');
  return new UnconfiguredProvider();
}
export async function enqueue(
  tx: Queryable,
  revisionId: string | null,
  commentId: string | null,
  digest: string,
) {
  const job = (
    await tx.query(
      'INSERT INTO moderation_jobs(id,revision_id,comment_id,digest) VALUES($1,$2,$3,$4) RETURNING *',
      [id(), revisionId, commentId, digest],
    )
  )[0];
  // Resolve the current author's permission inside the publication transaction.
  // A cached session flag must never authorize a bypass after an admin disables it.
  const exempt = (
    await tx.query(
      revisionId
        ? 'SELECT u.id FROM users u JOIN contents c ON c.author_id=u.id JOIN revisions r ON r.content_id=c.id WHERE r.id=$1 AND u.active AND NOT u.must_reset AND u.moderation_exempt FOR SHARE OF u'
        : 'SELECT u.id FROM users u JOIN comments cm ON cm.author_id=u.id WHERE cm.id=$1 AND u.active AND NOT u.must_reset AND u.moderation_exempt FOR SHARE OF u',
      [revisionId || commentId],
    )
  )[0];
  if (!exempt) return 'queued';
  await applyDecision(
    tx,
    job,
    { decision: 'approved', reason: '账号免审，直接发布', categories: [] },
    'account-exemption',
    exempt.id,
  );
  const status = (
    await tx.query(
      revisionId
        ? 'SELECT status FROM revisions WHERE id=$1'
        : 'SELECT status FROM comments WHERE id=$1',
      [revisionId || commentId],
    )
  )[0].status;
  await audit(tx, exempt.id, 'content.exempt-submit', revisionId || commentId!, {
    jobId: job.id,
    status,
  });
  return status as 'approved' | 'review';
}
async function applyDecision(
  tx: Queryable,
  job: Row,
  result: Decision,
  provider: string,
  actor: string | null,
) {
  if (result.decision === 'approved' && provider !== 'account-exemption') {
    const input = await readReviewInput(tx, job);
    const blocked = await matchModerationRules(tx, input.text);
    if (blocked?.decision === 'rejected') {
      if (provider === 'manual') fail(400, '内容命中禁止发布规则：' + blocked.reason);
      result = blocked;
    }
  }
  if (job.comment_id && result.decision === 'approved') {
    const unsafe = await tx.query(
      "SELECT a.id FROM attachments a JOIN comment_attachments ca ON ca.attachment_id=a.id WHERE ca.comment_id=$1 AND (a.scan_status<>'clean' OR a.deleted)",
      [job.comment_id],
    );
    if (unsafe.length)
      result = {
        decision: 'review',
        categories: ['file-scan'],
        reason: '评论附件尚未通过独立安全检查，请先处理附件隔离',
      };
  }
  if (job.revision_id && result.decision === 'approved') {
    const unsafe = await tx.query(
      "SELECT a.id FROM attachments a JOIN revision_attachments ra ON ra.attachment_id=a.id WHERE ra.revision_id=$1 AND (a.scan_status<>'clean' OR a.deleted)",
      [job.revision_id],
    );
    if (unsafe.length)
      result = {
        decision: 'review',
        categories: ['file-scan'],
        reason: '附件尚未通过独立安全扫描，请先处理文件隔离',
      };
  }
  await tx.query(
    'INSERT INTO moderation_records(id,job_id,decision,categories,reason,provider,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      id(),
      job.id,
      result.decision,
      JSON.stringify(result.categories),
      result.reason,
      provider,
      actor,
    ],
  );
  if (job.revision_id) {
    const r = (
      await tx.query('SELECT * FROM revisions WHERE id=$1 FOR UPDATE', [job.revision_id])
    )[0];
    const c = (await tx.query('SELECT * FROM contents WHERE id=$1 FOR UPDATE', [r.content_id]))[0];
    if (
      r.digest !== job.digest ||
      c.latest_revision_id !== r.id ||
      c.state === 'deleted' ||
      c.state === 'withdrawn'
    ) {
      await tx.query(
        "UPDATE moderation_jobs SET status='done',last_error='修订已被替代或内容已下架',locked_until=NULL WHERE id=$1",
        [job.id],
      );
      return;
    }
    if (result.decision === 'approved') {
      const unsafe = await tx.query(
        "SELECT a.id FROM attachments a JOIN revision_attachments ra ON ra.attachment_id=a.id WHERE ra.revision_id=$1 AND (a.scan_status<>'clean' OR a.deleted)",
        [r.id],
      );
      if (unsafe.length)
        result = {
          decision: 'review',
          categories: ['file-scan'],
          reason: '附件尚未通过独立安全扫描，请先处理文件隔离',
        };
    }
    await tx.query(
      "UPDATE revisions SET status=$1,reason=$2,approved_at=CASE WHEN $1='approved' THEN now() ELSE NULL END WHERE id=$3",
      [result.decision, result.reason, r.id],
    );
    if (result.decision === 'approved') {
      await tx.query(
        "UPDATE contents SET published_revision_id=$1,state='published',visibility=$2,category_id=$3,published_at=COALESCE(published_at,now()),updated_at=now() WHERE id=$4",
        [r.id, r.data.visibility, r.data.categoryId, c.id],
      );
      await tx.query('DELETE FROM content_departments WHERE content_id=$1', [c.id]);
      for (const dep of r.data.departments || [])
        await tx.query('INSERT INTO content_departments(content_id,department_id) VALUES($1,$2)', [
          c.id,
          dep,
        ]);
      if (['project', 'skill'].includes(c.type))
        await tx.query(
          'INSERT INTO resource_versions(id,content_id,revision_id,version,changelog) VALUES($1,$2,$3,$4,$5) ON CONFLICT(revision_id) DO NOTHING',
          [
            id(),
            c.id,
            r.id,
            r.data.fields.version || `修订 ${r.number}`,
            r.data.fields.changelog || '',
          ],
        );
    }
    await notify(
      tx,
      c.author_id,
      c.id,
      'moderation',
      result.decision === 'approved'
        ? provider === 'account-exemption'
          ? '你的内容已直接发布（账号免审）'
          : '你的内容已通过审核并发布'
        : result.decision === 'rejected'
          ? `内容被退回：${result.reason}`
          : `内容等待复核：${result.reason}`,
    );
  } else {
    const c = (
      await tx.query('SELECT * FROM comments WHERE id=$1 FOR UPDATE', [job.comment_id])
    )[0];
    if (c.digest !== job.digest || c.status === 'deleted') {
      await tx.query("UPDATE moderation_jobs SET status='done',locked_until=NULL WHERE id=$1", [
        job.id,
      ]);
      return;
    }
    await tx.query(
      "UPDATE comments SET status=$1,reason=$2,approved_at=CASE WHEN $1='approved' THEN now() ELSE NULL END WHERE id=$3",
      [result.decision, result.reason, c.id],
    );
    if (result.decision === 'approved') {
      const content = (
        await tx.query('SELECT author_id FROM contents WHERE id=$1', [c.content_id])
      )[0];
      const parent = c.parent_id
        ? (await tx.query('SELECT author_id FROM comments WHERE id=$1', [c.parent_id]))[0]
        : null;
      const followers = await tx.query(
        'SELECT user_id FROM forum_subscriptions WHERE content_id=$1',
        [c.content_id],
      );
      for (const uid of new Set(
        [content.author_id, parent?.author_id, ...followers.map((f) => f.user_id)].filter(Boolean),
      ))
        if (uid !== c.author_id)
          await notify(
            tx,
            uid,
            c.content_id,
            'comment',
            followers.length
              ? '你关注的话题有了新回复'
              : parent
                ? '有同事回复了讨论'
                : '你的分享收到了新评论',
          );
    } else await notify(tx, c.author_id, c.content_id, 'moderation', `评论审核：${result.reason}`);
  }
  await tx.query(
    'UPDATE moderation_jobs SET status=$1,last_error=$2,locked_until=NULL WHERE id=$3',
    [result.decision === 'review' ? 'review' : 'done', result.reason, job.id],
  );
  const target = (
    await tx.query(
      job.revision_id
        ? 'SELECT content_id FROM revisions WHERE id=$1'
        : 'SELECT content_id FROM comments WHERE id=$1',
      [job.revision_id || job.comment_id],
    )
  )[0];
  if (target) await syncContentHonors(tx, target.content_id, actor);
}
async function readReviewInput(db: Queryable, job: Row) {
  let text = '',
    images: { id: string; mime: string }[] = [],
    unparsedFiles = false;
  if (job.revision_id) {
    const r = (await db.query('SELECT * FROM revisions WHERE id=$1', [job.revision_id]))[0];
    text = JSON.stringify(r.data);
    const files = await db.query(
      'SELECT a.* FROM attachments a JOIN revision_attachments ra ON a.id=ra.attachment_id WHERE ra.revision_id=$1',
      [r.id],
    );
    for (const f of files) {
      text += '\n文件名：' + f.original_name + '\n' + f.extracted_text;
      if (f.kind === 'image') images.push({ id: f.id, mime: f.mime });
      if (f.scan_status !== 'clean') unparsedFiles = true;
    }
  } else {
    text = (await db.query('SELECT body FROM comments WHERE id=$1', [job.comment_id]))[0].body;
    const files = await db.query(
      'SELECT a.* FROM attachments a JOIN comment_attachments ca ON ca.attachment_id=a.id WHERE ca.comment_id=$1',
      [job.comment_id],
    );
    for (const f of files) {
      text += '\n文件名：' + f.original_name + '\n' + f.extracted_text;
      if (f.kind === 'image') images.push({ id: f.id, mime: f.mime });
      if (f.scan_status !== 'clean' || f.deleted) unparsedFiles = true;
    }
  }
  return { text, images, unparsedFiles };
}

export async function matchModerationRules(db: Queryable, text: string): Promise<Decision | null> {
  const normalize = (s: string) =>
    s
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}\p{Cf}]/gu, '');
  const input = normalize(text);
  const rules = await db.query('SELECT * FROM moderation_rules WHERE enabled ORDER BY id');
  const matched = rules.filter((r) => {
    const phrase = normalize(r.phrase);
    return phrase.length >= 2 && input.includes(phrase);
  });
  if (!matched.length) return null;
  const rejecting = matched.filter((r) => r.action === 'reject');
  const relevant = (rejecting.length ? rejecting : matched).slice(0, 10);
  return {
    decision: rejecting.length ? 'rejected' : 'review',
    reason: relevant.map((r) => r.name + '：' + r.reason).join('；'),
    categories: [...new Set(relevant.map((r) => r.name))],
  };
}

export async function processJobs(ctx: AppContext, provider: ModerationProvider, batch = 5) {
  for (let n = 0; n < batch; n++) {
    const job = await ctx.db.transaction(
      async (tx) =>
        (
          await tx.query(
            "UPDATE moderation_jobs SET status='running',attempts=attempts+1,locked_until=now()+interval '90 seconds' WHERE id=(SELECT id FROM moderation_jobs WHERE (status='pending' AND available_at<=now()) OR (status='running' AND locked_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *",
          )
        )[0],
    );
    if (!job) return;
    try {
      const { text, images, unparsedFiles } = await readReviewInput(ctx.db, job);
      const matched = await matchModerationRules(ctx.db, text);
      let result: Decision;
      if (matched) result = matched;
      else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          result = await Promise.race([
            provider.review({ text, images, unparsedFiles, revisionDigest: job.digest }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('审核服务超时')), 30000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      await ctx.db.transaction(async (tx) => {
        const current = (
          await tx.query('SELECT * FROM moderation_jobs WHERE id=$1 FOR UPDATE', [job.id])
        )[0];
        if (current.status === 'running' && current.attempts === job.attempts)
          await applyDecision(tx, job, result, provider.name, null);
      });
    } catch (error) {
      await ctx.db.transaction(async (tx) => {
        await tx.query(
          "UPDATE moderation_jobs SET status=$1,available_at=now()+interval '30 seconds',locked_until=NULL,last_error=$2 WHERE id=$3 AND attempts=$4 AND status='running'",
          [
            job.attempts >= 3 ? 'failed' : 'pending',
            error instanceof Error ? error.message : '审核失败',
            job.id,
            job.attempts,
          ],
        );
        await tx.query(
          "INSERT INTO moderation_records(id,job_id,decision,reason,provider) VALUES($1,$2,'error',$3,$4)",
          [id(), job.id, '服务异常；保持待审核，可重试', provider.name],
        );
      });
    }
  }
}
export async function manualReview(
  ctx: AppContext,
  user: User,
  jobId: string,
  decision: 'approved' | 'rejected',
  reason = '',
  confirmContribution = false,
) {
  const reviewReason = reason.trim() || (decision === 'approved' ? '人工审核通过' : '');
  if (decision === 'rejected' && reviewReason.length < 5) fail(400, '请填写至少 5 个字的退回原因');
  return ctx.db.transaction(async (tx) => {
    const j = (await tx.query('SELECT * FROM moderation_jobs WHERE id=$1 FOR UPDATE', [jobId]))[0];
    if (!j) fail(404, '审核任务不存在');
    const target = j.revision_id
      ? (await tx.query('SELECT * FROM revisions WHERE id=$1 FOR UPDATE', [j.revision_id]))[0]
      : (await tx.query('SELECT * FROM comments WHERE id=$1 FOR UPDATE', [j.comment_id]))[0];
    if (!target || !(await canManage(tx, user, target.content_id))) fail(404, '审核任务不存在');
    if (j.status === 'done') fail(409, '该任务已完成');
    const content = (
      await tx.query('SELECT * FROM contents WHERE id=$1 FOR UPDATE', [target.content_id])
    )[0];
    if (
      !content ||
      ['deleted', 'withdrawn'].includes(content.state) ||
      target.digest !== j.digest ||
      (j.revision_id ? content.latest_revision_id !== target.id : target.status === 'deleted')
    )
      fail(409, '内容已变更或移除，请刷新审核队列');
    if (j.revision_id) {
      if (
        !(
          await tx.query(`SELECT r.id FROM revisions r WHERE r.id=$2 AND ${revisionManageSQL()}`, [
            user.id,
            target.id,
          ])
        ).length
      )
        fail(403, '新修订超出管理范围');
    }
    let approvedFiles = 0;
    if (decision === 'approved') {
      const files = await tx.query(
        j.revision_id
          ? 'SELECT a.* FROM attachments a JOIN revision_attachments ra ON ra.attachment_id=a.id WHERE ra.revision_id=$1 ORDER BY a.id FOR UPDATE OF a'
          : 'SELECT a.* FROM attachments a JOIN comment_attachments ca ON ca.attachment_id=a.id WHERE ca.comment_id=$1 ORDER BY a.id FOR UPDATE OF a',
        [target.id],
      );
      if (files.some((f) => f.deleted || f.scan_status === 'blocked'))
        fail(409, '关联文件已被阻止或删除，请移除或重新上传后再审核');
      for (const f of files) {
        if (f.scan_status === 'clean') continue;
        await tx.query(
          "UPDATE attachments SET scan_status='clean',scan_reason='随内容人工审核通过' WHERE id=$1",
          [f.id],
        );
        await audit(tx, user.id, 'file.review', f.id, {
          decision: 'clean',
          reason: '随内容人工审核通过',
          jobId,
          previousStatus: f.scan_status,
        });
        approvedFiles++;
      }
    }
    await applyDecision(
      tx,
      j,
      { decision, reason: reviewReason, categories: ['human-review'] },
      'manual',
      user.id,
    );
    if (decision === 'approved' && confirmContribution) {
      const contribution = (
        await tx.query(
          j.revision_id
            ? 'SELECT * FROM contributions WHERE content_id=$1 AND comment_id IS NULL'
            : 'SELECT * FROM contributions WHERE comment_id=$1',
          [j.revision_id ? target.content_id : target.id],
        )
      )[0];
      if (contribution) {
        await verifyContributionFiles(tx, contribution, ctx.dataDir);
        await syncContentHonors(tx, contribution.content_id, user.id);
        await assessContribution(
          tx,
          contribution.id,
          user.id,
          'confirmed',
          '随内容审核确认原创实用或资源完整可用',
        );
      }
    }
    await audit(tx, user.id, 'moderation.review', jobId, {
      decision,
      reason: reviewReason,
      approvedFiles,
    });
    return { approvedFiles };
  });
}
