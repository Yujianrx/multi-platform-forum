const { origin, cloudEnv } = require('../config');
const maxFile = 700 * 1024;
const mediaPrefix = 'community-mini-media-';
const photoExtensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
let fileNumber = 0;

function handle(response, session) {
  const status = response.statusCode;
  let body = response.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (status >= 200 && status < 300) return body;
  if (status === 401 && session && getApp().session === session) getApp().resetSession();
  throw new Error(body?.error || '操作失败，请重试');
}

function request(path, method = 'GET', data) {
  const { session } = getApp();
  if (!session) return Promise.reject(new Error('请先登录'));
  return send(path, method, data, { session });
}

async function callCloud(data) {
  if (!cloudEnv || !wx.cloud) throw new Error('微信云开发尚未配置');
  let response;
  try { response = await wx.cloud.callFunction({ name: 'communityIdentity', data }); }
  catch { throw new Error('微信云开发连接失败，请重试'); }
  const result = response.result || {};
  if (result.error) throw new Error(result.error);
  return result;
}

async function send(path, method, data, auth = {}) {
  const result = await callCloud({ action: 'api', path: `/api${path}`, method, data, ...auth });
  return handle(result, auth.session);
}

function getCaptcha(previous) {
  return send('/mini/auth/captcha', 'GET', undefined, previous ? { captchaToken: previous } : {});
}

async function accountSignIn(mode, data, captchaToken) {
  const result = await send(`/mini/auth/${mode}`, 'POST', data, captchaToken ? { captchaToken } : {});
  const app = getApp();
  app.session = result.session;
  app.user = result.user;
}

async function signIn(action, code) {
  const result = await callCloud(code ? { action, code } : { action });
  if (result.state === 'signed-in') {
    const app = getApp();
    app.session = result.session;
    try { app.user = (await request('/auth/me')).user; }
    catch (error) { app.session = ''; throw error; }
  }
  return result;
}

async function download(path) {
  const { session } = getApp();
  const safe = /^\/api\/(?:files\/[0-9a-f-]{36}(?:\?(?:revision=[0-9a-f-]{36}(?:&download=1)?|download=1))?|avatars\/[0-9a-f-]{36}|logo)$/.test(path);
  if (!session || !safe) throw new Error('附件不可用');
  const response = await callCloud({ action: 'api', path, method: 'GET', session });
  handle(response, session);
  if (typeof response.file !== 'string' || getApp().session !== session)
    throw new Error('附件不可用或没有访问权限');
  const extension = photoExtensions[response.mime?.split(';')[0]] || '.bin';
  const localPath = `${wx.env.USER_DATA_PATH}/${mediaPrefix}${Date.now()}-${++fileNumber}${extension}`;
  wx.getFileSystemManager().writeFileSync(localPath, response.file, 'base64');
  return localPath;
}

async function upload(contentId, filePath, comment = false) {
  const { session } = getApp();
  if (!session || !/^[0-9a-f-]{36}$/.test(contentId)) throw new Error('请先登录');
  const fs = wx.getFileSystemManager();
  if (fs.statSync(filePath).size > maxFile) throw new Error('此附件超过小程序云调用上限，请在社区网页上传');
  const response = await callCloud({ action: 'api', method: 'POST', session,
    path: `/api/contents/${contentId}/${comment ? 'comment-files' : 'files'}`,
    filename: filePath.split('/').pop(), file: fs.readFileSync(filePath, 'base64') });
  return handle(response, session);
}

function clearMedia() {
  try {
    const fs = wx.getFileSystemManager();
    const directory = wx.env.USER_DATA_PATH;
    for (const file of fs.readdirSync(directory)) {
      if (!file.startsWith(mediaPrefix)) continue;
      try { fs.unlinkSync(`${directory}/${file}`); } catch {}
    }
  } catch {}
}

function openContent(id) {
  if (/^[0-9a-f-]{36}$/.test(id || '')) wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
}

function notify(error) {
  wx.showToast({ title: error.message || String(error), icon: 'none', duration: 2600 });
}

module.exports = { request, signIn, accountSignIn, getCaptcha, download, upload, clearMedia, openContent, notify, origin };
