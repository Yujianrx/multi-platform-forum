const https = require('node:https');
const { randomBytes } = require('node:crypto');

const { communityOrigin } = require('./config');
const maxFile = 700 * 1024;
const maxJson = 900 * 1024;
const uuid = '[0-9a-f-]{36}';
const content = `contents/${uuid}`;
const read = new RegExp(`^/api/(?:auth/me|taxonomy|home|contents|${content}(?:/(?:comments|versions))?|forum/(?:boards|topics(?:/${uuid})?)|rankings|honors/(?:board|me)|notifications)$`);
const write = new RegExp(`^/api/(?:auth/logout|notifications/read|contents|forum/topics|${content}/(?:comments|visit)|forum/topics/${uuid}/visit)$`);
const update = new RegExp(`^/api/(?:${content}(?:/(?:like|bookmark))?|forum/topics/${uuid}/follow)$`);
const discard = new RegExp(`^/api/${content}/draft$`);
const download = new RegExp(`^/api/(?:files/${uuid}|avatars/${uuid}|logo)$`);
const upload = new RegExp(`^/api/${content}/(?:files|comment-files)$`);
const publicAuth = new Map([
  ['/api/mini/auth/captcha', 'GET'], ['/api/mini/auth/login', 'POST'], ['/api/mini/auth/register', 'POST'],
]);

function prepare(event) {
  if (typeof event.path !== 'string' || event.path.length > 1800 ||
      !/^\/api\/[a-zA-Z0-9/-]+(?:\?[^#\r\n]*)?$/.test(event.path)) return;
  const url = new URL(event.path, communityOrigin());
  const { method } = event;
  const path = url.pathname;
  const anonymous = publicAuth.get(path) === method;
  const fileDownload = method === 'GET' && download.test(path);
  const fileUpload = method === 'POST' && upload.test(path);
  const allowed = { GET: read, POST: write, PUT: update, DELETE: discard };
  if (!anonymous && !fileDownload && !fileUpload && !Object.hasOwn(allowed, method)) return;
  if (!anonymous && !fileDownload && !fileUpload && !allowed[method].test(path)) return;
  const headers = { Accept: fileDownload ? '*/*' : 'application/json' };
  if (!anonymous) {
    if (typeof event.session !== 'string' || !/^wx1_[\w-]{43}$/.test(event.session)) return;
    headers.Authorization = `Bearer ${event.session}`;
  }
  if (anonymous && typeof event.captchaToken === 'string' && /^[\w-]{43}$/.test(event.captchaToken))
    headers['X-Captcha-Token'] = event.captchaToken;
  let body;
  if (fileUpload) {
    if (typeof event.file !== 'string' || event.file.length > Math.ceil(maxFile / 3) * 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(event.file) || typeof event.filename !== 'string') return;
    const bytes = Buffer.from(event.file, 'base64');
    if (!bytes.length || bytes.length > maxFile) return;
    const filename = event.filename.slice(0, 160).replace(/["\\/\x00-\x1f\x7f]/g, '_');
    const boundary = randomBytes(24).toString('hex');
    body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
  } else if (method !== 'GET' && event.data !== undefined) {
    body = Buffer.from(JSON.stringify(event.data));
    if (body.length > maxJson) return;
    headers['Content-Type'] = 'application/json';
  }
  if (body) headers['Content-Length'] = body.length;
  return { url, method, headers, body, fileDownload };
}

function upstream(input) {
  return new Promise((resolve, reject) => {
    const req = https.request(input.url, { method: input.method, headers: input.headers, timeout: 7000 }, (res) => {
      const statusCode = res.statusCode;
      const isFile = input.fileDownload && statusCode >= 200 && statusCode < 300;
      const limit = isFile ? maxFile : maxJson;
      const tooLarge = () => {
        resolve({ statusCode: 413, data: { error: isFile ? '此附件超过小程序云调用上限，请在社区网页查看' : '内容过大，请在社区网页查看' } });
        res.destroy();
      };
      if (Number(res.headers['content-length']) > limit) { tooLarge(); return; }
      const chunks = [];
      let length = 0;
      res.on('data', (chunk) => {
        length += chunk.length;
        if (length > limit) { tooLarge(); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        if (isFile) {
          resolve({ statusCode, file: bytes.toString('base64'), mime: res.headers['content-type'] });
          return;
        }
        try {
          const data = bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
          resolve({ statusCode, data });
        } catch { resolve({ statusCode: 502, data: { error: '社区服务器响应异常，请重试' } }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Community request timed out')));
    req.on('error', reject);
    req.end(input.body);
  });
}

async function communityApi(event) {
  try { communityOrigin(); }
  catch { return { statusCode: 503, data: { error: '请配置云函数 COMMUNITY_ORIGIN 为论坛 HTTPS 地址' } }; }
  const input = prepare(event);
  if (!input) return { statusCode: 403, data: { error: '小程序不支持此操作' } };
  try { return await upstream(input); }
  catch { return { statusCode: 502, data: { error: '社区服务器连接失败，请重试' } }; }
}

module.exports = { communityApi, prepare, maxFile };
