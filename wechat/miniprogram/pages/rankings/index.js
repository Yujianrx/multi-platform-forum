const { pager, listState } = require('../../lib/list');

Page({
  ...pager((data) => data.tab === 'contribution' ? '/honors/board' : `/rankings?metric=${data.tab}&period=${data.period}`, (item) => ({ ...item, id: item.id || item.user_id })),
  data: { ...listState, tab: 'contribution', period: 'week', tabs: [
    { value: 'contribution', label: '本周贡献' }, { value: 'likes', label: '点赞' }, { value: 'views', label: '浏览' }, { value: 'downloads', label: '下载' },
  ], periods: [{ value: 'week', label: '近 7 天' }, { value: 'month', label: '近 30 天' }, { value: 'all', label: '累计' }] },
  onShow() { this.load(); },
  filter(event) {
    const { key, value } = event.currentTarget.dataset;
    if (this.data[key] === value) return;
    this.setData({ [key]: value, items: [], more: false });
    this.load();
  },
  openRank(event) { if (this.data.tab !== 'contribution') this.open(event); },
});
