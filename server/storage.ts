import type { FastifyInstance } from 'fastify';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { type AppContext, id, hash, fail, identifier, siteSettings, admin, audit } from './core.js';
import { getContent, canReadRevision, canManage } from './permissions.js';
import { privateImageUnchanged } from './image-cache.js';
export interface PrivateStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
// Future S3 adapter must use private GetObject, never permanent public URLs.
export class DiskStorage implements PrivateStorage {
  constructor(private root: string) {}
  private location(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Unsafe storage key');
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.location(key), data, { flag: 'wx' });
  }
  async get(key: string) {
    return readFile(this.location(key));
  }
  async remove(key: string) {
    await unlink(this.location(key));
  }
}
export async function inspectZip(buffer: Buffer): Promise<{ text: string; uncertain: boolean }> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) return reject(new Error('无法解析 ZIP 或文件已加密'));
        let count = 0,
          total = 0,
          text = '',
          uncertain = false,
          finished = false;
        const stop = (error: Error) => {
          if (finished) return;
          finished = true;
          zip.close();
          reject(error);
        };
        zip.on('error', stop);
        zip.on('end', () => {
          if (!finished) {
            finished = true;
            resolve({ text, uncertain });
          }
        });
        zip.on('entry', (entry: yauzl.Entry) => {
          count++;
          total += entry.uncompressedSize;
          if (
            count > 200 ||
            total > 50 * 1024 * 1024 ||
            entry.uncompressedSize > 10 * 1024 * 1024 ||
            entry.uncompressedSize / Math.max(entry.compressedSize, 1) > 100
          )
            return stop(new Error('ZIP 超过解析数量、大小或压缩比限制'));
          if (
            entry.fileName.includes('..') ||
            entry.fileName.includes('\\') ||
            entry.fileName.startsWith('/') ||
            /^[a-z]:/i.test(entry.fileName) ||
            ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
          )
            return stop(new Error('ZIP 包含不安全路径或符号链接'));
          if (entry.generalPurposeBitFlag & 1) {
            uncertain = true;
            zip.readEntry();
            return;
          }
          if (/\/$/.test(entry.fileName)) {
            zip.readEntry();
            return;
          }
          if (!/\.(txt|md|json|csv|ya?ml|ts|js|py|sh|toml)$/i.test(entry.fileName)) {
            uncertain = true;
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) return stop(new Error('ZIP 内容读取失败'));
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('data', (chunk) => {
              size += chunk.length;
              if (size > 10 * 1024 * 1024) {
                stream.destroy();
                stop(new Error('ZIP 解压内容超过限制'));
              } else chunks.push(chunk);
            });
            stream.on('error', stop);
            stream.on('end', () => {
              if (finished) return;
              try {
                text +=
                  '\n[附件 ' +
                  entry.fileName +
                  ']\n' +
                  new TextDecoder('utf-8', { fatal: true })
                    .decode(Buffer.concat(chunks))
                    .slice(0, 100000);
                if (text.length > 500000) return stop(new Error('ZIP 文本量超过审核限制'));
              } catch {
                uncertain = true;
              }
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
export async function clamScan(
  buffer: Buffer,
  host: string,
  port: number,
): Promise<'clean' | 'blocked'> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let result = '';
    socket.setTimeout(15000);
    socket.on('timeout', () => socket.destroy(new Error('恶意文件扫描超时')));
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      result += chunk.toString();
      if (result.includes('\0') || result.includes('\n')) {
        socket.end();
        if (result.includes('FOUND')) resolve('blocked');
        else if (result.includes('OK')) resolve('clean');
        else reject(new Error('恶意文件扫描失败'));
      }
    });
    socket.on('end', () => {
      if (!result.includes('OK') && !result.includes('FOUND'))
        reject(new Error('扫描服务无有效结果'));
    });
    socket.on('connect', async () => {
      try {
        socket.write('zINSTREAM\0');
        for (let i = 0; i < buffer.length; i += 65536) {
          const chunk = buffer.subarray(i, i + 65536),
            len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          socket.write(len);
          if (!socket.write(chunk)) await new Promise<void>((r) => socket.once('drain', r));
        }
        socket.write(Buffer.alloc(4));
      } catch (e) {
        socket.destroy();
        reject(e);
      }
    });
  });
}
export async function storageRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx,
    storage = new DiskStorage(path.join(ctx.dataDir, 'uploads'));
  app.get('/api/admin/files/:id/quarantine', async (req, reply) => {
    admin(req);
    const fid = identifier.parse((req.params as any).id),
      f = (await db.query('SELECT * FROM attachments WHERE id=$1 AND NOT deleted', [fid]))[0];
    if (!f) fail(404, '文件不存在');
    let bytes: Buffer;
    try {
      bytes = await storage.get(f.storage_key);
    } catch {
      fail(404, '文件暂时不可用');
    }
    await audit(db, req.user.id, 'file.quarantine-export', fid);
    return reply
      .type('application/octet-stream')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header(
        'Content-Disposition',
        `attachment; filename="quarantine.bin"; filename*=UTF-8''${encodeURIComponent(f.original_name + '.quarantine')}`,
      )
      .send(bytes);
  });
  for (const route of ['/api/contents/:id/files', '/api/contents/:id/comment-files'])
    app.post(route, async (req, reply) => {
      const cid = identifier.parse((req.params as any).id);
      const forComment = req.routeOptions.url === '/api/contents/:id/comment-files';
      await getContent(db, req.user, cid, forComment ? 'published' : 'edit');
      if (forComment) {
        const topic = (
          await db.query('SELECT locked FROM forum_topics WHERE content_id=$1', [cid])
        )[0];
        if (topic?.locked && !(await canManage(db, req.user, cid)))
          fail(403, '此话题已锁定，暂时不能上传回复附件');
      }
      const settings = await siteSettings(db);
      const part = await req.file({
        limits: { fileSize: Math.min(settings.resourceMaxMB, 100) * 1024 * 1024, files: 1 },
      });
      if (!part) fail(400, '请选择文件');
      let buffer = await part.toBuffer();
      if (part.file.truncated) fail(413, '文件超过大小限制');
      const original = path
        .basename(part.filename.replaceAll('\\', '/'))
        .replace(/[\x00-\x1f\x7f]/g, '')
        .slice(0, 180);
      const ext = path.extname(original).slice(1).toLowerCase();
      if (!settings.allowedTypes.includes(ext)) fail(400, '文件类型未获允许');
      const detected = await fileTypeFromBuffer(buffer);
      let mime = '',
        kind: 'image' | 'resource' = 'resource',
        extracted = '',
        uncertain = false;
      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
        if (
          !detected ||
          !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(detected.mime)
        )
          fail(400, '图片实际类型与扩展名不符');
        if (
          detected.mime !==
          (
            {
              png: 'image/png',
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              webp: 'image/webp',
              gif: 'image/gif',
            } as any
          )[ext]
        )
          fail(400, '图片实际类型与扩展名不符');
        if (buffer.length > settings.imageMaxMB * 1024 * 1024) fail(413, '图片超过大小限制');
        kind = 'image';
        mime = 'image/webp';
        try {
          const metadata = await sharp(buffer, {
            limitInputPixels: 40000000,
            animated: true,
          }).metadata();
          if (
            (metadata.pages || 1) > 100 ||
            (metadata.width || 0) *
              (metadata.pageHeight || metadata.height || 0) *
              (metadata.pages || 1) >
              40000000
          )
            fail(413, '图片动画超过 100 帧或像素总量限制');
          buffer = await sharp(buffer, { limitInputPixels: 40000000, animated: true })
            .rotate()
            .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();
        } catch {
          fail(400, '无法安全解码图片');
        }
      } else if (['pdf', 'docx', 'xlsx', 'pptx'].includes(ext)) {
        const documentMimes: Record<string, string> = {
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        };
        if (!detected || detected.mime !== documentMimes[ext])
          fail(400, '文档实际类型与扩展名不符');
        mime = documentMimes[ext];
        uncertain = true;
        extracted = '文档内容需人工检查，未自动提取其全部文字与嵌入对象';
        if (ext !== 'pdf') {
          try {
            const parsed = await inspectZip(buffer);
            extracted += '\n' + parsed.text;
          } catch (error) {
            fail(400, 'Office 文档结构无法安全解析');
          }
        }
      } else if (ext === 'zip') {
        if (!detected || detected.mime !== 'application/zip') fail(400, '实际文件不是 ZIP');
        mime = 'application/zip';
        try {
          const parsed = await inspectZip(buffer);
          extracted = parsed.text;
          uncertain = parsed.uncertain;
        } catch (error) {
          uncertain = true;
          extracted = '无法可靠解析附件：' + (error as Error).message;
        }
      } else {
        if (detected || buffer.includes(0)) fail(400, '文件实际类型不是纯文本');
        try {
          extracted = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        } catch {
          fail(400, '文本必须使用 UTF-8 编码');
        }
        if (extracted.length > 500000) fail(413, '文本超过 50 万字符解析限制');
        if (ext === 'json') {
          try {
            JSON.parse(extracted);
          } catch {
            fail(400, 'JSON 文件格式无效');
          }
        }
        mime = ext === 'json' ? 'application/json' : 'text/plain';
      }
      let scanStatus = 'review',
        scanReason = '未配置恶意文件扫描，请由管理员离线检查后确认';
      if (ctx.provider === 'development' && !ctx.production) {
        scanStatus = 'clean';
        scanReason = '仅开发模拟扫描，不代表安全证明';
      } else if (ctx.clamHost) {
        try {
          scanStatus = await clamScan(buffer, ctx.clamHost, ctx.clamPort);
          scanReason = scanStatus === 'clean' ? 'ClamAV 扫描通过' : '检测到恶意文件';
        } catch (e) {
          scanReason = (e as Error).message;
        }
      }
      if (uncertain && scanStatus !== 'blocked') {
        scanStatus = 'review';
        scanReason = '文件解析不完整，需人工检查；' + scanReason;
      }
      const fid = id(),
        key = id();
      await storage.put(key, buffer);
      try {
        await db.transaction(async (tx) => {
          await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
          const used = Number(
            (
              await tx.query(
                'SELECT COALESCE(sum(size),0) size FROM attachments WHERE owner_id=$1 AND NOT deleted',
                [req.user.id],
              )
            )[0].size,
          );
          if (used + buffer.length > settings.quotaMB * 1024 * 1024)
            fail(413, '已超出个人存储额度');
          await tx.query(
            'INSERT INTO attachments(id,content_id,owner_id,original_name,storage_key,mime,size,kind,scan_status,scan_reason,extracted_text,purpose,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
            [
              fid,
              cid,
              req.user.id,
              original,
              key,
              mime,
              buffer.length,
              kind,
              scanStatus,
              scanReason,
              extracted,
              forComment ? 'comment' : 'content',
              hash(buffer),
            ],
          );
        });
      } catch (e) {
        await storage.remove(key);
        throw e;
      }
      return reply.code(201).send({
        id: fid,
        original_name: original,
        size: buffer.length,
        kind,
        mime,
        scan_status: scanStatus,
        scan_reason: scanReason,
      });
    });
  app.get(
    '/api/files/:id',
    {
      onResponse: async (req, reply) => {
        // Fastify onResponse runs only after the response was sent; aborted requests never count.
        const event = (req as any).downloadEvent;
        if (!event || reply.statusCode !== 200 || req.raw.aborted) return;
        try {
          const counted = event.authorId !== req.user.id && event.published;
          const params = [
            id(),
            req.user.id,
            event.contentId,
            event.attachmentId,
            event.revisionId,
            counted,
          ];
          const inserted = await db.query(
            "INSERT INTO download_events(id,user_id,content_id,attachment_id,revision_id,counted,day) VALUES($1,$2,$3,$4,$5,$6,(now() AT TIME ZONE 'Asia/Shanghai')::date) ON CONFLICT DO NOTHING RETURNING id",
            params,
          );
          if (!inserted.length)
            await db.query(
              "INSERT INTO download_events(id,user_id,content_id,attachment_id,revision_id,counted,day) VALUES($1,$2,$3,$4,$5,false,(now() AT TIME ZONE 'Asia/Shanghai')::date)",
              params.slice(0, 5),
            );
        } catch (e) {
          req.log.error({ message: 'download event persistence failed' }, 'download event');
        }
      },
    },
    async (req, reply) => {
      const fid = identifier.parse((req.params as any).id);
      const f = (await db.query('SELECT * FROM attachments WHERE id=$1 AND NOT deleted', [fid]))[0];
      if (!f) fail(404, '文件不存在或无权访问');
      const c = await getContent(db, req.user, f.content_id);
      if (f.purpose === 'comment') {
        const cm = (
          await db.query(
            'SELECT cm.* FROM comments cm JOIN comment_attachments ca ON ca.comment_id=cm.id WHERE ca.attachment_id=$1',
            [fid],
          )
        )[0];
        if (cm?.status === 'deleted') fail(404, '评论附件不存在');
        const manager = await canManage(db, req.user, c.id);
        if (
          cm
            ? cm.status !== 'approved' && cm.author_id !== req.user.id && !manager
            : f.owner_id !== req.user.id
        )
          fail(404, '文件不存在或无权访问');
        if (f.scan_status !== 'clean') fail(423, '文件仍在隔离检查中');
        if (
          f.kind === 'image' &&
          (req.query as any).download !== '1' &&
          privateImageUnchanged(req, reply, 'file:' + f.storage_key)
        )
          return reply.send();
        let bytes: Buffer;
        try {
          bytes = await storage.get(f.storage_key);
        } catch {
          fail(404, '文件暂时不可用');
        }
        reply
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Security-Policy', "default-src 'none'; sandbox")
          .type(f.mime);
        if (f.kind === 'resource' || (req.query as any).download === '1')
          reply.header(
            'Content-Disposition',
            `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
          );
        return reply.send(bytes);
      }
      const own = c.author_id === req.user.id || req.user.role === 'admin';
      const requested = (req.query as any).revision;
      const rid = requested
        ? identifier.parse(requested)
        : own && !c.published_revision_id
          ? c.latest_revision_id
          : c.published_revision_id;
      const r = rid
        ? (
            await db.query(
              'SELECT r.* FROM revisions r JOIN revision_attachments ra ON r.id=ra.revision_id WHERE r.id=$1 AND r.content_id=$2 AND ra.attachment_id=$3',
              [rid, c.id, fid],
            )
          )[0]
        : null;
      if ((!r || !(await canReadRevision(db, req.user, c, r))) && !own)
        fail(404, '文件不存在或无权访问');
      if (requested && !r) fail(404, '文件不属于该版本');
      if (f.scan_status !== 'clean') fail(423, '文件仍在隔离检查中');
      const download = f.kind === 'resource' || (req.query as any).download === '1';
      if (
        !download &&
        f.kind === 'image' &&
        privateImageUnchanged(req, reply, 'file:' + f.storage_key)
      )
        return reply.send();
      let data: Buffer;
      try {
        data = await storage.get(f.storage_key);
      } catch {
        fail(404, '文件暂时不可用');
      }
      reply
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .type(f.mime);
      if (download) {
        reply.header(
          'Content-Disposition',
          `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
        );
        if (r)
          (req as any).downloadEvent = {
            authorId: c.author_id,
            contentId: c.id,
            attachmentId: fid,
            revisionId: r.id,
            published: c.state === 'published' && r.status === 'approved',
          };
      }
      return reply.send(data);
    },
  );
  app.delete('/api/files/:id', async (req) => {
    const fid = identifier.parse((req.params as any).id),
      f = (await db.query('SELECT * FROM attachments WHERE id=$1 AND NOT deleted', [fid]))[0];
    if (!f) fail(404, '文件不存在');
    await getContent(db, req.user, f.content_id, f.purpose === 'comment' ? 'read' : 'edit');
    if (f.purpose === 'comment') {
      if (f.owner_id !== req.user.id && req.user.role !== 'admin') fail(404, '文件不存在');
      if (
        (await db.query('SELECT 1 FROM comment_attachments WHERE attachment_id=$1', [fid])).length
      )
        fail(409, '附件已随评论提交，请删除评论后隐藏相关附件');
    }
    if (
      (await db.query('SELECT 1 FROM revision_attachments WHERE attachment_id=$1 LIMIT 1', [fid]))
        .length
    )
      fail(409, '文件已被修订引用，请在新修订中移除；历史文件保留');
    await db.query('UPDATE attachments SET deleted=true WHERE id=$1', [fid]);
    await storage.remove(f.storage_key);
    return { ok: true };
  });
}
