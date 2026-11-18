const tabs = [
  { key: 'home', label: '首页' },
  { key: 'forum', label: '讨论' },
  { key: 'messages', label: '消息' },
  { key: 'mine', label: '我的' },
].map((tab) => ({ ...tab, route: `pages/${tab.key}/index` }));

function currentPage() {
  const pages = getCurrentPages();
  return pages[pages.length - 1];
}

Component({
  data: { tabs, selected: tabs[0].route, canPublish: false },
  lifetimes: {
    attached() { this.syncSelection(); },
  },
  pageLifetimes: {
    show() { this.syncSelection(); },
  },
  methods: {
    syncSelection() {
      const route = currentPage()?.route;
      if (tabs.some((tab) => tab.route === route)) {
        this.setData({ selected: route, canPublish: Boolean(getApp().session) });
      }
    },
    select(event) {
      const { route } = event.currentTarget.dataset;
      const page = currentPage();
      if (page?.route === route) {
        page.onTabItemTap?.();
        return;
      }
      wx.switchTab({ url: `/${route}` });
    },
    publish() {
      if (!getApp().session) return;
      const page = currentPage();
      if (page?.publish) page.publish();
      else wx.navigateTo({ url: '/pages/edit/index' });
    },
  },
});
