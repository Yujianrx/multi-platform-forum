const { request, upload, notify } = require('../../lib/api');
const { types, statuses } = require('../../lib/list');

const kinds = [{ value: 'discussion', label: '讨论' }, { value: 'question', label: '提问' },
  { value: 'feedback', label: '反馈' }, { value: 'chat', label: '闲聊' }];
const fieldLabels = { problem: '问题背景', techStack: '技术栈', usage: '使用方法', members: '成员',
  demoUrl: '演示地址', repoUrl: '仓库地址', tool: '工具', dependencies: '依赖', installation: '安装方法',
  example: '示例', version: '版本', changelog: '更新记录', prompt: '提示词', scenario: '使用场景', input: '输入', result: '效果' };
const fields = {
  experience: ['tool', 'problem', 'usage', 'result'], project: ['problem', 'techStack', 'usage', 'members', 'demoUrl', 'repoUrl', 'version', 'changelog'],
  skill: ['tool', 'dependencies', 'installation', 'example', 'version', 'changelog'], prompt: ['prompt', 'scenario', 'input', 'result', 'tool'], discussion: [],
};
const empty = { title: '', summary: '', body: '', categoryId: '', tags: [], visibility: 'company', departments: [], coverId: null, attachments: [], fields: {} };
const fieldList = (type, data) => fields[type].map((key) => ({ key, label: fieldLabels[key], value: data.fields?.[key] || '' }));
const attachmentFiles = (files, ids) => files.filter((file) => ids.includes(file.id));

Page({
  data: { type: 'experience', typeIndex: 0, kindIndex: 0, types, kinds, draft: empty, categoryIndex: 0, categories: [],
    departments: [], tags: [], selectedDepartments: {}, selectedTags: {}, fields: [], attachmentFiles: [], error: '', ready: false, busy: false, existing: false,
    focusTitle: false, titleError: false, keyboardOpen: false, saveError: '', operation: '' },
  async onLoad(options) {
    if (!getApp().session) { wx.switchTab({ url: '/pages/home/index' }); return; }
    this.cid = /^[0-9a-f-]{36}$/.test(options.id || '') ? options.id : '';
    this.revision = null;
    this.initialType = options.type === 'discussion' ? 'discussion' : 'experience';
    this.onKeyboardChange = ({ height }) => {
      const keyboardOpen = height > 0;
      if (keyboardOpen !== this.data.keyboardOpen) this.setData({ keyboardOpen });
    };
    wx.onKeyboardHeightChange?.(this.onKeyboardChange);
    await this.load();
  },
  onUnload() {
    if (this.onKeyboardChange) wx.offKeyboardHeightChange?.(this.onKeyboardChange);
  },
  async load() {
    this.setData({ error: '' });
    try {
      const taxonomy = await request('/taxonomy');
      const content = this.cid ? await request(`/contents/${this.cid}?edit=1`) : null;
      const type = content?.type || this.initialType;
      const topic = content?.type === 'discussion' ? await request(`/forum/topics/${this.cid}`) : null;
      const draft = { ...empty, ...content?.revision?.data };
      draft.categoryId ||= content?.category_id || taxonomy.categories[0]?.id || '';
      this.revision = content?.revision?.id || null;
      this.setData({ type, typeIndex: types.findIndex((row) => row.value === type), kindIndex: Math.max(0, kinds.findIndex((row) => row.value === topic?.kind)),
        draft, categoryIndex: Math.max(0, taxonomy.categories.findIndex((row) => row.id === draft.categoryId)), categories: taxonomy.categories,
        departments: taxonomy.departments, tags: taxonomy.tags, selectedDepartments: Object.fromEntries(draft.departments.map((id) => [id, true])),
        selectedTags: Object.fromEntries(draft.tags.map((name) => [name, true])), fields: fieldList(type, draft), attachmentFiles: attachmentFiles(content?.files || [], draft.attachments),
        existing: Boolean(this.cid), ready: true, hasDraft: content?.revision?.status === 'draft',
      });
    } catch (error) { this.setData({ error: error.message }); }
  },
  dirty() { wx.enableAlertBeforeUnload?.({ message: '还有修改未保存，确定离开吗？' }); },
  selectType(event) {
    const typeIndex = Number(event.detail.value);
    const type = types[typeIndex].value;
    this.setData({ type, typeIndex, 'draft.fields': {}, fields: fieldList(type, { fields: {} }) });
    this.dirty();
  },
  selectKind(event) { this.setData({ kindIndex: Number(event.detail.value) }); this.dirty(); },
  selectCategory(event) {
    const categoryIndex = Number(event.detail.value);
    this.setData({ categoryIndex, 'draft.categoryId': this.data.categories[categoryIndex].id });
    this.dirty();
  },
  input(event) {
    const { key } = event.currentTarget.dataset;
    this.setData({ [`draft.${key}`]: event.detail.value, saveError: '' });
    if (key === 'title' && this.data.titleError) this.setData({ titleError: false });
    this.dirty();
  },
  titleBlur() { this.setData({ focusTitle: false }); },
  inputField(event) {
    const { key, index } = event.currentTarget.dataset;
    this.setData({ [`draft.fields.${key}`]: event.detail.value, [`fields[${index}].value`]: event.detail.value });
    this.dirty();
  },
  visibility(event) {
    const { value } = event.currentTarget.dataset;
    if (this.data.busy || value === this.data.draft.visibility) return;
    this.setData({ 'draft.visibility': value });
    this.dirty();
  },
  toggleValue(event) {
    if (this.data.busy) return;
    const { key, value } = event.currentTarget.dataset;
    const selected = key === 'departments' ? 'selectedDepartments' : 'selectedTags';
    const values = this.data.draft[key];
    const active = !values.includes(value);
    if (active && key === 'tags' && values.length >= 10) { notify('最多选择 10 个标签'); return; }
    this.setData({ [`draft.${key}`]: active ? [...values, value] : values.filter((item) => item !== value),
      [selected]: { ...this.data[selected], [value]: active } });
    this.dirty();
  },
  async ensureDraft() {
    if (this.cid) return;
    const { type, kindIndex, draft } = this.data;
    if (!draft.categoryId) throw new Error('请选择分类');
    const result = type === 'discussion'
      ? await request('/forum/topics', 'POST', { categoryId: draft.categoryId, kind: kinds[kindIndex].value })
      : await request('/contents', 'POST', { type, categoryId: draft.categoryId });
    this.cid = result.id;
    this.setData({ existing: true });
  },
  async addFile(event) {
    if (this.data.busy) return;
    const { use } = event.currentTarget.dataset;
    if (use === 'attachment' && this.data.draft.attachments.length >= 30) { notify('最多上传 30 个附件'); return; }
    this.setData({ busy: true, operation: use });
    try {
      const selected = use === 'attachment' ? await wx.chooseMessageFile({ count: 1, type: 'all' }).catch(() => null)
        : await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] }).catch(() => null);
      const filePath = selected?.tempFiles?.[0]?.path || selected?.tempFiles?.[0]?.tempFilePath;
      if (!filePath) return;
      await this.ensureDraft();
      const file = await upload(this.cid, filePath);
      const draft = this.data.draft;
      const key = use === 'cover' ? 'coverId' : use === 'body' ? 'body' : 'attachments';
      const value = use === 'cover' ? file.id : use === 'body' ? `${draft.body}\n\n![图片](/api/files/${file.id})\n` : [...draft.attachments, file.id];
      this.setData({ [`draft.${key}`]: value });
      if (use === 'attachment') this.setData({ attachmentFiles: [...this.data.attachmentFiles, file] });
      this.dirty();
    } catch (error) { notify(error); }
    finally { this.setData({ busy: false, operation: '' }); }
  },
  removeAttachment(event) {
    if (this.data.busy) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ 'draft.attachments': this.data.draft.attachments.filter((item) => item !== id),
      attachmentFiles: this.data.attachmentFiles.filter((file) => file.id !== id) });
    this.dirty();
  },
  removeCover() {
    if (this.data.busy) return;
    this.setData({ 'draft.coverId': null });
    this.dirty();
  },
  async save(event) {
    if (this.data.busy) return;
    const submit = event.currentTarget.dataset.submit;
    if (!this.data.draft.title.trim()) {
      wx.pageScrollTo({ selector: '#draft-title', duration: 180 });
      this.setData({ titleError: true, focusTitle: true, saveError: '' });
      return;
    }
    this.setData({ busy: true, operation: submit ? 'publish' : 'save', saveError: '' });
    try {
      await this.ensureDraft();
      const result = await request(`/contents/${this.cid}`, 'PUT', { data: this.data.draft, submit, baseRevisionId: this.revision });
      this.revision = result.revisionId;
      this.setData({ hasDraft: !submit });
      wx.disableAlertBeforeUnload?.();
      wx.showToast({ title: submit ? statuses[result.status] || '已提交审核' : '草稿已保存', icon: 'none' });
      if (submit) wx.switchTab({ url: '/pages/mine/index' });
    } catch (error) { this.setData({ saveError: error.message }); }
    finally { this.setData({ busy: false, operation: '' }); }
  },
  async discard() {
    if (this.data.busy || !this.revision || this.confirmingDiscard) return;
    this.confirmingDiscard = true;
    try {
      const result = await wx.showModal({ title: '删除草稿', content: '确定删除当前草稿版本？', confirmText: '删除', confirmColor: '#c52539' });
      if (!result.confirm) return;
      this.setData({ busy: true, operation: 'discard', saveError: '' });
      await request(`/contents/${this.cid}/draft`, 'DELETE', { revisionId: this.revision });
      wx.disableAlertBeforeUnload?.();
      wx.switchTab({ url: '/pages/mine/index' });
    } catch (error) { this.setData({ saveError: error.message }); }
    finally {
      this.confirmingDiscard = false;
      this.setData({ busy: false, operation: '' });
    }
  },
});
