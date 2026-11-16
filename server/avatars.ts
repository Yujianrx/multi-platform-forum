import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { privateImageUnchanged } from './image-cache.js';
import { type AppContext, audit, fail, id, identifier } from './core.js';
import { clamScan } from './storage.js';

export async function avatarRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  app.get('/api/avatars/:userId', async (req, reply) => {
    const uid = identifier.parse((req.params as any).userId);
    const row = (
      await db.query(
        'SELECT a.data,u.avatar_version FROM user_avatars a JOIN users u ON u.id=a.user_id WHERE a.user_id=$1 AND u.active AND u.avatar_version IS NOT NULL',
        [uid],
      )
    )[0];
    if (!row?.data) fail(404, '尚未设置头像');
    if (privateImageUnchanged(req, reply, 'avatar:' + uid + ':' + row.avatar_version))
      return reply.send();
    return reply
      .type('image/webp')
      .header('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(row.data, 'base64'));
  });
  app.get('/api/auth/avatar', async (req) => {
    return (
      (
        await db.query('SELECT status,reason,pending_version FROM user_avatars WHERE user_id=$1', [
          req.user.id,
        ])
      )[0] || { status: 'approved', reason: '', pending_version: null }
    );
  });
  app.post(
    '/api/auth/avatar',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (req) => {
      const part = await req.file({
        limits: { files: 1, fields: 1, fileSize: 5 * 1024 * 1024, fieldSize: 1000 },
      });
      if (!part) fail(400, '请选择头像图片');
      const input = await part.toBuffer();
      if (part.file.truncated) fail(413, '头像不能超过 5 MB');
      const detected = await fileTypeFromBuffer(input);
      if (!detected || !['image/png', 'image/jpeg', 'image/webp'].includes(detected.mime))
        fail(400, '头像支持 PNG、JPEG、WebP 图片');
      let crop: { left: number; top: number; size: number } | undefined;
      if (part.fields.crop) {
        try {
          const field = part.fields.crop;
          if (Array.isArray(field) || field.type !== 'field' || typeof field.value !== 'string')
            throw new Error();
          crop = z
            .object({
              left: z.number().int().min(0),
              top: z.number().int().min(0),
              size: z.number().int().min(1),
            })
            .strict()
            .parse(JSON.parse(field.value));
        } catch {
          fail(400, '裁剪范围无效，请重新选择');
        }
      }
      let bytes: Buffer;
      try {
        const image = sharp(input, { limitInputPixels: 20000000 });
        const meta = await image.metadata();
        if ((meta.pages || 1) > 1) fail(400, '头像请使用静态图片');
        const rotated = (meta.orientation || 1) >= 5;
        const width = (rotated ? meta.height : meta.width) || 0,
          height = (rotated ? meta.width : meta.height) || 0;
        if (crop && (crop.left + crop.size > width || crop.top + crop.size > height))
          fail(400, '裁剪范围超出图片，请重新选择');
        const oriented = image.rotate();
        if (crop)
          oriented.extract({ left: crop.left, top: crop.top, width: crop.size, height: crop.size });
        bytes = await oriented.resize(256, 256, { fit: 'cover' }).webp({ quality: 88 }).toBuffer();
      } catch (error: any) {
        if (error.statusCode) throw error;
        fail(400, '图片无法读取或超过 2000 万像素，请换一张图片');
      }
      if (ctx.clamHost) {
        try {
          if ((await clamScan(bytes, ctx.clamHost, ctx.clamPort)) !== 'clean')
            fail(423, '图片安全检查未通过');
        } catch {
          fail(423, '图片安全检查未通过或服务暂不可用，请重试');
        }
      }
      const version = id();
      await db.transaction(async (tx) => {
        if (
          !(
            await tx.query(
              'SELECT id FROM users WHERE id=$1 AND active AND deleted_at IS NULL FOR UPDATE',
              [req.user.id],
            )
          ).length
        )
          fail(401, '账号已不可用');
        await tx.query(
          'INSERT INTO user_avatars(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',
          [req.user.id],
        );
        await tx.query(
          "UPDATE user_avatars SET data=$1,pending_data=NULL,pending_version=NULL,status='approved',reason='',updated_at=now() WHERE user_id=$2",
          [bytes.toString('base64'), req.user.id],
        );
        await tx.query('UPDATE users SET avatar_version=$1 WHERE id=$2', [version, req.user.id]);
        await audit(tx, req.user.id, 'profile.avatar-upload', req.user.id, {
          version,
          status: 'approved',
          bytes: bytes.length,
          policy: 'profile-updates-immediate',
        });
      });
      return { status: 'approved', version };
    },
  );
  app.delete('/api/auth/avatar', async (req) => {
    await db.transaction(async (tx) => {
      if (
        !(
          await tx.query(
            'SELECT id FROM users WHERE id=$1 AND active AND deleted_at IS NULL FOR UPDATE',
            [req.user.id],
          )
        ).length
      )
        fail(401, '账号已不可用');
      await tx.query('UPDATE users SET avatar_version=NULL WHERE id=$1', [req.user.id]);
      await tx.query('DELETE FROM user_avatars WHERE user_id=$1', [req.user.id]);
      await audit(tx, req.user.id, 'profile.avatar-remove', req.user.id);
    });
    return { ok: true };
  });
}
