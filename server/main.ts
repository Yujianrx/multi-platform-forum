import 'dotenv/config';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { openDatabase, migrate } from './db.js';
import { buildApp } from './app.js';
import { providerFor, processJobs } from './moderation.js';
import type { AppContext } from './core.js';
import { staticCacheControl } from './image-cache.js';
import { settleHonorWeeks } from './honors-engine.js';
const production = process.env.NODE_ENV === 'production';
if (production && !process.env.DATABASE_URL) throw new Error('生产环境必须配置 DATABASE_URL');
if (production && !process.env.APP_ORIGIN?.startsWith('https://'))
  throw new Error('生产环境 APP_ORIGIN 必须为 HTTPS 域名');
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const db = await openDatabase(process.env.DATABASE_URL, path.join(dataDir, 'pg'));
await migrate(db);
const ctx: AppContext = {
  db,
  dataDir,
  production,
  origin: process.env.APP_ORIGIN || 'http://127.0.0.1:3000',
  provider: process.env.MODERATION_PROVIDER || 'none',
  clamHost: process.env.CLAMAV_HOST,
  clamPort: Number(process.env.CLAMAV_PORT || 3310),
};
const provider = providerFor(ctx.provider, production),
  app = await buildApp(ctx, true);
if (production || process.env.SERVE_BUILD === 'true') {
  await app.register(fastifyStatic, {
    root: path.resolve('dist/client'),
    prefix: '/',
    setHeaders: (reply, filename) => {
      reply.header('Cache-Control', staticCacheControl(filename));
    },
  });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/')
      ? reply.code(404).send({ error: '接口不存在' })
      : reply.sendFile('index.html'),
  );
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: '接口不存在' });
    reply.hijack();
    vite.middlewares(req.raw, reply.raw, () => {
      reply.raw.statusCode = 404;
      reply.raw.end('Not found');
    });
  });
  app.addHook('onClose', async () => vite.close());
}
let running = false;
const run = async () => {
  if (running) return;
  running = true;
  try {
    await processJobs(ctx, provider, 5);
  } catch (e) {
    app.log.error({ message: (e as Error).message }, 'worker error');
  } finally {
    running = false;
  }
};
const interval = setInterval(run, 2000);
const honorInterval = setInterval(
  () =>
    db.transaction((tx) => settleHonorWeeks(tx)).catch((e) => app.log.error(e, 'honor settlement')),
  60000,
);
await db.transaction((tx) => settleHonorWeeks(tx));
await run();
await app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1' });
async function shutdown() {
  clearInterval(interval);
  clearInterval(honorInterval);
  while (running) await new Promise((r) => setTimeout(r, 50));
  await app.close();
  await db.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
