import { test, expect } from 'vitest';
import { openDatabase, migrate } from '../server/db';
import { id } from '../server/core';

test('部门迁移按附图排序，保留旧部门的成员、邀请码与授权关系且不重复执行', async () => {
  const db = await openDatabase();
  try {
    await migrate(db);
    await db.query('DELETE FROM departments');
    await db.query('ALTER TABLE departments DROP COLUMN sort_order');
    await db.query("DELETE FROM schema_migrations WHERE name='009_company_departments.sql'");
    const old = [id(), id(), id()],
      uid = id(),
      invitation = id();
    for (const [i, name] of ['产品与设计部', '技术研发部', '业务运营部'].entries())
      await db.query('INSERT INTO departments(id,name) VALUES($1,$2)', [old[i], name]);
    await db.query(
      "INSERT INTO users(id,username,name,password_hash,department_id) VALUES($1,'migration.user','成员','unused',$2)",
      [uid, old[0]],
    );
    await db.query(
      "INSERT INTO invitations(id,code_hash,label,department_id,max_uses,expires_at,created_by) VALUES($1,'unused','迁移验收',$2,1,now()+interval '1 day',$3)",
      [invitation, old[2], uid],
    );
    await db.query('INSERT INTO moderator_scopes(id,user_id,department_id) VALUES($1,$2,$3)', [
      id(),
      uid,
      old[1],
    ]);
    await migrate(db);
    const rows = await db.query('SELECT * FROM departments ORDER BY sort_order,name');
    expect(rows.map((r) => r.name)).toEqual([
      '总经办',
      '海外及大客户服务中心',
      '品牌中心',
      '设计部',
      '供应链中心',
      '营运中心',
      '财务部',
      '人力行政部',
      '招商中心',
      '外卖运营部',
      '工程部',
      '研发中心',
      '团购运营',
    ]);
    expect(rows.find((r) => r.name === '设计部')?.id).toBe(old[0]);
    expect(rows.find((r) => r.name === '研发中心')?.id).toBe(old[1]);
    expect(rows.find((r) => r.name === '营运中心')?.id).toBe(old[2]);
    expect(
      (await db.query('SELECT department_id FROM users WHERE id=$1', [uid]))[0].department_id,
    ).toBe(old[0]);
    expect(
      (await db.query('SELECT department_id FROM invitations WHERE id=$1', [invitation]))[0]
        .department_id,
    ).toBe(old[2]);
    expect(
      (await db.query('SELECT department_id FROM moderator_scopes WHERE user_id=$1', [uid]))[0]
        .department_id,
    ).toBe(old[1]);
    await migrate(db);
    expect(await db.query('SELECT * FROM departments ORDER BY sort_order,name')).toEqual(rows);
  } finally {
    await db.close();
  }
});
