const { pager, listState, contentCard, selectTab } = require('../../lib/list');
const { request, notify, origin } = require('../../lib/api');

Page({
  ...pager((data) => `/contents?mine=${data.tab}`, contentCard),
  data: { ...listState, tab: 'all', user: null, initial: '', honors: null, loggingOut: false, tabs: [
    { value: 'all', label: '发布' }, { value: 'draft', label: '草稿' }, { value: 'review', label: '待审' },
    { value: 'rejected', label: '退回' }, { value: 'bookmarks', label: '收藏' }, { value: 'downloads', label: '下载' },
  ] },
  onShow() {
    selectTab(this);
    const { user } = getApp();
    this.setData({ user, initial: Array.from(user?.name || '鱼').slice(-2).join('') });
    this.load();
    if (user) request('/honors/me').then((honors) => this.setData({ honors })).catch(notify);
  },
  filter(event) {
    const { tab } = event.currentTarget.dataset;
    if (tab === this.data.tab) return;
    this.setData({ tab, items: [], more: false });
    this.load();
  },
  async logout() {
    if (this.data.loggingOut) return;
    this.setData({ loggingOut: true });
    try { await request('/auth/logout', 'POST', {}); getApp().resetSession(); }
    catch (error) { notify(error); }
    finally { this.setData({ loggingOut: false }); }
  },
  binding() { wx.setClipboardData({ data: `${origin}/wechat` }); },
});
