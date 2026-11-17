import { beforeAll, beforeEach, afterEach, afterAll, test, expect } from 'vitest';
import { openDatabase, migrate, type Database } from '../server/db';
import { buildApp } from '../server/app';
import { hash, id, passwordHash, type AppContext } from '../server/core';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
let db: Database, app: Awaited<ReturnType<typeof buildApp>>, ctx: AppContext;
const origin = 'https://community.test',
  category = id(),
  outsideCategory = id();
let admin: any, member: any, mod: any, encoded: string;
async function account(role: string) {
  const uid = id(),
    raw = id(),
    csrf = id();
  await db.query('INSERT INTO users(id,username,name,role,password_hash) VALUES($1,$1,$2,$3,$4)', [
    uid,
    '审核测试',
    role,
    encoded,
  ]);
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
    [hash(raw), uid, csrf],
  );
  return { id: uid, headers: { origin, cookie: 'session=' + raw, 'x-csrf-token': csrf } };
}
beforeAll(async () => {
  db = await openDatabase();
  await migrate(db);
  encoded = await passwordHash('Review123');
  await db.query("INSERT INTO categories(id,name) VALUES($1,'审核测试'),($2,'范围外')", [
    category,
    outsideCategory,
  ]);
  ctx = {
    db,
    origin,
    production: true,
    provider: 'none',
    dataDir: 'work/bulk-review-test',
    clamPort: 3310,
  };
});
beforeEach(async () => {
  admin = await account('admin');
  member = await account('member');
  mod = await account('moderator');
  await db.query('INSERT INTO moderator_scopes(id,user_id,category_id) VALUES($1,$2,$3)', [
    id(),
    mod.id,
    category,
  ]);
  app = await buildApp(ctx);
  await app.ready();
});
afterEach(async () => {
  await app.close();
});
afterAll(async () => {
  await db?.close();
});
async function content(files = 0, body = '本次项目的实践步骤与结果说明', cat = category) {
  const created = await app.inject({
    method: 'POST',
    url: '/api/contents',
    headers: member.headers,
    payload: { type: 'project', categoryId: cat },
  });
  expect(created.statusCode).toBe(201);
  const cid = created.json().id;
  const attachments: string[] = [];
  for (let i = 0; i < files; i++) {
    const fid = id();
    attachments.push(fid);
    await db.query(
      "INSERT INTO attachments(id,content_id,owner_id,original_name,storage_key,mime,size,kind,scan_status) VALUES($1,$2,$3,'readme.txt',$1,'text/plain',20,'resource','review')",
      [fid, cid, member.id],
    );
  }
  const data = {
    title: '人工审核项目',
    summary: '项目执行过程和结果的摘要',
    body,
    categoryId: cat,
    attachments,
    visibility: 'company',
    departments: [],
  };
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/contents/' + cid,
    headers: member.headers,
    payload: { data, submit: true, baseRevisionId: null },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const rid = saved.json().revisionId;
  const job = (await db.query('SELECT id FROM moderation_jobs WHERE revision_id=$1', [rid]))[0];
  return { cid, rid, job: job.id, attachments, data };
}
test('审核任务包含正文绑定文件，版主可原位查看但不能跨任务或越权，预览不计下载', async () => {
  const c = await content(1),
    other = await content(1, undefined, outsideCategory);
  const fid = c.attachments[0];
  await mkdir(ctx.dataDir + '/uploads', { recursive: true });
  await writeFile(ctx.dataDir + '/uploads/' + fid, 'review-file');
  const list = await app.inject({ url: '/api/admin/moderation?limit=50', headers: mod.headers });
  const job = list.json().items.find((j: any) => j.id === c.job);
  expect(job.files).toEqual([
    expect.objectContaining({ id: fid, scan_status: 'review', mime: 'text/plain' }),
  ]);
  const url = `/api/admin/moderation/${c.job}/files/${fid}`;
  const read = await app.inject({ url, headers: mod.headers });
  expect(read.statusCode, read.body).toBe(200);
  expect(read.body).toBe('review-file');
  expect(read.headers['content-disposition']).toContain('attachment');
  expect(read.headers['cache-control']).toBe('private, no-store');
  expect(
    (await app.inject({ url: '/api/files/' + fid + '?revision=' + c.rid, headers: mod.headers }))
      .statusCode,
  ).toBe(423);
  expect((await app.inject({ url, headers: member.headers })).statusCode).toBe(403);
  expect(
    (
      await app.inject({
        url: `/api/admin/moderation/${c.job}/files/${other.attachments[0]}`,
        headers: admin.headers,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: `/api/admin/moderation/${other.job}/files/${other.attachments[0]}`,
        headers: mod.headers,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    await db.query('SELECT id FROM download_events WHERE attachment_id=$1', [fid]),
  ).toHaveLength(0);
  await db.query(
    "UPDATE revisions SET data=jsonb_set(data,'{categoryId}',to_jsonb($1::text)) WHERE id=$2",
    [outsideCategory, c.rid],
  );
  expect((await app.inject({ url, headers: mod.headers })).statusCode).toBe(404);
  await db.query("UPDATE contents SET state='deleted' WHERE id=$1", [c.cid]);
  expect((await app.inject({ url, headers: admin.headers })).statusCode).toBe(404);
});
const single = (job: string, payload: any = { decision: 'approved' }, actor = admin) =>
  app.inject({
    method: 'POST',
    url: '/api/admin/moderation/' + job + '/review',
    headers: actor.headers,
    payload,
  });
const batch = (jobIds: string[], decision = 'approved', reason?: string, actor = admin) =>
  app.inject({
    method: 'POST',
    url: '/api/admin/moderation/batch-review',
    headers: actor.headers,
    payload: { jobIds, decision, ...(reason === undefined ? {} : { reason }) },
  });
const file = async (fid: string) =>
  (await db.query('SELECT * FROM attachments WHERE id=$1', [fid]))[0];
const state = async (cid: string) =>
  (await db.query('SELECT state FROM contents WHERE id=$1', [cid]))[0].state;

test('封面、正文图片及回复图片都在各自审核任务中预览并一起通过', async () => {
  const c = await content(2);
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c22' } })
    .webp()
    .toBuffer();
  await mkdir(ctx.dataDir + '/uploads', { recursive: true });
  for (const fid of c.attachments) {
    await db.query(
      "UPDATE attachments SET kind='image',mime='image/webp',original_name='图片.webp' WHERE id=$1",
      [fid],
    );
    await writeFile(ctx.dataDir + '/uploads/' + fid, image);
  }
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/contents/' + c.cid,
    headers: member.headers,
    payload: {
      data: {
        ...c.data,
        attachments: [],
        coverId: c.attachments[0],
        body: '正文中的图片 ![图片](/api/files/' + c.attachments[1] + ')',
      },
      baseRevisionId: c.rid,
      submit: true,
    },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const job = (
    await db.query('SELECT id FROM moderation_jobs WHERE revision_id=$1', [saved.json().revisionId])
  )[0].id;
  const listed = (await app.inject({ url: '/api/admin/moderation?limit=50', headers: mod.headers }))
    .json()
    .items.find((j: any) => j.id === job);
  expect(listed.files).toHaveLength(2);
  for (const fid of c.attachments) {
    const read = await app.inject({
      url: `/api/admin/moderation/${job}/files/${fid}`,
      headers: mod.headers,
    });
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-type']).toBe('image/webp');
    expect(read.headers['content-disposition']).toContain('inline');
  }
  expect(
    (
      await app.inject({
        url: `/api/admin/moderation/${c.job}/files/${c.attachments[0]}`,
        headers: admin.headers,
      })
    ).statusCode,
  ).toBe(404);
  expect((await single(job, undefined, mod)).json().approvedFiles).toBe(2);
  const fid = id();
  await db.query(
    "INSERT INTO attachments(id,content_id,owner_id,original_name,storage_key,mime,size,kind,scan_status,purpose) VALUES($1,$2,$3,'回复.webp',$1,'image/webp',$4,'image','review','comment')",
    [fid, c.cid, member.id, image.length],
  );
  await writeFile(ctx.dataDir + '/uploads/' + fid, image);
  const comment = await app.inject({
    method: 'POST',
    url: `/api/contents/${c.cid}/comments`,
    headers: member.headers,
    payload: { body: '回复图片', attachments: [fid] },
  });
  expect(comment.statusCode, comment.body).toBe(201);
  const replyJob = (
    await db.query('SELECT id FROM moderation_jobs WHERE comment_id=$1', [comment.json().id])
  )[0].id;
  expect(
    (
      await app.inject({
        url: `/api/admin/moderation/${replyJob}/files/${fid}`,
        headers: mod.headers,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: `/api/admin/moderation/${job}/files/${fid}`, headers: mod.headers }))
      .statusCode,
  ).toBe(404);
  expect((await single(replyJob, undefined, mod)).json().approvedFiles).toBe(1);
  expect((await file(fid)).scan_status).toBe('clean');
});

test('单条通过无需原因，同步通过绑定文件并记录人工操作，不放行未绑定文件', async () => {
  const c = await content(2);
  const unrelated = await content(1);
  const r = await single(c.job);
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().approvedFiles).toBe(2);
  expect(await state(c.cid)).toBe('published');
  for (const fid of c.attachments) {
    expect((await file(fid)).scan_status).toBe('clean');
    expect((await file(fid)).scan_reason).toContain('人工');
    expect(
      await db.query("SELECT id FROM audit_logs WHERE target=$1 AND action='file.review'", [fid]),
    ).toHaveLength(1);
  }
  expect((await file(unrelated.attachments[0])).scan_status).toBe('review');
  const record = (await db.query('SELECT * FROM moderation_records WHERE job_id=$1', [c.job]))[0];
  expect(record.reason).toBe('人工审核通过');
  expect(record.provider).toBe('manual');
  expect((await single(c.job)).statusCode).toBe(409);
  expect(await db.query('SELECT id FROM moderation_records WHERE job_id=$1', [c.job])).toHaveLength(
    1,
  );
});
test('批量返回逐项结果，越权、缺失和已处理项目不阻断有权限的项目', async () => {
  const allowed = await content(1),
    outside = await content(1, undefined, outsideCategory),
    done = await content();
  await single(done.job);
  const r = await batch([allowed.job, outside.job, id(), done.job], 'approved', undefined, mod);
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json()).toMatchObject({ succeeded: 1, failed: 3 });
  expect(r.json().results.map((x: any) => x.ok)).toEqual([true, false, false, false]);
  expect(await state(allowed.cid)).toBe('published');
  expect((await file(allowed.attachments[0])).scan_status).toBe('clean');
  expect(await state(outside.cid)).toBe('draft');
  expect((await file(outside.attachments[0])).scan_status).toBe('review');
  const repeated = await batch([allowed.job]);
  expect(repeated.json().failed).toBe(1);
});
test('批量验证数量、去重、UUID、Origin、CSRF 和成员角色', async () => {
  const c = await content();
  for (const ids of [[], [c.job, c.job], Array.from({ length: 51 }, () => id()), ['invalid']])
    expect((await batch(ids)).statusCode).toBe(400);
  expect((await batch([c.job], 'approved', undefined, member)).statusCode).toBe(403);
  expect(
    (
      await batch([c.job], 'approved', undefined, {
        headers: { ...admin.headers, 'x-csrf-token': '' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await batch([c.job], 'approved', undefined, {
        headers: { ...admin.headers, origin: 'https://foreign.test' },
      })
    ).statusCode,
  ).toBe(403);
});
test('批量和单条退回仍要求原因，退回不放行文件', async () => {
  const a = await content(1),
    b = await content(1);
  expect((await single(a.job, { decision: 'rejected' })).statusCode).toBe(400);
  expect((await batch([a.job, b.job], 'rejected', '短')).statusCode).toBe(400);
  const r = await batch([a.job, b.job], 'rejected', '请补充具体的项目实施结果');
  expect(r.json()).toMatchObject({ succeeded: 2, failed: 0 });
  for (const c of [a, b]) {
    expect((await file(c.attachments[0])).scan_status).toBe('review');
    expect(
      (await db.query('SELECT status,reason FROM revisions WHERE id=$1', [c.rid]))[0],
    ).toMatchObject({ status: 'rejected', reason: '请补充具体的项目实施结果' });
  }
});
test('明确违规和已阻止文件不能因批量通过而放行，失败逐项回滚', async () => {
  const abusive = await content(1, '这条测试包含直接攻击：去你妈的'),
    blocked = await content(2),
    valid = await content();
  await db.query("UPDATE attachments SET scan_status='blocked' WHERE id=$1", [
    blocked.attachments[1],
  ]);
  const r = await batch([abusive.job, blocked.job, valid.job]);
  expect(r.json()).toMatchObject({ succeeded: 1, failed: 2 });
  for (const c of [abusive, blocked]) {
    expect(await state(c.cid)).toBe('draft');
    expect((await file(c.attachments[0])).scan_status).toBe('review');
    expect(
      await db.query('SELECT id FROM moderation_records WHERE job_id=$1', [c.job]),
    ).toHaveLength(0);
    expect(
      await db.query("SELECT id FROM audit_logs WHERE target=$1 AND action='file.review'", [
        c.attachments[0],
      ]),
    ).toHaveLength(0);
  }
  expect((await file(blocked.attachments[1])).scan_status).toBe('blocked');
});
test('已替换修订和已删除文件的审核失败，文件不受影响', async () => {
  const c = await content(1),
    deleted = await content(2);
  const r = await app.inject({
    method: 'PUT',
    url: '/api/contents/' + c.cid,
    headers: member.headers,
    payload: { data: { ...c.data, title: '已修改的项目' }, submit: true, baseRevisionId: c.rid },
  });
  expect(r.statusCode).toBe(200);
  expect((await single(c.job)).statusCode).toBe(409);
  expect((await file(c.attachments[0])).scan_status).toBe('review');
  await db.query('UPDATE attachments SET deleted=true WHERE id=$1', [deleted.attachments[1]]);
  expect((await single(deleted.job)).statusCode).toBe(409);
  expect((await file(deleted.attachments[0])).scan_status).toBe('review');
});
test('独立文件通过同样不需原因，阻止仍需原因且不能解除 blocked', async () => {
  const c = await content(1),
    fid = c.attachments[0];
  const review = (payload: any) =>
    app.inject({
      method: 'POST',
      url: '/api/admin/files/' + fid + '/review',
      headers: admin.headers,
      payload,
    });
  expect((await review({ decision: 'clean' })).statusCode).toBe(200);
  expect((await file(fid)).scan_reason).not.toContain('离线检查');
  expect((await review({ decision: 'blocked' })).statusCode).toBe(400);
  expect(
    (await review({ decision: 'blocked', reason: '文件内容存在问题不允许公开下载' })).statusCode,
  ).toBe(200);
  expect((await review({ decision: 'clean' })).statusCode).toBe(409);
});

test('分类可管理但新修订已移出范围时不得审核或放行文件', async () => {
  const c = await content(1);
  const revised = await app.inject({
    method: 'PUT',
    url: '/api/contents/' + c.cid,
    headers: member.headers,
    payload: {
      data: { ...c.data, categoryId: outsideCategory },
      submit: true,
      baseRevisionId: c.rid,
    },
  });
  expect(revised.statusCode).toBe(200);
  const job = (
    await db.query('SELECT id FROM moderation_jobs WHERE revision_id=$1', [
      revised.json().revisionId,
    ])
  )[0];
  const result = await batch([job.id], 'approved', undefined, mod);
  expect(result.json().failed).toBe(1);
  expect((await file(c.attachments[0])).scan_status).toBe('review');
  expect(await state(c.cid)).toBe('draft');
});

test('同时提交单条和批量审核只完成一次，不产生重复审计或文件通过记录', async () => {
  const c = await content(1);
  const results = await Promise.all([single(c.job), batch([c.job])]);
  expect(
    results[0].statusCode === 200 ? results[1].json().failed : results[1].json().succeeded,
  ).toBe(1);
  expect(await db.query('SELECT id FROM moderation_records WHERE job_id=$1', [c.job])).toHaveLength(
    1,
  );
  expect(
    await db.query("SELECT id FROM audit_logs WHERE action='file.review' AND target=$1", [
      c.attachments[0],
    ]),
  ).toHaveLength(1);
});
