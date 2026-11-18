const { openContent } = require('../../lib/api');
Component({
  properties: { item: Object },
  data: { coverReady: false },
  observers: { 'item.cover_id'() { this.setData({ coverReady: false }); } },
  methods: {
    open() { openContent(this.data.item.id); },
    coverLoaded() { this.setData({ coverReady: true }); },
  },
});
