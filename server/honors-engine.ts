import type { Queryable, Row } from './db.js';
import { id, hash, audit, fail, notify } from './core.js';
import { honorLevel, honorWeek, nextHonorWeek, WEEK_MS } from './honors-policy.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// All callers use a transaction. Source rows are locked BEFORE this lock;
// no source-row lock is taken afterwards. One small-community lock also protects
// duplicate detection, cross-category badges and historical snapshot revisions.
export async function lockHonors(tx: Queryable) {
  return (await tx.query("SELECT value FROM settings WHERE key='honors' FOR UPDATE"))[0].value;
}
const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/<[^>]+>/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
function fingerprint(data: Row | string, files: Row[] = []) {
  const stableFiles = (text: string) =>
    text.replace(
      /\/api\/files\/([0-9a-f-]+)/g,
      (_, fileId) => '[file:' + (files.find((f) => f.id === fileId)?.content_hash || fileId) + ']',
    );
  return hash(
    normalize(
      stableFiles(
        typeof data === 'string'
          ? data
          : [
              data.body,
              ...Object.entries(data.fields || {})
                .filter(([k]) => !['version', 'changelog', 'members'].includes(k))
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([, v]) => v),
            ].join('\n'),
      ),
    ),
  );
}
async function filesFor(tx: Queryable, g: Row) {
  return tx.query(
    g.comment_id
      ? 'SELECT a.* FROM attachments a JOIN comment_attachments ca ON ca.attachment_id=a.id WHERE ca.comment_id=$1'
      : 'SELECT a.* FROM attachments a JOIN revision_attachments ra ON ra.attachment_id=a.id WHERE ra.revision_id=$1',
    [g.comment_id || g.revision_id],
  );
}
export async function verifyContributionFiles(tx: Queryable, g: Row, dataDir: string) {
  for (const f of await filesFor(tx, g)) {
    if (f.deleted || f.scan_status !== 'clean') fail(409, '关联文件尚未通过安全检查');
    if (!/^[a-f0-9-]{36}$/.test(f.storage_key)) fail(409, '文件存储信息异常');
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(dataDir, 'uploads', f.storage_key));
    } catch {
      fail(409, '关联文件无法读取，请先修复资源');
    }
    if (bytes.length !== Number(f.size)) fail(409, '关联文件大小异常，请先修复资源');
    const digest = hash(bytes);
    if (f.content_hash && f.content_hash !== digest) fail(409, '关联文件校验失败');
    if (!f.content_hash)
      await tx.query('UPDATE attachments SET content_hash=$2 WHERE id=$1', [f.id, digest]);
  }
}
async function validity(tx: Queryable, g: Row): Promise<string> {
  if (g.qualification !== 'confirmed')
    return g.qualification === 'rejected'
      ? g.assessment_reason || '贡献资格已撤回'
      : '等待贡献资格确认';
  const c = (
    await tx.query(
      'SELECT c.*,r.data FROM contents c LEFT JOIN revisions r ON r.id=c.published_revision_id WHERE c.id=$1',
      [g.content_id],
    )
  )[0];
  if (!c || c.state !== 'published') return '来源已删除或下架';
  if (g.comment_id) {
    const cm = (await tx.query('SELECT * FROM comments WHERE id=$1', [g.comment_id]))[0];
    const topic = (
      await tx.query('SELECT * FROM forum_topics WHERE content_id=$1', [g.content_id])
    )[0];
    if (!cm || cm.status !== 'approved') return '回答未通过审核或已删除';
    if (cm.author_id === c.author_id) return '自问自答不计分';
    if (topic?.accepted_comment_id !== cm.id || !topic.resolved) return '采纳已撤销或更换';
    if (topic.accepted_by !== c.author_id) return '须由提问者本人确认采纳';
    if (
      topic.related_content_id &&
      !(
        await tx.query("SELECT id FROM contents WHERE id=$1 AND state='published'", [
          topic.related_content_id,
        ])
      ).length
    )
      return '关联资源已删除或下架';
  } else if (c.published_revision_id !== g.revision_id) return '公开版本已变化，等待重新确认';
  const files = await filesFor(tx, g);
  if (files.some((f) => f.deleted || f.scan_status !== 'clean'))
    return '关联文件已失效或未通过安全检查';
  if (
    g.category === 'resource' &&
    !files.some((f) => f.kind === 'resource') &&
    !c.data?.fields?.demoUrl &&
    !c.data?.fields?.repoUrl
  )
    return '资源缺少可用链接或文件';
  return '';
}
async function duplicate(tx: Queryable, g: Row) {
  const rows = await tx.query(
    "SELECT g.id FROM contributions g JOIN contribution_signatures s ON s.contribution_id=g.id WHERE g.id<>$1 AND (g.qualification='confirmed' OR g.first_valid_at IS NOT NULL) AND ((s.kind='text' AND s.value=$2) OR ($3='resource' AND s.kind='resource' AND s.value=ANY($4::text[]))) LIMIT 1",
    [g.id, g.fingerprint, g.category, g.file_hashes || []],
  );
  return rows.length > 0;
}

export async function syncContentHonors(
  tx: Queryable,
  cid: string,
  actor: string | null = null,
  at = new Date(),
) {
  await lockHonors(tx);
  const c = (
    await tx.query(
      'SELECT c.*,r.data FROM contents c LEFT JOIN revisions r ON r.id=c.published_revision_id WHERE c.id=$1',
      [cid],
    )
  )[0];
  if (!c) return;
  if (
    c.honors_eligible &&
    c.state === 'published' &&
    ['experience', 'project', 'skill'].includes(c.type)
  ) {
    const current = (
      await tx.query('SELECT * FROM contributions WHERE content_id=$1 AND comment_id IS NULL', [
        cid,
      ])
    )[0];
    const files = await tx.query(
      'SELECT a.id,a.kind,a.content_hash FROM attachments a JOIN revision_attachments ra ON ra.attachment_id=a.id WHERE ra.revision_id=$1 AND NOT a.deleted',
      [c.published_revision_id],
    );
    const urls = [c.data?.fields?.demoUrl, c.data?.fields?.repoUrl]
      .filter(Boolean)
      .map((u: string) => 'url:' + u.replace(/\/$/, ''));
    const resourceHashes = [
      ...new Set(
        files
          .filter((f) => f.kind === 'resource')
          .map((f) => f.content_hash)
          .filter(Boolean),
      ),
    ].sort();
    const hashes = [
      ...(resourceHashes.length ? ['files:' + hash(resourceHashes.join(':'))] : []),
      ...urls,
    ];
    if (!current)
      await tx.query(
        'INSERT INTO contributions(id,user_id,category,content_id,revision_id,fingerprint,file_hashes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id(),
          c.author_id,
          c.type === 'experience' ? 'case' : 'resource',
          cid,
          c.published_revision_id,
          fingerprint(c.data, files),
          JSON.stringify(hashes),
          at,
        ],
      );
    else if (current.revision_id !== c.published_revision_id)
      await tx.query(
        "UPDATE contributions SET revision_id=$2,qualification='pending',fingerprint=$3,file_hashes=$4,reason='公开版本已变化，等待重新确认',updated_at=$5 WHERE id=$1",
        [
          current.id,
          c.published_revision_id,
          fingerprint(c.data, files),
          JSON.stringify(hashes),
          at,
        ],
      );
    else
      await tx.query('UPDATE contributions SET file_hashes=$2,fingerprint=$3 WHERE id=$1', [
        current.id,
        JSON.stringify(hashes),
        fingerprint(c.data, files),
      ]);
  }
  const topic = (await tx.query('SELECT * FROM forum_topics WHERE content_id=$1', [cid]))[0];
  if (topic?.kind === 'question' && topic.accepted_comment_id) {
    const cm = (
      await tx.query('SELECT * FROM comments WHERE id=$1', [topic.accepted_comment_id])
    )[0];
    if (cm?.honors_eligible && cm.author_id !== c.author_id) {
      const exempt =
        (
          await tx.query(
            "SELECT j.id FROM moderation_jobs j WHERE j.comment_id=$1 AND EXISTS(SELECT 1 FROM moderation_records m WHERE m.job_id=j.id AND m.provider='account-exemption' AND m.decision='approved') AND NOT EXISTS(SELECT 1 FROM moderation_records m WHERE m.job_id=j.id AND m.provider<>'account-exemption' AND m.decision='approved')",
            [cm.id],
          )
        ).length > 0;
      await tx.query(
        "INSERT INTO contributions(id,user_id,category,content_id,comment_id,fingerprint,qualification,created_at) VALUES($1,$2,'answer',$3,$4,$5,$6,$7) ON CONFLICT(comment_id) DO NOTHING",
        [
          id(),
          cm.author_id,
          cid,
          cm.id,
          fingerprint(cm.body, await filesFor(tx, { comment_id: cm.id })),
          exempt ? 'pending' : 'confirmed',
          at,
        ],
      );
      const g = (await tx.query('SELECT * FROM contributions WHERE comment_id=$1', [cm.id]))[0];
      if (g.qualification === 'confirmed' && !g.first_valid_at && (await duplicate(tx, g)))
        await tx.query(
          "UPDATE contributions SET qualification='rejected',assessment_reason='重复回答不重复计分' WHERE id=$1",
          [g.id],
        );
    }
  }
  const changed = await tx.query('SELECT * FROM contributions WHERE content_id=$1', [cid]);
  for (const g of changed) {
    for (const [kind, value] of [
      ['text', g.fingerprint],
      ...(g.category === 'resource'
        ? (g.file_hashes || []).map((v: string) => ['resource', v])
        : []),
    ])
      await tx.query(
        'INSERT INTO contribution_signatures(contribution_id,kind,value) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [g.id, kind, value],
      );
    const reason = await validity(tx, g),
      valid = !reason;
    await tx.query(
      'UPDATE contributions SET valid=$2,reason=$3,first_valid_at=CASE WHEN $2 THEN COALESCE(first_valid_at,$4) ELSE first_valid_at END,week_start=CASE WHEN $2 THEN COALESCE(week_start,$5::date) ELSE week_start END,updated_at=$4 WHERE id=$1',
      [g.id, valid, reason || '有效贡献', at, honorWeek(at)],
    );
  }
  for (const uid of [...new Set(changed.map((g) => g.user_id))])
    await reconcileUser(tx, uid, actor, at);
  await settleHonorWeeks(tx, at);
  if (c.type !== 'discussion')
    for (const related of await tx.query(
      'SELECT content_id FROM forum_topics WHERE related_content_id=$1',
      [cid],
    ))
      await syncContentHonors(tx, related.content_id, actor, at);
}

export async function assessContribution(
  tx: Queryable,
  gid: string,
  actor: string,
  decision: 'confirmed' | 'rejected',
  reason: string,
  at = new Date(),
) {
  await lockHonors(tx);
  const g = (await tx.query('SELECT * FROM contributions WHERE id=$1', [gid]))[0];
  if (!g) fail(404, '贡献记录不存在');
  if (decision === 'confirmed') {
    const invalid = await validity(tx, { ...g, qualification: 'confirmed' });
    if (invalid) fail(409, invalid);
    if (await duplicate(tx, g)) fail(409, '存在相同正文、资源链接或文件的贡献，不能重复计分');
  }
  if (g.qualification !== decision || g.assessment_reason !== reason) {
    await tx.query(
      'UPDATE contributions SET qualification=$2,assessment_reason=$3,assessed_by=$4,assessed_at=$5 WHERE id=$1',
      [gid, decision, reason, actor, at],
    );
    await audit(tx, actor, 'honors.assess', gid, {
      decision,
      reason,
      revisionId: g.revision_id,
      commentId: g.comment_id,
    });
  }
  await syncContentHonors(tx, g.content_id, actor, at);
}

async function reconcileUser(tx: Queryable, uid: string, actor: string | null, at: Date) {
  const all = await tx.query(
    'SELECT *,week_start::text AS week_start FROM contributions WHERE user_id=$1 ORDER BY first_valid_at NULLS LAST,id',
    [uid],
  );
  const counts = new Map<string, number>();
  for (const g of all) {
    if (!g.week_start) continue;
    const key = g.week_start + ':' + g.category,
      n = counts.get(key) || 0;
    const target = g.valid && n < 3 ? 20 : 0;
    if (target) counts.set(key, n + 1);
    else if (!counts.has(key)) counts.set(key, n);
    if (g.points === target) continue;
    const delta = target - g.points,
      transition = g.transition + 1;
    const last =
      delta < 0
        ? (
            await tx.query(
              'SELECT l.id FROM points_ledger l WHERE l.contribution_id=$1 AND l.delta=20 AND NOT EXISTS(SELECT 1 FROM points_ledger r WHERE r.reverses_id=l.id) LIMIT 1',
              [g.id],
            )
          )[0]
        : null;
    const reason =
      delta < 0
        ? g.valid
          ? '原周有效名额重新计算'
          : g.reason
        : g.transition
          ? '原周有效贡献补位或恢复'
          : '有效贡献计分';
    await tx.query(
      'INSERT INTO points_ledger(id,contribution_id,user_id,category,delta,week_start,reason,actor_id,operation_key,reverses_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        id(),
        g.id,
        uid,
        g.category,
        delta,
        g.week_start,
        reason,
        actor,
        g.id + ':' + transition,
        last?.id || null,
        at,
      ],
    );
    await tx.query('UPDATE contributions SET points=$2,transition=$3 WHERE id=$1', [
      g.id,
      target,
      transition,
    ]);
  }
  for (const [key, n] of counts) {
    const [week, category] = key.split(':');
    await tx.query(
      'INSERT INTO weekly_contribution_buckets(user_id,week_start,category,counted,points) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,week_start,category) DO UPDATE SET counted=EXCLUDED.counted,points=EXCLUDED.points',
      [uid, week, category, n, n * 20],
    );
  }
  await reconcileBadges(
    tx,
    uid,
    all.filter((g) => g.valid),
    actor,
    at,
  );
}

async function reconcileBadges(
  tx: Queryable,
  uid: string,
  valid: Row[],
  actor: string | null,
  at: Date,
) {
  const eligible = new Map<string, string[]>();
  for (const kind of ['case', 'resource', 'answer']) {
    const g = valid.find((g) => g.category === kind);
    if (g) eligible.set('first-' + kind, [g.id]);
  }
  if (eligible.size === 3) eligible.set('all-round', [...eligible.values()].flat());
  const weeks = [...new Set(valid.map((g) => g.week_start as string))].sort();
  for (let i = 3; i < weeks.length; i++)
    if (Date.parse(weeks[i]) - Date.parse(weeks[i - 3]) === 3 * WEEK_MS) {
      eligible.set(
        'consistent',
        weeks.slice(i - 3, i + 1).map((w) => valid.find((g) => g.week_start === w)!.id),
      );
      break;
    }
  const active = await tx.query(
    'SELECT a.*,d.mode FROM badge_awards a JOIN badge_definitions d ON d.id=a.badge_id WHERE a.user_id=$1 AND a.revoked_at IS NULL',
    [uid],
  );
  for (const a of active) {
    if (a.mode === 'manual') {
      if (
        a.evidence.length &&
        a.evidence.some((e: string) => !valid.some((g) => g.id === e)) &&
        !a.needs_review
      ) {
        await tx.query('UPDATE badge_awards SET needs_review=true WHERE id=$1', [a.id]);
        await audit(tx, null, 'honors.badge-needs-review', a.id, { reason: '授予依据失效' });
      }
    } else if (!eligible.has(a.badge_id)) {
      await tx.query(
        "UPDATE badge_awards SET revoked_at=$2,revoke_reason='基础贡献失效，不再满足条件',revoked_by=$3 WHERE id=$1",
        [a.id, at, actor],
      );
      await audit(tx, actor, 'honors.badge-revoke', a.id, { automatic: true });
    } else
      await tx.query('UPDATE badge_awards SET evidence=$2 WHERE id=$1', [
        a.id,
        JSON.stringify(eligible.get(a.badge_id)),
      ]);
  }
  for (const [badge, evidence] of eligible)
    if (!active.some((a) => a.badge_id === badge)) {
      const aid = id();
      await tx.query(
        'INSERT INTO badge_awards(id,user_id,badge_id,reason,evidence,awarded_at) VALUES($1,$2,$3,$4,$5,$6)',
        [aid, uid, badge, '满足自动授予条件', JSON.stringify(evidence), at],
      );
      await audit(tx, null, 'honors.badge-award', aid, { badge, userId: uid, automatic: true });
      await notify(tx, uid, null, 'honors', '获得新勋章，前往「我的贡献」查看');
    }
}

export async function liveHonorBoard(tx: Queryable, week: string, board: string) {
  return tx.query(
    `WITH totals AS (SELECT user_id,sum(delta)::int points FROM points_ledger WHERE week_start=$1 AND ($2='all' OR category=$2) GROUP BY user_id HAVING sum(delta)>0) SELECT user_id,points,rank() OVER(ORDER BY points DESC)::int rank FROM totals ORDER BY points DESC,user_id`,
    [week, board],
  );
}
export async function settleHonorWeeks(tx: Queryable, at = new Date()) {
  const rules = await lockHonors(tx),
    current = honorWeek(at);
  for (let week = honorWeek(rules.enabledAt); week < current; week = nextHonorWeek(week)) {
    const entries: Row[] = [];
    for (const board of ['all', 'case', 'resource', 'answer'])
      for (const r of await liveHonorBoard(tx, week, board)) entries.push({ ...r, board });
    const digest = hash(JSON.stringify(entries));
    const previous = (
      await tx.query(
        'SELECT * FROM leaderboard_periods WHERE week_start=$1 ORDER BY version DESC LIMIT 1',
        [week],
      )
    )[0];
    if (previous?.digest === digest) continue;
    const pid = id();
    await tx.query(
      'INSERT INTO leaderboard_periods(id,week_start,version,digest,reason,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [
        pid,
        week,
        (previous?.version || 0) + 1,
        digest,
        previous ? '贡献变更后更正' : '自然周结算',
        at,
      ],
    );
    for (const r of entries)
      await tx.query(
        'INSERT INTO leaderboard_entries(period_id,board,user_id,points,rank) VALUES($1,$2,$3,$4,$5)',
        [pid, r.board, r.user_id, r.points, r.rank],
      );
    await audit(tx, null, 'honors.week-snapshot', pid, {
      week,
      version: (previous?.version || 0) + 1,
      reason: previous ? '贡献变更后更正' : '自然周结算',
    });
  }
}
export async function honorBoard(tx: Queryable, week: string, board: string, version?: number) {
  const period = (
    await tx.query(
      'SELECT * FROM leaderboard_periods WHERE week_start=$1 AND ($2::int IS NULL OR version=$2) ORDER BY version DESC LIMIT 1',
      [week, version || null],
    )
  )[0];
  if (version && !period) fail(404, '该周榜版本不存在');
  const rows = period
    ? await tx.query(
        'SELECT user_id,points,rank FROM leaderboard_entries WHERE period_id=$1 AND board=$2 ORDER BY points DESC,user_id',
        [period.id, board],
      )
    : await liveHonorBoard(tx, week, board);
  const users = rows.length
    ? await tx.query('SELECT id,name,avatar_version FROM users WHERE id=ANY($1::text[])', [
        rows.map((r) => r.user_id),
      ])
    : [];
  return {
    week,
    nextWeek: nextHonorWeek(week),
    board,
    version: period?.version || null,
    correctedAt: period?.version > 1 ? period.created_at : null,
    items: rows.map((r) => ({ ...r, ...users.find((u) => u.id === r.user_id) })),
  };
}
export async function honorSummaries(tx: Queryable, ids: string[]) {
  const unique = [...new Set(ids)].filter(Boolean),
    result: Record<string, any> = {};
  if (!unique.length) return result;
  const totals = await tx.query(
    'SELECT user_id,sum(delta)::int total FROM points_ledger WHERE user_id=ANY($1::text[]) GROUP BY user_id',
    [unique],
  );
  const badges = await tx.query(
    'SELECT a.id,a.user_id,a.awarded_at,a.reason,a.needs_review,d.* FROM badge_awards a JOIN badge_definitions d ON d.id=a.badge_id WHERE a.user_id=ANY($1::text[]) AND a.revoked_at IS NULL ORDER BY d.position',
    [unique],
  );
  for (const uid of unique)
    result[uid] = {
      level: honorLevel(totals.find((t) => t.user_id === uid)?.total || 0),
      badges: badges.filter((b) => b.user_id === uid),
    };
  return result;
}
