import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { type AppContext, registerErrors, siteSettings } from './core.js';
import { authRoutes } from './auth.js';
import { contentRoutes } from './content.js';
import { storageRoutes } from './storage.js';
import { discoveryRoutes } from './discovery.js';
import { socialRoutes } from './social.js';
import { adminRoutes } from './admin.js';
import { brandingRoutes } from './branding.js';
import { avatarRoutes } from './avatars.js';
import { forumRoutes } from './forum.js';
import type { CaptchaSource } from './captcha.js';
import { apiKeyRoutes } from './api-keys.js';
import { openApiRoutes } from './open-api.js';
import { honorsRoutes } from './honors-routes.js';
export async function buildApp(ctx: AppContext, logger = false, captchaSource?: CaptchaSource) {
  const app = Fastify({
    logger: logger
      ? {
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers.x-csrf-token',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.confirmPassword',
            'req.body.captchaCode',
          ],
        }
      : false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy:
      process.env.TRUST_PROXY === 'true' ? (_address: string, hop: number) => hop === 0 : false,
  });
  registerErrors(app);
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...(!ctx.production ? ["'unsafe-inline'"] : [])],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: [
          "'self'",
          ...(!ctx.production ? ['ws://127.0.0.1:*', 'ws://localhost:*'] : []),
        ],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: ctx.production ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: ctx.production,
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    hook: 'preHandler',
    // Static pages and sticker assets share an office IP; only API requests use this budget.
    allowList: (request) => !request.routeOptions.url?.startsWith('/api/'),
    // Company members often share one public IP. Authenticated traffic is isolated per user.
    keyGenerator: (request) => request.user?.id || request.ip,
  });
  await app.register(multipart, { limits: { files: 1, fileSize: 100 * 1024 * 1024, parts: 4 } });
  await authRoutes(app, ctx, captchaSource);
  app.get('/api/health', async () => {
    await ctx.db.query('SELECT 1');
    return { ok: true };
  });
  app.get('/api/public', async () => {
    const s = await siteSettings(ctx.db);
    const logoRow = (
      await ctx.db.query("SELECT value->>'updatedAt' version FROM settings WHERE key='brand-logo'")
    )[0];
    return {
      name: s.name,
      description: s.description,
      logo: s.logo,
      hasLogo: !!logoRow,
      logoVersion: logoRow?.version,
      development: !ctx.production,
    };
  });
  await contentRoutes(app, ctx);
  await storageRoutes(app, ctx);
  await discoveryRoutes(app, ctx);
  await socialRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await brandingRoutes(app, ctx);
  await forumRoutes(app, ctx);
  await avatarRoutes(app, ctx);
  await apiKeyRoutes(app, ctx);
  await openApiRoutes(app, ctx);
  await honorsRoutes(app, ctx);
  return app;
}
