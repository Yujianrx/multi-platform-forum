const { pager, contentCard, types, listState, selectTab, searchActions } = require('../../lib/list');
const { signIn, accountSignIn, getCaptcha, origin } = require('../../lib/api');
const feedTypes = types.slice(0, 4).map((type, index) => ({ ...type, short: ['经验', '项目', '技能包', '提示词'][index] }));
const banners = [
  { type: 'experience', image: '/assets/home-banner.webp', title: '把好经验分享出来，让讨论更有收获。' },
  { type: 'project', image: '/assets/projects-banner.webp', title: '让好想法，长成好项目。' },
  { type: 'skill', image: '/assets/skills-banner.webp', title: '少一点重复，多一点创造。' },
];

Page({
  ...pager((data) => `/contents?resources=1${data.type ? '&type=' + data.type : ''}${data.channel === 'featured' ? '&featured=1' : ''}&q=${encodeURIComponent(data.query)}`, contentCard),
  ...searchActions,
  data: { ...listState, origin, types: feedTypes, banners, type: '', channel: 'latest', query: '', searchTerm: '', searchOpen: false,
    authMode: '', captcha: '', captchaCode: '', loadingCaptcha: false, code: '', authError: '', signingIn: false },
  onShow() { selectTab(this); this.load(); },
  onTabItemTap() {
    const now = Date.now();
    if (getApp().session && now - (this.lastTap || 0) <= 500 && !this.data.loading) this.load();
    this.lastTap = now;
  },
  filter(event) {
    const { key, value } = event.currentTarget.dataset;
    this.selectFilter(key, value);
  },
  selectFilter(key, value) {
    if (this.data[key] === value) return;
    this.setData({ [key]: value, items: [], more: false });
    this.load();
  },
  showSearch() { this.setData({ searchOpen: true }); },
  closeSearch() { this.setData({ searchOpen: false }); this.clearSearch(); },
  discover(event) {
    const { type } = event.currentTarget.dataset;
    this.selectFilter('type', type);
    wx.pageScrollTo({ selector: '#resource-feed', duration: 240 });
  },
  changeAuthMode(event) {
    if (this.data.signingIn) return;
    const authMode = event.currentTarget.dataset.mode || '';
    this.setData({ authMode, authError: '', code: '' });
    if (authMode === 'login') this.refreshCaptcha();
  },
  async refreshCaptcha() {
    if (this.data.loadingCaptcha) return;
    this.setData({ loadingCaptcha: true, captcha: '' });
    try {
      const result = await getCaptcha(this.captchaToken);
      this.captchaToken = result.captchaToken;
      this.captchaId = result.id;
      this.setData({ captcha: result.image, captchaCode: '' });
    } catch (error) {
      this.captchaToken = '';
      this.setData({ authError: error.message });
    } finally { this.setData({ loadingCaptcha: false }); }
  },
  captchaInput(event) { this.setData({ captchaCode: event.detail.value }); },
  async submitAccount(event) {
    if (this.data.signingIn) return;
    const mode = this.data.authMode;
    if (mode !== 'login' && mode !== 'register') return;
    const values = event.detail.value;
    if (mode === 'login' && (!values.captchaCode || !this.captchaToken)) {
      this.setData({ authError: '请填写图片验证码' });
      return;
    }
    this.setData({ signingIn: true, authError: '' });
    try {
      await accountSignIn(mode, mode === 'login' ? { ...values, captchaId: this.captchaId } : values,
        mode === 'login' ? this.captchaToken : undefined);
      this.captchaToken = '';
      this.setData({ authMode: '', captcha: '', captchaCode: '' });
      selectTab(this);
      await this.load();
    } catch (error) {
      this.setData({ authError: error.message });
      if (mode === 'login') await this.refreshCaptcha();
    } finally { this.setData({ signingIn: false }); }
  },
  authenticate(event) { return this.authenticateWechat(event.currentTarget.dataset.action); },
  authorizePhone(event) {
    const code = event.detail?.code;
    if (!code) { this.setData({ authError: '手机号未获授权，你可以使用账号密码登录' }); return; }
    return this.authenticateWechat('phone', code);
  },
  async authenticateWechat(action, code) {
    if (this.data.signingIn) return;
    this.setData({ signingIn: true, authError: '' });
    try {
      const result = await signIn(action, code);
      if (result.state === 'signed-in') {
        this.setData({ code: '', authMode: '' });
        selectTab(this);
        await this.load();
      } else if (result.state === 'pending') {
        this.setData({ authMode: 'pair', code: result.code.match(/.{4}/g).join(' ') });
      } else if (result.state === 'phone-unmatched' || result.state === 'phone-conflict') {
        this.setData({ authError: '该手机号无法匹配社区账号，请用账号登录或联系管理员' });
      } else if (action === 'exchange') {
        this.setData({ authError: '请先在社区网页确认绑定，或重新获取配对码' });
      } else {
        this.setData({ authError: '绑定状态已变化，请重试' });
      }
    } catch (error) { this.setData({ authError: error.message }); }
    finally { this.setData({ signingIn: false }); }
  },
  copyCode() { wx.setClipboardData({ data: this.data.code }); },
  copyAddress() { wx.setClipboardData({ data: `${origin}/wechat` }); },
  publish() { wx.navigateTo({ url: '/pages/edit/index' }); },
  rankings() { wx.navigateTo({ url: '/pages/rankings/index' }); },
});
