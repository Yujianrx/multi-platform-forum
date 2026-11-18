const { pager, listState, date, selectTab } = require('../../lib/list');
const { request, notify } = require('../../lib/api');

Page({
  ...pager(() => '/notifications', (item) => ({ ...item, date: date(item.created_at) })),
  data: { ...listState, unread: 0, marking: false },
  onShow() { selectTab(this); this.load(); },
  openMessage(event) { if (event.currentTarget.dataset.id) this.open(event); },
  async markRead() {
    if (this.data.marking) return;
    this.setData({ marking: true });
    try { await request('/notifications/read', 'POST', {}); await this.load(); }
    catch (error) { notify(error); }
    finally { this.setData({ marking: false }); }
  },
});
