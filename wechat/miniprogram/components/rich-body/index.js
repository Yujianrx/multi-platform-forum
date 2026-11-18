Component({
  properties: { blocks: Array, revision: String },
  data: { display: [] },
  observers: {
    'blocks,revision'(blocks, revision) {
      this.setData({ display: (blocks || []).map((block, key) => ({
        ...block, key,
        sticker: /^\/stickers\/[a-z]+\.svg$/.test(block.path || ''),
        path: revision && block.path?.startsWith('/api/files/') ? `${block.path}?revision=${revision}` : block.path || '',
      })) });
    },
  },
});
