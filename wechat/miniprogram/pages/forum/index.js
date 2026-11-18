const { pager, listState, date, selectTab, searchActions, previewText } = require('../../lib/list');
const kinds = { question: '问答', discussion: '交流', feedback: '建议', chat: '闲聊' };

Page({
  ...pager((data) => `/forum/topics?sort=${data.sort}&q=${encodeURIComponent(data.query)}`, (item) => ({
    ...item, date: date(item.created_at || item.last_activity), preview: previewText(item.summary), kindLabel: kinds[item.kind] || '交流',
    initial: Array.from(item.author || '').slice(0, 2).join(''),
  })),
  ...searchActions,
  data: { ...listState, query: '', searchTerm: '', sort: 'active', sorts: [{ value: 'active', name: '最新回复' }, { value: 'newest', name: '最新发布' }, { value: 'unanswered', name: '待回复' }] },
  onShow() { selectTab(this); this.load(); },
  filter(event) {
    const { sort } = event.currentTarget.dataset;
    if (sort === this.data.sort) return;
    this.setData({ sort, items: [], more: false });
    this.load();
  },
  publish() { wx.navigateTo({ url: '/pages/edit/index?type=discussion' }); },
});
