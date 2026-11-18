const { cloudEnv } = require('./config');
const { clearMedia } = require('./lib/api');

App({
  session: '',
  user: null,
  onLaunch() {
    clearMedia();
    if (cloudEnv && wx.cloud) wx.cloud.init({ env: cloudEnv });
  },
  resetSession() {
    this.session = '';
    this.user = null;
    clearMedia();
    wx.reLaunch({ url: '/pages/home/index' });
  },
});
