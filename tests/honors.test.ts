import { beforeAll, afterAll, test, expect } from 'vitest';
import { openDatabase, migrate, type Database } from '../server/db';
import { id, hash } from '../server/core';
import { honorWeek, honorLevel } from '../server/honors-policy';
import {
  syncContentHonors,
  assessContribution,
  settleHonorWeeks,
  honorBoard,
} from '../server/honors-engine';
let db: Database, uid: string, admin: string, cat: string;
const now = new Date('2026-11-18T04:00:00Z');
beforeAll(async () => {
  db = await openDatabase();
  await migrate(db);
  uid = id();
  admin = id();
  cat = id();
  await db.query('INSERT INTO categories(id,name) VALUES($1,$1)', [cat]);
  for (const u of [uid, admin])
    await db.query(
      "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$1,$1,'unused',$2)",
      [u, u === admin ? 'admin' : 'member'],
    );
});
afterAll(async () => db.close());
test('图片回答按文件内容识别：不同图片有效，相同图片换上传 ID 不重复计分', async () => {
  const user = await newMember(),
    first = id(),
    second = id();
  async function imageAnswer(payload: string) {
    const p = await post('discussion', await newMember(), now),
      cm = id(),
      fid = id();
    const topic = (await db.query('SELECT author_id FROM contents WHERE id=$1', [p.cid]))[0];
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO comments(id,content_id,author_id,body,digest,status) VALUES($1,$2,$3,$4,$1,'approved')",
        [cm, p.cid, user, '![解答](/api/files/' + fid + ')'],
      );
      await tx.query(
        "INSERT INTO attachments(id,content_id,owner_id,original_name,storage_key,mime,size,kind,scan_status,content_hash) VALUES($1,$2,$3,'answer.webp',$1,'image/webp',10,'image','clean',$4)",
        [fid, p.cid, user, hash(payload)],
      );
      await tx.query('INSERT INTO comment_attachments(comment_id,attachment_id) VALUES($1,$2)', [
        cm,
        fid,
      ]);
      await tx.query(
        "INSERT INTO forum_topics(content_id,kind,resolved,accepted_comment_id,accepted_by,accepted_at) VALUES($1,'question',true,$2,$3,$4)",
        [p.cid, cm, topic.author_id, now],
      );
      await syncContentHonors(tx, p.cid, topic.author_id, now);
    });
    return (await db.query('SELECT * FROM contributions WHERE comment_id=$1', [cm]))[0];
  }
  expect((await imageAnswer(first)).points).toBe(20);
  expect((await imageAnswer(second)).points).toBe(20);
  expect((await imageAnswer(first)).points).toBe(0);
});
async function newMember() {
  const user = id();
  await db.query("INSERT INTO users(id,username,name,password_hash) VALUES($1,$1,$1,'unused')", [
    user,
  ]);
  return user;
}
async function answerFor(user: string, at: Date) {
  const p = await post('discussion', await newMember(), at),
    cm = id();
  const topic = (await db.query('SELECT author_id FROM contents WHERE id=$1', [p.cid]))[0];
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO comments(id,content_id,author_id,body,digest,status) VALUES($1,$2,$3,$1,$1,'approved')",
      [cm, p.cid, user],
    );
    await tx.query(
      "INSERT INTO forum_topics(content_id,kind,resolved,accepted_comment_id,accepted_by,accepted_at) VALUES($1,'question',true,$2,$3,$4)",
      [p.cid, cm, topic.author_id, at],
    );
    await syncContentHonors(tx, p.cid, topic.author_id, at);
  });
  return {
    ...p,
    cm,
    g: (await db.query('SELECT * FROM contributions WHERE comment_id=$1', [cm]))[0],
  };
}
async function post(type = 'experience', author = uid, at = now) {
  const cid = id(),
    rid = id();
  await db.transaction(async (tx) => {
    await tx.query('INSERT INTO contents(id,author_id,type,category_id) VALUES($1,$2,$3,$4)', [
      cid,
      author,
      type,
      cat,
    ]);
    await tx.query(
      "INSERT INTO revisions(id,content_id,number,data,digest,status,approved_at) VALUES($1,$2,1,$3,$1,'approved',$4)",
      [
        rid,
        cid,
        JSON.stringify({
          title: '真实实践',
          body: '独立实践 ' + cid,
          fields: { demoUrl: 'https://example.com/' + cid },
        }),
        at,
      ],
    );
    await tx.query(
      "UPDATE contents SET state='published',published_revision_id=$2,latest_revision_id=$2 WHERE id=$1",
      [cid, rid],
    );
    await syncContentHonors(tx, cid, null, at);
  });
  return {
    cid,
    rid,
    g: (await db.query('SELECT * FROM contributions WHERE content_id=$1', [cid]))[0],
  };
}
async function qualify(p: any, at = now) {
  await db.transaction((tx) =>
    assessContribution(tx, p.g.id, admin, 'confirmed', '已确认原创实践与实际结果', at),
  );
}
test('北京时间周边界、跨年与等级采用已确认阈值', () => {
  expect(honorWeek('2026-11-15T15:59:59Z')).toBe('2026-11-09');
  expect(honorWeek('2026-11-15T16:00:00Z')).toBe('2026-11-16');
  expect(honorWeek('2027-01-01T00:00:00Z')).toBe('2026-12-28');
  expect(honorLevel(60)).toMatchObject({ number: 2, remaining: 120 });
  expect(honorLevel(1800).next).toBeNull();
});
test('发布待确认、单贡献幂等、周上限及失效原周补位', async () => {
  const posts: any[] = [];
  for (let n = 0; n < 4; n++) {
    const p = await post();
    posts.push(p);
    expect(p.g.points).toBe(0);
    await qualify(p, new Date(+now + n * 1000));
  }
  await qualify(posts[0]);
  expect(
    (await db.query('SELECT sum(points)::int n FROM contributions WHERE user_id=$1', [uid]))[0].n,
  ).toBe(60);
  expect(
    (await db.query('SELECT count(*)::int n FROM points_ledger WHERE user_id=$1', [uid]))[0].n,
  ).toBe(3);
  await db.transaction(async (tx) => {
    await tx.query("UPDATE contents SET state='deleted' WHERE id=$1", [posts[0].cid]);
    await syncContentHonors(tx, posts[0].cid, admin, new Date('2026-11-25T04:00Z'));
  });
  expect(
    (await db.query('SELECT points FROM contributions WHERE id=$1', [posts[3].g.id]))[0].points,
  ).toBe(20);
  const reversal = (
    await db.query(
      'SELECT *,week_start::text AS week_start FROM points_ledger WHERE contribution_id=$1 AND delta<0',
      [posts[0].g.id],
    )
  )[0];
  expect(reversal.week_start).toBe('2026-11-16');
  expect(reversal.reverses_id).toBeTruthy();
});
test('历史周榜保存并列与更正版本，未来周不混入', async () => {
  const other = id();
  await db.query("INSERT INTO users(id,username,name,password_hash) VALUES($1,$1,$1,'unused')", [
    other,
  ]);
  const p = await post('project', other);
  await qualify(p);
  const q = await post('project', uid);
  await qualify(q);
  await db.transaction((tx) => settleHonorWeeks(tx, new Date('2026-11-23T16:00Z')));
  let board = await honorBoard(db, '2026-11-16', 'resource');
  expect(board.items.map((r: any) => r.rank)).toEqual([1, 1]);
  await db.transaction(async (tx) => {
    await tx.query("UPDATE contents SET state='withdrawn' WHERE id=$1", [p.cid]);
    await syncContentHonors(tx, p.cid, admin, new Date('2026-11-24T04:00Z'));
  });
  board = await honorBoard(db, '2026-11-16', 'resource');
  expect(board.items).toHaveLength(1);
  expect(
    (
      await db.query('SELECT count(*)::int n FROM leaderboard_periods WHERE week_start=$1', [
        '2026-11-16',
      ])
    )[0].n,
  ).toBeGreaterThan(1);
});
test('三个类别独立封顶180分，并发认定与重复回调不突破上限', async () => {
  const user = await newMember(),
    posts = [];
  for (const type of ['experience', 'project'])
    for (let i = 0; i < 4; i++) posts.push(await post(type, user));
  await Promise.all(posts.flatMap((p) => [qualify(p), qualify(p)]));
  for (let i = 0; i < 4; i++) await answerFor(user, now);
  const sums = await db.query(
    'SELECT category,sum(points)::int points FROM contributions WHERE user_id=$1 GROUP BY category ORDER BY category',
    [user],
  );
  expect(sums.map((s) => s.points)).toEqual([60, 60, 60]);
  expect(
    (await db.query('SELECT sum(delta)::int n FROM points_ledger WHERE user_id=$1', [user]))[0].n,
  ).toBe(180);
});
test('跨周不清累计分，取消采纳后跨周恢复仍归原周', async () => {
  const user = await newMember(),
    first = await answerFor(user, new Date('2026-11-22T15:59:59Z'));
  await db.transaction(async (tx) => {
    await tx.query('UPDATE forum_topics SET accepted_comment_id=NULL WHERE content_id=$1', [
      first.cid,
    ]);
    await syncContentHonors(tx, first.cid, admin, new Date('2026-11-22T16:01Z'));
  });
  await db.transaction(async (tx) => {
    await tx.query('UPDATE forum_topics SET accepted_comment_id=$2 WHERE content_id=$1', [
      first.cid,
      first.cm,
    ]);
    await syncContentHonors(tx, first.cid, admin, new Date('2026-11-23T00:00Z'));
  });
  const second = await post('experience', user);
  await qualify(second, new Date('2026-11-22T16:00:00Z'));
  const g = (
    await db.query('SELECT week_start::text week,points FROM contributions WHERE id=$1', [
      first.g.id,
    ])
  )[0];
  expect(g).toEqual({ week: '2026-11-16', points: 20 });
  expect(
    (await db.query('SELECT sum(delta)::int n FROM points_ledger WHERE user_id=$1', [user]))[0].n,
  ).toBe(40);
  expect(
    (
      await db.query('SELECT week_start::text week FROM contributions WHERE id=$1', [second.g.id])
    )[0].week,
  ).toBe('2026-11-23');
});
test('五枚自动勋章均按有效贡献授予，替代依据保留、失效重算且保留历史', async () => {
  const user = await newMember(),
    cases: any[] = [];
  for (let i = 0; i < 4; i++) {
    const at = new Date(Date.parse('2026-11-23T04:00Z') + i * 7 * 86400000),
      p = await post('experience', user, at);
    await qualify(p, at);
    cases.push(p);
  }
  const resource = await post('project', user);
  await qualify(resource);
  const answer = await answerFor(user, now);
  const active = () =>
    db.query('SELECT * FROM badge_awards WHERE user_id=$1 AND revoked_at IS NULL', [user]);
  expect((await active()).map((b) => b.badge_id).sort()).toEqual([
    'all-round',
    'consistent',
    'first-answer',
    'first-case',
    'first-resource',
  ]);
  await db.transaction((tx) =>
    syncContentHonors(tx, cases[0].cid, null, new Date('2027-01-04T04:00Z')),
  );
  expect((await active()).some((b) => b.badge_id === 'consistent')).toBe(true);
  await db.transaction((tx) =>
    assessContribution(
      tx,
      cases[1].g.id,
      admin,
      'rejected',
      '案例实际无效撤回贡献',
      new Date('2027-01-05T04:00Z'),
    ),
  );
  expect((await active()).some((b) => b.badge_id === 'consistent')).toBe(false);
  expect((await active()).some((b) => b.badge_id === 'first-case')).toBe(true);
  await db.transaction((tx) =>
    assessContribution(
      tx,
      resource.g.id,
      admin,
      'rejected',
      '资源实际无效撤回贡献',
      new Date('2027-01-05T04:00Z'),
    ),
  );
  expect((await active()).map((b) => b.badge_id)).not.toContain('all-round');
  expect((await active()).map((b) => b.badge_id)).not.toContain('first-resource');
  expect(
    (
      await db.query(
        'SELECT count(*)::int n FROM badge_awards WHERE user_id=$1 AND revoked_at IS NOT NULL',
        [user],
      )
    )[0].n,
  ).toBe(3);
});
test('恢复较早贡献会替换补位贡献，连续撤回恢复不会产生负数或重复反转', async () => {
  const user = await newMember(),
    posts: any[] = [];
  for (let i = 0; i < 4; i++) {
    const p = await post('experience', user);
    await qualify(p, new Date(+now + i * 1000));
    posts.push(p);
  }
  for (let i = 0; i < 7; i++) {
    await db.transaction((tx) =>
      assessContribution(tx, posts[0].g.id, admin, 'rejected', '撤回本次贡献资格', now),
    );
    await qualify(posts[0], now);
  }
  expect(
    (await db.query('SELECT points FROM contributions WHERE id=$1', [posts[3].g.id]))[0].points,
  ).toBe(0);
  expect(
    (await db.query('SELECT sum(delta)::int n FROM points_ledger WHERE user_id=$1', [user]))[0].n,
  ).toBe(60);
});
