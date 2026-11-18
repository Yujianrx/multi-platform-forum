import 'dotenv/config';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { openDatabase, migrate } from './db.js';
import { id, passwordHash, accountPassword, audit, type AppContext } from './core.js';
import { seedDevelopment } from './seed.js';
import { seedForum } from './seed-forum.js';
const production = process.env.NODE_ENV === 'production',
  command = process.argv[2];
if (production && !process.env.DATABASE_URL) throw new Error('生产必须配置 DATABASE_URL');
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const db = await openDatabase(process.env.DATABASE_URL, path.join(dataDir, 'pg'));
try {
  await migrate(db);
  if (command === 'admin') {
    if ((await db.query("SELECT id FROM users WHERE role='admin'")).length)
      throw new Error('管理员已存在；请使用后台账号管理');
    const username = process.env.ADMIN_USERNAME || 'admin';
    let password = process.env.ADMIN_PASSWORD;
    if (!password)
      throw new Error(
        '请通过临时环境变量 ADMIN_PASSWORD 初始化，密码为 6–20 位，无需字母数字组合；请勿将密码写入命令历史或源码。',
      );
    accountPassword.parse(password);
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('账号格式无效');
    const uid = id(),
      encoded = await passwordHash(password);
    await db.transaction(async (tx) => {
      await tx.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      if ((await tx.query("SELECT id FROM users WHERE role='admin'")).length)
        throw new Error('管理员已存在；请勿并发重复初始化');
      await tx.query(
        "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,'社区管理员',$3,'admin')",
        [uid, username, encoded],
      );
      for (const name of ['办公提效', '研发技术', '数据分析', '设计创作', '业务应用'])
        await tx.query(
          'INSERT INTO categories(id,name) VALUES($1,$2) ON CONFLICT(name) DO NOTHING',
          [id(), name],
        );
      await audit(tx, uid, 'admin.initialize', uid);
    });
    console.log('管理员已初始化。请删除 ADMIN_PASSWORD 环境变量，登录后台创建部门和邀请码。');
  } else if (command === 'seed') {
    if (process.env.DATABASE_URL && process.env.ALLOW_DEMO_SEED !== 'true')
      throw new Error('为避免污染外部数据库，默认只允许在本地嵌入式开发库导入示例');
    const ctx: AppContext = {
      db,
      dataDir,
      production,
      origin: process.env.APP_ORIGIN || 'http://127.0.0.1:3000',
      provider: 'development',
      clamPort: 3310,
    };
    const access = await seedDevelopment(ctx);
    await seedForum(ctx);
    await mkdir('work', { recursive: true });
    await mkdir('outputs', { recursive: true });
    await writeFile('work/dev-credentials.json', JSON.stringify(access, null, 2));
    await writeFile(
      'outputs/本地访问说明.txt',
      `多端论坛 · 本地开发访问\n\n地址：http://127.0.0.1:3000\n管理员账号：admin\n开发示例密码：${access.password}\n\n其他示例账号：lin.xia（设计部）、chen.yu（研发中心）、zhou.ning（营运中心）\n上述示例账号使用同一随机开发密码。\n\n开发邀请码（营运中心，7 天有效）：${access.inviteCode}\n\n此文件仅供本地开发。请勿用于生产或上传至公共仓库。生产使用 npm run admin:init 安全初始化。\n启动：npm run dev\n`,
      'utf8',
    );
    console.log('已生成开发数据。随机账号与邀请码已写入 outputs/本地访问说明.txt（未写入源码）。');
  } else if (command === 'seed-forum') {
    if (process.env.DATABASE_URL) throw new Error('补充论坛示例仅支持本地开发库');
    await seedForum({
      db,
      dataDir,
      production,
      origin: 'http://127.0.0.1:3000',
      provider: 'development',
      clamPort: 3310,
    });
    console.log('开发论坛示例已就绪');
  } else if (command === 'migrate') console.log('数据库迁移完成');
  else throw new Error('用法：node dist/server/cli.js migrate | admin | seed');
} finally {
  await db.close();
}
