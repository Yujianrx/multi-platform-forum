const { request, openContent } = require('./api');

const types = [
  { value: 'experience', label: '经验分享' }, { value: 'project', label: '开发项目' },
  { value: 'skill', label: '技能包' }, { value: 'prompt', label: '提示词' },
  { value: 'discussion', label: '讨论' },
];
const statuses = { draft: '草稿', rejected: '已退回', review: '待复核', queued: '待审核',
  published: '已发布', approved: '已发布', withdrawn: '已下架' };
const date = (value) => value ? String(value).slice(0, 10) : '';

function selectTab(page) {
  page.getTabBar?.()?.setData({ selected: page.route, canPublish: Boolean(getApp().session) });
}

function previewText(value = '') {
  return (value || '').replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1').replace(/<[^>]*>/g, '')
    .replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim();
}

function pager(endpoint, format = (item) => item) {
  return {
    async load(reset = true) {
      const session = getApp().session;
      if (!session) {
        this.sequence = (this.sequence || 0) + 1;
        this.failedPage = undefined;
        this.setData({ signedIn: false, items: [], loading: false, loadingMore: false, error: '', more: false });
        return;
      }
      if (!reset && (this.data.loading || !this.data.more)) return;
      const sequence = this.sequence = (this.sequence || 0) + 1;
      const page = reset ? 1 : this.data.page + 1;
      const path = endpoint(this.data);
      this.failedPage = undefined;
      this.setData({ signedIn: true, loading: true, loadingMore: !reset, error: '' });
      try {
        const result = await request(`${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=12`);
        if (sequence !== this.sequence || getApp().session !== session) return;
        const next = result.items.map(format);
        const items = reset ? next : [...new Map([...this.data.items, ...next].map((item) => [item.id, item])).values()];
        this.setData({ items, page, more: page * 12 < result.total, unread: result.unread || 0 });
      } catch (error) {
        if (sequence === this.sequence && getApp().session === session) {
          this.failedPage = page;
          this.setData({ error: error.message });
        }
      } finally {
        if (sequence === this.sequence) this.setData({ loading: false, loadingMore: false });
      }
    },
    reload() { if (!this.data.loading) return this.load(!(this.failedPage > 1)); },
    onReachBottom() { if (!this.failedPage) return this.load(false); },
    async onPullDownRefresh() {
      try { await this.load(); } finally { wx.stopPullDownRefresh(); }
    },
    open(event) { openContent(event.currentTarget.dataset.id); },
    login() { wx.switchTab({ url: '/pages/home/index' }); },
  };
}

function contentCard(item) {
  return { ...item, typeLabel: types.find((type) => type.value === item.type)?.label,
    stateLabel: statuses[item.status || item.state], date: date(item.published_at || item.updated_at),
    preview: previewText(item.summary), initial: Array.from(item.author || '').slice(0, 2).join('') };
}

const searchActions = {
  searchInput(event) { this.setData({ searchTerm: event.detail.value }); },
  search(event) {
    const query = (event?.detail?.value ?? this.data.searchTerm).trim();
    if (query === this.data.query) return;
    this.setData({ searchTerm: query, query, items: [], more: false });
    return this.load();
  },
  clearSearch() { this.setData({ searchTerm: '' }); return this.search(); },
};

const listState = { signedIn: false, loading: false, loadingMore: false, error: '', items: [], page: 0, more: false };
module.exports = { pager, listState, contentCard, types, statuses, date, selectTab, searchActions, previewText };
