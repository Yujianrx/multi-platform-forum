// Isolated Playwright fixture. This file is never imported by the application entry point.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { openDatabase, migrate } from '../dist/server/db.js';
import { buildApp } from '../dist/server/app.js';
import { seedDevelopment } from '../dist/server/seed.js';
import { seedForum } from '../dist/server/seed-forum.js';
import { processJobs, DevelopmentProvider } from '../dist/server/moderation.js';
import { renderCaptcha } from '../dist/server/captcha.js';
import { staticCacheControl } from '../dist/server/image-cache.js';

await mkdir('work', { recursive: true });
const dataDir = await mkdtemp(path.resolve('work/browser-test-'));
const db = await openDatabase(undefined, path.join(dataDir, 'pg'));
await migrate(db);
const ctx = {
  db,
  dataDir,
  production: false,
  origin: 'http://127.0.0.1:3100',
  provider: 'development',
  clamPort: 3310,
};
const access = await seedDevelopment(ctx);
await seedForum(ctx);
// Keep the new high-request-count moderation flows on their own real test account.
await db.query(
  "INSERT INTO users(id,username,name,role,password_hash,department_id) SELECT gen_random_uuid()::text,'bulkreview.admin','批量审核测试管理员','admin',password_hash,department_id FROM users WHERE username='admin'",
);
await writeFile('work/e2e-credentials.json', JSON.stringify(access));
for (const [username, name, role] of [
  ['honors.admin', '荣誉验收管理员', 'admin'],
  ['honors.member', '荣誉验收成员', 'member'],
  ['honors.asker', '荣誉验收提问者', 'member'],
  ['draft.member', '草稿验收成员', 'member'],
  ['delete.member', '待删除验收成员', 'member'],
])
  await db.query(
    "INSERT INTO users(id,username,name,role,password_hash,department_id) SELECT gen_random_uuid()::text,$1,$2,$3,password_hash,department_id FROM users WHERE username='admin'",
    [username, name, role],
  );
const app = await buildApp(ctx, false, async () => ({
  answer: 'AB7K',
  image: await renderCaptcha('AB7K'),
}));
// Explicit fixture shutdown avoids Windows shell process-tree cleanup hangs.
app.post('/__test_shutdown', async (_req, reply) => {
  reply.send({ ok: true });
  setTimeout(() => void stop(), 100);
});
await app.register(fastifyStatic, {
  root: path.resolve('dist/client'),
  prefix: '/',
  setHeaders: (reply, filename) => reply.header('Cache-Control', staticCacheControl(filename)),
});
app.setNotFoundHandler((req, reply) =>
  req.url.startsWith('/api/')
    ? reply.code(404).send({ error: '接口不存在' })
    : reply.sendFile('index.html'),
);
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await processJobs(ctx, new DevelopmentProvider(), 100);
  } finally {
    running = false;
  }
}, 250);
await app.listen({ host: '127.0.0.1', port: 3100 });
async function stop() {
  clearInterval(timer);
  while (running) await new Promise((r) => setTimeout(r, 25));
  await app.close();
  await db.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
