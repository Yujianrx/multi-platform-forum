const { download } = require('../../lib/api');

Component({
  properties: { path: String, label: String, lazy: Boolean, mode: { type: String, value: 'aspectFill' } },
  data: { local: '' },
  observers: {
    path(path) {
      const sequence = this.sequence = (this.sequence || 0) + 1;
      this.setData({ local: '' });
      if (/^\/stickers\/[a-z]+\.svg$/.test(path)) {
        this.setData({ local: '/assets' + path });
        return;
      }
      if (!path) return;
      download(path).then((local) => {
        if (sequence === this.sequence) this.setData({ local });
      }).catch(() => {});
    },
  },
  lifetimes: { detached() { this.sequence += 1; } },
  methods: { loaded() { this.triggerEvent('loaded'); } },
});
