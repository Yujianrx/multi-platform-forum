const { request, download, upload, notify } = require('../../lib/api');
const { date, statuses, types } = require('../../lib/list');
const { stickers, commentBody } = require('../../lib/stickers');
const commentLimit = 5000;

const fieldLabels = { problem: '问题背景', techStack: '技术栈', usage: '使用方法', members: '成员',
  demoUrl: '演示地址', repoUrl: '仓库地址', tool: '工具', dependencies: '依赖', installation: '安装方法',
  example: '示例', version: '版本', changelog: '更新记录', prompt: '提示词', scenario: '使用场景', input: '输入', result: '效果' };

Page({
  data: { item: null, fields: [], files: [], replies: [], versions: [], page: 0, more: false, comment: '',
    commentFiles: [], commentStickers: [], stickers, stickerPickerOpen: false, stickerScrollTarget: '',
    parentId: '', parentName: '', loading: false, error: '', replying: false, action: false,
    repliesLoading: false, repliesError: '', replyError: '', focusReply: false,
    openingFile: '', documentPreview: null, versionsOpen: false, versionsLoading: false, versionsError: '' },
  onLoad(options) {
    this.cid = /^[0-9a-f-]{36}$/.test(options.id || '') ? options.id : '';
    this.revision = /^[0-9a-f-]{36}$/.test(options.revision || '') ? options.revision : '';
    this.load();
  },
  onShow() { if (this.hasShown) this.load(); this.hasShown = true; },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (this.data.loading) return;
    if (!this.cid) { this.setData({ error: '内容不存在' }); return; }
    this.setData({ loading: true, error: '' });
    try {
      const item = await request(`/contents/${this.cid}${this.revision ? '?revision=' + this.revision : ''}`);
      const revision = item.revision;
      const fields = Object.entries(revision?.data?.fields || {}).filter(([key, value]) => value && fieldLabels[key])
        .map(([key, value]) => ({ key, label: fieldLabels[key], value }));
      const files = item.files.filter((file) => file.id !== revision?.data?.coverId && !item.bodyBlocks.some((block) => block.path === `/api/files/${file.id}`));
      const type = types.find((row) => row.value === item.type);
      const topic = item.type === 'discussion' ? await request(`/forum/topics/${this.cid}`) : null;
      this.setData({ item, topic, fields, files, typeLabel: type?.label, state: statuses[revision?.status || item.state],
        published: item.state === 'published' && revision?.status === 'approved',
        owner: item.author_id === getApp().user?.id, date: date(item.published_at || item.updated_at) });
      if (!this.visited && !this.revision && this.data.published) {
        this.visited = true;
        request(`${topic ? '/forum/topics' : '/contents'}/${this.cid}/visit`, 'POST', {}).catch(() => {});
      }
      await this.replies(true);
    } catch (error) { this.setData({ item: null, error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  async replies(reset) {
    if (this.data.repliesLoading || (!reset && !this.data.more)) return;
    this.setData({ repliesLoading: true, repliesError: '' });
    try {
      const page = reset ? 1 : this.data.page + 1;
      const result = await request(`/contents/${this.cid}/comments?page=${page}&limit=20`);
      const items = result.items.map((reply) => ({ ...reply, date: date(reply.created_at), state: statuses[reply.status] }));
      this.setData({ replies: reset ? items : [...this.data.replies, ...items], page, more: page * 20 < result.total });
    } catch (error) {
      this.retryRepliesFromStart = reset;
      this.setData({ repliesError: error.message });
    } finally { this.setData({ repliesLoading: false }); }
  },
  retryReplies() { this.replies(this.retryRepliesFromStart); },
  onReachBottom() { if (!this.data.repliesError) this.replies(false); },
  async toggle(event) {
    if (this.data.action) return;
    const key = event.currentTarget.dataset.key;
    const metric = key === 'like' ? 'liked' : 'bookmarked';
    const active = !this.data.item.metrics[metric];
    this.setData({ action: true });
    try {
      const { metrics } = await request(`/contents/${this.cid}/${key}`, 'PUT', { active });
      for (const [name, value] of Object.entries(metrics)) this.setData({ [`item.metrics.${name}`]: value });
    } catch (error) { notify(error); }
    finally { this.setData({ action: false }); }
  },
  async follow() {
    if (this.data.action) return;
    const active = !this.data.topic.following;
    this.setData({ action: true });
    try { await request(`/forum/topics/${this.cid}/follow`, 'PUT', { active }); this.setData({ 'topic.following': active }); }
    catch (error) { notify(error); }
    finally { this.setData({ action: false }); }
  },
  commentInput(event) { this.setData({ comment: event.detail.value, replyError: '' }); },
  commentBlur() { this.setData({ focusReply: false }); },
  toggleStickerPicker() {
    if (this.data.replying) return;
    const stickerPickerOpen = !this.data.stickerPickerOpen;
    this.setData({ stickerPickerOpen, focusReply: false }, () => {
      if (!stickerPickerOpen) return;
      wx.hideKeyboard?.({ fail() {} });
      wx.pageScrollTo({ selector: '#comment-stickers', duration: 220 });
    });
  },
  addReplySticker(event) {
    if (this.data.replying) return;
    const sticker = stickers.find((item) => item.id === event.currentTarget.dataset.id);
    if (!sticker) return;
    const key = (this.stickerSequence || 0) + 1;
    const commentStickers = [...this.data.commentStickers, { ...sticker, key }];
    if (commentBody(this.data.comment, commentStickers).length > commentLimit) {
      this.setData({ replyError: '内容已达 5000 字符上限，缩短文字后可再添加表情包' });
      return;
    }
    this.stickerSequence = key;
    this.setData({ commentStickers, stickerScrollTarget: `sticker-${key}`, replyError: '' });
  },
  removeReplySticker(event) {
    if (this.data.replying) return;
    const key = Number(event.currentTarget.dataset.key);
    this.setData({ commentStickers: this.data.commentStickers.filter((item) => item.key !== key), stickerScrollTarget: '', replyError: '' });
  },
  quote(event) {
    const { id, name } = event.currentTarget.dataset;
    this.setData({ parentId: id, parentName: name, focusReply: true, stickerPickerOpen: false });
  },
  cancelQuote() { this.setData({ parentId: '', parentName: '', focusReply: false }); },
  async addReplyFile() {
    if (this.data.replying || this.data.commentFiles.length >= 10) return;
    this.setData({ replying: true });
    try {
      const selected = await wx.chooseMessageFile({ count: 1, type: 'all' }).catch(() => null);
      if (selected?.tempFiles?.[0]) {
        const file = await upload(this.cid, selected.tempFiles[0].path, true);
        this.setData({ commentFiles: [...this.data.commentFiles, file] });
      }
    } catch (error) { notify(error); }
    finally { this.setData({ replying: false }); }
  },
  removeReplyFile(event) {
    if (this.data.replying) return;
    this.setData({ commentFiles: this.data.commentFiles.filter((file) => file.id !== event.currentTarget.dataset.id) });
  },
  async reply() {
    if (this.data.replying) return;
    const body = commentBody(this.data.comment, this.data.commentStickers);
    if (!body.trim() && !this.data.commentFiles.length) return;
    if (body.trim().length > commentLimit) {
      this.setData({ replyError: '评论文字和表情包合计最多 5000 字符' });
      return;
    }
    this.setData({ replying: true, replyError: '' });
    try {
      const attachments = this.data.commentFiles.map((file) => file.id);
      const result = await request(`/contents/${this.cid}/comments`, 'POST', { body, attachments, parentId: this.data.parentId || null });
      this.setData({
        comment: '', commentFiles: [], commentStickers: [], stickerPickerOpen: false, stickerScrollTarget: '',
        parentId: '', parentName: '', focusReply: false,
      });
      await this.replies(true);
      if (result.status === 'approved') this.setData({ 'item.metrics.comments': this.data.item.metrics.comments + 1 });
      wx.showToast({ title: statuses[result.status] || '已提交', icon: 'none' });
    } catch (error) { this.setData({ replyError: error.message }); }
    finally { this.setData({ replying: false }); }
  },
  async openFile(event) {
    const { id, name, image, comment, pending } = event.currentTarget.dataset;
    if (this.data.openingFile || pending) return;
    const ext = String(name).split('.').pop().toLowerCase();
    const supported = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md', 'csv', 'json'];
    if (!image && !supported.includes(ext)) { notify('请在社区网页下载此格式'); return; }
    const revision = !comment && this.data.item.revision?.id;
    this.setData({ openingFile: id });
    try {
      const path = await download(`/api/files/${id}?${revision ? 'revision=' + revision + '&' : ''}download=1`);
      if (image) await wx.previewImage({ urls: [path] });
      else if (['txt', 'md', 'csv', 'json'].includes(ext)) {
        const filesystem = wx.getFileSystemManager();
        const text = filesystem.readFileSync(path, 'utf8', 0, Math.min(filesystem.statSync(path).size, 50000));
        this.setData({ documentPreview: { name, text } });
      } else await wx.openDocument({ filePath: path, fileType: ext, showMenu: false });
    } catch (error) { notify(error.message || '文件预览失败'); }
    finally { this.setData({ openingFile: '' }); }
  },
  closeFile() { this.setData({ documentPreview: null }); },
  copyField(event) { wx.setClipboardData({ data: event.currentTarget.dataset.value }); },
  edit() { wx.navigateTo({ url: `/pages/edit/index?id=${this.cid}` }); },
  async listVersions() {
    if (this.data.versionsLoading) return;
    if (this.data.versionsOpen) { this.setData({ versionsOpen: false }); return; }
    this.setData({ versionsOpen: true });
    await this.loadVersions();
  },
  async loadVersions() {
    if (this.data.versionsLoading) return;
    this.setData({ versionsLoading: true, versionsError: '' });
    try {
      const result = await request(`/contents/${this.cid}/versions`);
      this.setData({ versions: result.items.map((item) => ({ ...item, date: date(item.created_at) })) });
    } catch (error) { this.setData({ versionsError: error.message }); }
    finally { this.setData({ versionsLoading: false }); }
  },
  openVersion(event) { wx.navigateTo({ url: `/pages/detail/index?id=${this.cid}&revision=${event.currentTarget.dataset.id}` }); },
});
