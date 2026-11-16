import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { type AppContext, admin, audit, fail } from './core.js';
import { clamScan } from './storage.js';
import { privateImageUnchanged } from './image-cache.js';

/** Admin-managed site identity, separate from published content moderation. */
export async function brandingRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/logo', async (req, reply) => {
    const row = (await ctx.db.query("SELECT value FROM settings WHERE key='brand-logo'"))[0];
    if (!row) fail(404, '尚未设置图片 Logo');
    if (privateImageUnchanged(req, reply, 'logo:' + row.value.updatedAt)) return reply.send();
    return reply
      .type('image/webp')
      .header('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(row.value.data, 'base64'));
  });
  app.post('/api/admin/logo', async (req) => {
    admin(req);
    const part = await req.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1 } });
    if (!part) fail(400, '请选择图片');
    const input = await part.toBuffer();
    if (part.file.truncated) fail(413, '图片超过 10 MB');
    const detected = await fileTypeFromBuffer(input);
    if (!detected || !['image/png', 'image/jpeg', 'image/webp'].includes(detected.mime))
      fail(400, 'Logo 仅支持 PNG、JPEG、WebP 图片');
    let bytes: Buffer;
    try {
      bytes = await sharp(input, { limitInputPixels: 40000000 })
        .rotate()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch {
      fail(400, '图片无法安全解码');
    }
    if (ctx.clamHost) {
      let result: string;
      try {
        result = await clamScan(bytes, ctx.clamHost, ctx.clamPort);
      } catch {
        fail(423, '已配置的恶意文件扫描服务异常，Logo 保持原状，请重试');
      }
      if (result !== 'clean') fail(423, '检测到恶意文件，Logo 未更新');
    }
    await ctx.db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO settings(key,value) VALUES('brand-logo',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
        [JSON.stringify({ data: bytes.toString('base64'), updatedAt: new Date().toISOString() })],
      );
      await audit(tx, req.user.id, 'branding.logo-update', 'site', {
        scanner: ctx.clamHost ? 'clamav' : 'image-validation',
        bytes: bytes.length,
      });
    });
    return { ok: true };
  });
  app.delete('/api/admin/logo', async (req) => {
    admin(req);
    await ctx.db.transaction(async (tx) => {
      await tx.query("DELETE FROM settings WHERE key='brand-logo'");
      await audit(tx, req.user.id, 'branding.logo-remove', 'site');
    });
    return { ok: true };
  });
}
