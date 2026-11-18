const https = require('node:https');
const cloud = require('wx-server-sdk');
const { communityApi } = require('./community-api');
const { communityOrigin } = require('./config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function exchange(payload, secret) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(communityOrigin() + '/api/mini/bridge', {
      method: 'POST',
      timeout: 7000,
      headers: {
        Authorization: `MiniBridge ${secret}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
        if (data.length > 8192) response.destroy(new Error('Response too large'));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (response.statusCode === 200) resolve(result);
          else if (response.statusCode === 403) resolve({ error: '请在社区网页核对账号状态' });
          else resolve({ error: '社区账号服务暂不可用，请稍后重试' });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.end(body);
  });
}

exports.main = async (event) => {
  try { communityOrigin(); } catch { return { error: '请配置云函数 COMMUNITY_ORIGIN 为论坛 HTTPS 地址' }; }
  const { APPID, OPENID } = cloud.getWXContext();
  const { MINIPROGRAM_APP_ID, MINIPROGRAM_BRIDGE_SECRET } = process.env;
  if (!OPENID || !APPID || APPID !== MINIPROGRAM_APP_ID || !MINIPROGRAM_BRIDGE_SECRET)
    return { error: '微信云开发尚未完成配置' };
  if (event?.action === 'api') return communityApi(event);
  if (!['begin', 'exchange', 'phone'].includes(event?.action)) return { error: '操作无效' };
  const payload = { appId: APPID, openId: OPENID, action: event.action };
  if (event.action === 'phone') {
    if (typeof event.code !== 'string' || !/^[\w-]{8,256}$/.test(event.code))
      return { error: '请在微信重新授权手机号' };
    try {
      const result = await cloud.openapi.phonenumber.getPhoneNumber({ code: event.code });
      const info = result.phoneInfo || result.phone_info;
      if ((result.errCode || result.errcode || 0) !== 0 || !info ||
          !/^\d{1,4}$/.test(info.countryCode) || !/^\d{6,14}$/.test(info.purePhoneNumber) ||
          (info.watermark?.appid && info.watermark.appid !== APPID))
        return { error: '手机号验证失败，请用社区账号登录' };
      payload.phone = `+${info.countryCode}${info.purePhoneNumber}`;
    } catch {
      return { error: '微信手机号验证暂不可用，请用社区账号登录' };
    }
  }
  try {
    return await exchange(payload, MINIPROGRAM_BRIDGE_SECRET);
  } catch {
    return { error: '社区账号服务暂不可用，请稍后重试' };
  }
};
