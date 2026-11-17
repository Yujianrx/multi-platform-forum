import { useEditingGuard } from '../EditingGuard';
import { DeleteDraftButton, isDeletableDraft } from '../DraftActions';
import { MediaComposer, mediaAccept } from '../MediaComposer';
import { useEffect, useRef, useState } from 'react';
import { useMobile } from '../mobile/useMobile';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Sparkles,
  Code2,
  Package,
  Quote,
  ArrowLeft,
  ArrowRight,
  Save,
  Eye,
  UploadCloud,
  X,
  CheckCircle2,
  File,
  Image,
  Send,
  RefreshCw,
} from '../icons';
import { api, send, useApi, upload, typeLabels, size } from '../api';
import { useApp } from '../context';
import { Field, Loading, ErrorState, MarkdownBody, Badge } from '../components';
const emptyFields = {
  problem: '',
  techStack: '',
  usage: '',
  members: '',
  demoUrl: '',
  repoUrl: '',
  tool: '',
  dependencies: '',
  installation: '',
  example: '',
  version: '1.0.0',
  changelog: '',
  prompt: '',
  scenario: '',
  input: '',
  result: '',
};
export function Editor() {
  const mobile = useMobile();
  const [searchParams] = useSearchParams();
  const requestedType = searchParams.get('type');
  const startedType = useRef<string | null>(null);
  const { id } = useParams(),
    nav = useNavigate(),
    { toast, user } = useApp(),
    tax = useApi('/taxonomy'),
    content = useApi(id ? `/contents/${id}?edit=1` : null),
    files = useApi(id ? `/contents/${id}/files` : null);
  const [form, setForm] = useState<any>(null),
    [preview, setPreview] = useState(false),
    [saveState, setSaveState] = useState('所有修改会自动保存'),
    [saveError, setSaveError] = useState(''),
    [progress, setProgress] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [mediaBusy, setMediaBusy] = useState(false),
    [failedFile, setFailedFile] = useState<File | null>(null);
  const revision = useRef<string | null>(null),
    saved = useRef(''),
    current = useRef<any>(null),
    inFlight = useRef<Promise<any> | null>(null),
    alive = useRef(true);
  current.current = form;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!content.data) return;
    if (content.data.type === 'discussion') {
      nav('/forum/edit/' + id, { replace: true });
      return;
    }
    const initial = content.data.revision?.data || {
      title: '',
      summary: '',
      body: '',
      categoryId: content.data.category_id,
      tags: [],
      visibility: 'company',
      departments: [],
      coverId: null,
      attachments: [],
      fields: { ...emptyFields },
    };
    revision.current = content.data.latest_revision_id;
    saved.current = JSON.stringify(initial);
    setForm(initial);
  }, [content.data]);
  const update = (key: string, value: any) => setForm((f: any) => ({ ...f, [key]: value }));
  const field = (key: string, value: string) =>
    setForm((f: any) => ({ ...f, fields: { ...f.fields, [key]: value } }));
  const guard = useEditingGuard({
    enabled: !!id && !!form,
    isDirty: () => !!current.current && JSON.stringify(current.current) !== saved.current,
    busy: busy || mediaBusy || progress !== null || saveState === '正在保存…',
    save: () => save(),
  });
  useEffect(() => {
    const header = document.querySelector('.site-header');
    if (!header) return;
    const measure = () =>
      document.documentElement.style.setProperty(
        '--editor-header-height',
        header.getBoundingClientRect().height + 'px',
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [mobile]);
  async function save(submit = false): Promise<any> {
    while (inFlight.current) await inFlight.current;
    const value = current.current;
    if (!id || !value || (!submit && JSON.stringify(value) === saved.current)) return;
    setSaveState('正在保存…');
    setSaveError('');
    const task = send(
      '/contents/' + id,
      { data: value, submit, baseRevisionId: revision.current },
      'PUT',
    );
    inFlight.current = task;
    try {
      const result = await task;
      revision.current = result.revisionId;
      saved.current = JSON.stringify(value);
      if (alive.current)
        setSaveState(
          submit
            ? result.status === 'approved'
              ? '已发布'
              : '已提交审核'
            : '已保存 · ' +
                new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        );
      return result;
    } catch (e: any) {
      if (alive.current) {
        setSaveError(e.message);
        setSaveState('保存失败');
      }
      throw e;
    } finally {
      inFlight.current = null;
    }
  }
  useEffect(() => {
    if (
      busy ||
      guard.blocked ||
      !form ||
      !form.title.trim() ||
      (form.visibility === 'departments' && !form.departments.length)
    )
      return;
    const timer = setTimeout(() => save().catch(() => {}), 1600);
    return () => clearTimeout(timer);
  }, [form, busy, guard.blocked]);
  async function create(type: string) {
    if (!tax.data?.categories.length) {
      toast('请管理员先创建分类', true);
      return;
    }
    setBusy(true);
    try {
      const c = await send('/contents', { type, categoryId: tax.data.categories[0].id });
      nav('/editor/' + c.id);
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  // Mobile's type picker enters the same creation/save/upload pipeline.
  // The ref prevents duplicate draft creation on repeated effect execution.
  useEffect(() => {
    if (id) {
      startedType.current = null;
      return;
    }
    if (
      !tax.data ||
      !requestedType ||
      !['experience', 'project', 'skill', 'prompt'].includes(requestedType) ||
      startedType.current === requestedType
    )
      return;
    startedType.current = requestedType;
    void create(requestedType);
  }, [id, requestedType, tax.data]);
  async function doUpload(file: File) {
    if (!id) return;
    setFailedFile(null);
    setProgress(0);
    try {
      const result = await upload(id, file, setProgress);
      files.reload();
      setForm((f: any) =>
        result.kind === 'image'
          ? { ...f, coverId: f.coverId || result.id }
          : { ...f, attachments: [...new Set([...f.attachments, result.id])] },
      );
      toast(result.scan_status === 'clean' ? '上传成功' : '已上传，将随正文一起审核');
    } catch (e: any) {
      setFailedFile(file);
      toast(e.message, true);
    } finally {
      setProgress(null);
    }
  }
  async function submit() {
    if (busy || mediaBusy || progress !== null) return;
    setBusy(true);
    try {
      const result = await save(true);
      toast(
        result.status === 'approved'
          ? '内容已发布'
          : result.status === 'review'
            ? '正文与附件等待审核，可在个人中心查看'
            : '已提交审核，可在个人中心查看进度',
      );
      guard.allowNavigation();
      nav(result.status === 'approved' ? '/content/' + id : '/me?tab=review');
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  if (!id)
    return (
      <div className="editor-start">
        <Link className="back-link" to="/">
          <ArrowLeft size={16} />
          返回社区
        </Link>
        <span className="eyebrow">MAKE YOUR IDEAS COUNT</span>
        <h1>今天，想分享点什么？</h1>
        <p className="muted">选择一种方式，把你的实践和灵感留在这里。</p>
        <Link className="button secondary" to="/forum/new">
          想提问、交流或给建议？发起论坛话题 <ArrowRight size={16} />
        </Link>
        {tax.error && <ErrorState message={tax.error} retry={tax.reload} />}
        <div className="type-selection">
          {[
            [Sparkles, 'experience', '经验分享', '一个方法、一次尝试，或一份避坑指南。'],
            [Code2, 'project', '开发项目', '展示你用 AI 创造的产品和解决方案。'],
            [Package, 'skill', '技能包', '打包工作流，让好用的能力被更多人复用。'],
            [Quote, 'prompt', '提示词', '分享经过验证、可以直接使用的提示词。'],
          ].map(([Icon, type, title, desc]: any) => (
            <button
              key={type}
              className={'type-choice choice-' + type}
              disabled={busy || !tax.data}
              onClick={() => create(type)}
            >
              <span>
                <Icon size={29} />
              </span>
              <h2>{title}</h2>
              <p>{desc}</p>
              <ArrowRight size={20} />
            </button>
          ))}
        </div>
        <p className="editor-note">
          {user.moderation_exempt
            ? '你的账号已开启免审，提交后直接发布。'
            : '内容经自动审核后发布。无法确定的内容交由管理人员复核。'}
        </p>
      </div>
    );
  if (content.loading || (!form && !content.error)) return <Loading />;
  if (content.error) return <ErrorState message={content.error} retry={content.reload} />;
  const type = content.data.type;
  const specific = (key: string, label: string, multi = false, hint?: string) => (
    <Field key={key} label={label} hint={hint}>
      {multi ? (
        <textarea
          rows={4}
          value={form.fields[key] || ''}
          onChange={(e) => field(key, e.target.value)}
        />
      ) : (
        <input
          value={form.fields[key] || ''}
          onChange={(e) => field(key, e.target.value)}
          list={key === 'tool' ? 'tool-options' : undefined}
        />
      )}
    </Field>
  );
  return (
    <div className="editor-page">
      {guard.dialog}
      <div className="editor-toolbar">
        <Link className="back-link" to="/me">
          <ArrowLeft size={16} />
          我的创作
        </Link>
        {isDeletableDraft(
          content.data.state,
          revision.current !== content.data.latest_revision_id
            ? 'draft'
            : content.data.latest?.status,
        ) && (
          <DeleteDraftButton
            id={id}
            revisionId={revision.current}
            published={content.data.state === 'published'}
            disabled={busy || mediaBusy || progress !== null}
            onBusyChange={setBusy}
            beforeDelete={async () => {
              if (inFlight.current) await inFlight.current;
              return revision.current;
            }}
            onDeleted={() => {
              guard.allowNavigation();
              nav(content.data.state === 'published' ? '/content/' + id : '/me?tab=draft');
            }}
          />
        )}
        <div className="save-status" aria-live="polite">
          <CheckCircle2 size={15} />
          {saveState}
        </div>
        <button
          className="button secondary"
          disabled={busy || mediaBusy || progress !== null}
          onClick={() =>
            save()
              .then(() => toast('草稿已保存'))
              .catch((e) => toast(e.message, true))
          }
        >
          <Save size={16} />
          保存草稿
        </button>
        <button
          className="button"
          disabled={busy || mediaBusy || progress !== null}
          onClick={submit}
        >
          <Send size={16} />
          {busy ? '正在提交…' : '发布内容'}
        </button>
      </div>
      <div inert={busy || guard.saving || undefined}>
        {saveError && (
          <div className="inline-error" role="alert">
            {saveError}{' '}
            <button className="text-button" onClick={() => content.reload()}>
              重新加载服务器版本
            </button>
          </div>
        )}
        <div className="editor-heading">
          <span className="eyebrow">SHARE YOUR {type.toUpperCase()}</span>
          <h1>{preview ? '发布前，再看一眼' : '让你的 ' + typeLabels[type] + ' 被看见'}</h1>
          <div className="editor-steps">
            <span className="done">1 选择类型</span>
            <i />
            <button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>
              2 编辑内容与素材
            </button>
            <i />
            <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
              3 预览与发布
            </button>
          </div>
        </div>
        {preview ? (
          <div className="preview-sheet">
            <div className="tag-row">
              <span className="tag">{typeLabels[type]}</span>
              <Badge status="draft" />
            </div>
            <h1>{form.title || '尚未填写标题'}</h1>
            <p className="article-summary">{form.summary}</p>
            {form.coverId && (
              <img className="article-cover" src={'/api/files/' + form.coverId} alt="内容封面" />
            )}
            <MarkdownBody>{form.body}</MarkdownBody>
            {type === 'prompt' && <pre className="prompt-block">{form.fields.prompt}</pre>}
            <div className="detail-fields">
              {Object.entries(form.fields)
                .filter(([k, v]) => v && k !== 'prompt')
                .map(([k, v]) => (
                  <div key={k}>
                    <b>
                      {
                        (
                          {
                            problem: '解决的问题',
                            techStack: '技术栈',
                            usage: '使用方法',
                            members: '参与成员',
                            demoUrl: '演示地址',
                            repoUrl: '代码仓库',
                            tool: '适用工具',
                            dependencies: '运行依赖',
                            installation: '安装步骤',
                            example: '使用示例',
                            version: '版本',
                            changelog: '更新日志',
                            scenario: '应用场景',
                            input: '输入说明',
                            result: '效果示例',
                          } as any
                        )[k]
                      }
                    </b>
                    <p>{String(v)}</p>
                  </div>
                ))}
            </div>
            <p className="notice">
              可见范围：
              {form.visibility === 'company'
                ? '全公司'
                : tax.data?.departments
                    .filter((d: any) => form.departments.includes(d.id))
                    .map((d: any) => d.name)
                    .join('、')}
              。提交后进入审核，之前发布的版本保留至新版本通过。
            </p>
            <button className="button secondary" onClick={() => setPreview(false)}>
              <ArrowLeft size={16} />
              返回编辑
            </button>
          </div>
        ) : (
          <div className="editor-layout">
            <div className="editor-main panel">
              <Field label="标题 *">
                <input
                  className="title-input"
                  maxLength={120}
                  value={form.title}
                  onChange={(e) => update('title', e.target.value)}
                  placeholder="一个清晰、有吸引力的标题"
                />
              </Field>
              <Field label="摘要 *" hint={`${form.summary.length}/400 字；发布时至少 5 个字。`}>
                <textarea
                  rows={3}
                  maxLength={400}
                  value={form.summary}
                  onChange={(e) => update('summary', e.target.value)}
                  placeholder="用几句话，告诉同事这份分享能带来什么。"
                />
              </Field>
              <div className="field">
                <span>{type === 'prompt' ? '补充说明' : '正文 *'}</span>
                <MediaComposer
                  label={type === 'prompt' ? '补充说明' : '正文 *'}
                  value={form.body}
                  onChange={(v) => update('body', v)}
                  files={(files.data?.items || []).filter((f: any) =>
                    form.attachments.includes(f.id),
                  )}
                  onFilesChange={(list) =>
                    update(
                      'attachments',
                      list.map((f) => f.id),
                    )
                  }
                  rows={16}
                  disabled={busy || mediaBusy || progress !== null}
                  onBusyChange={setMediaBusy}
                  uploadFile={async (file, onProgress) => {
                    const result = await upload(id!, file, onProgress);
                    files.setData((previous: any) => ({
                      items: [...(previous?.items || []), result],
                    }));
                    return result;
                  }}
                  placeholder="分享你的方法、实践过程和收获，也可以添加图片、表情包与附件…"
                />
              </div>
              <datalist id="tool-options">
                {tax.data?.tools.map((t: any) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
              {type === 'project' && (
                <>
                  <h2 className="form-section-title">项目档案</h2>
                  {specific('problem', '解决的问题', true)}
                  {specific('techStack', '技术栈')}
                  {specific('usage', '使用方法', true)}
                  {specific('members', '参与成员')}
                  {specific('demoUrl', '演示地址', '' as any, '仅限 http/https，将标注为外部链接')}
                  {specific('repoUrl', '代码仓库地址')}
                </>
              )}
              {type === 'skill' && (
                <>
                  <h2 className="form-section-title">技能说明</h2>
                  {specific('tool', '适用工具', false, '支持自定义工具名称')}
                  {specific('problem', '技能用途', true)}
                  {specific('dependencies', '运行环境与依赖', true)}
                  {specific('installation', '安装步骤', true)}
                  {specific('example', '使用示例', true)}
                </>
              )}
              {type === 'prompt' && (
                <>
                  <h2 className="form-section-title">提示词内容</h2>
                  {specific('prompt', '提示词正文 *', true)}
                  {specific('tool', '适用模型或工具')}
                  {specific('scenario', '应用场景', true)}
                  {specific('input', '输入说明', true)}
                  {specific('example', '使用示例', true)}
                  {specific('result', '效果示例', true)}
                </>
              )}
              {['skill', 'project'].includes(type) && (
                <>
                  <h2 className="form-section-title">版本信息</h2>
                  {specific('version', '版本号')}
                  {specific('changelog', '更新说明', true)}
                  <p className="muted">新增版本保留原内容的评论、点赞与收藏关系。</p>
                </>
              )}
            </div>
            <aside className="editor-sidebar">
              <div className="panel">
                <h3>分类与可见范围</h3>
                <Field label="内容分类 *">
                  <select
                    value={form.categoryId}
                    onChange={(e) => update('categoryId', e.target.value)}
                  >
                    {tax.data?.categories.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <fieldset className="tag-picker">
                  <legend>标签（最多 10 个）</legend>
                  {tax.data?.tags.map((t: any) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        checked={form.tags.includes(t.name)}
                        onChange={(e) =>
                          update(
                            'tags',
                            e.target.checked
                              ? [...form.tags, t.name]
                              : form.tags.filter((v: string) => v !== t.name),
                          )
                        }
                      />
                      {t.name}
                    </label>
                  ))}
                </fieldset>
                <Field label="谁可以看见">
                  <select
                    value={form.visibility}
                    onChange={(e) => update('visibility', e.target.value)}
                  >
                    <option value="company">全公司成员</option>
                    <option value="departments">指定部门</option>
                  </select>
                </Field>
                {form.visibility === 'departments' && (
                  <fieldset className="department-picker">
                    <legend>选择可见部门 *</legend>
                    {tax.data?.departments.map((d: any) => (
                      <label key={d.id}>
                        <input
                          type="checkbox"
                          checked={form.departments.includes(d.id)}
                          onChange={(e) =>
                            update(
                              'departments',
                              e.target.checked
                                ? [...form.departments, d.id]
                                : form.departments.filter((v: string) => v !== d.id),
                            )
                          }
                        />
                        {d.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                <p className="form-tip">收窄可见范围会立即生效；扩大范围需等待新版本通过审核。</p>
              </div>
              <div className="panel">
                <h3>封面与素材</h3>
                <label className="upload-zone">
                  <UploadCloud size={30} />
                  <b>{progress !== null ? `正在上传 ${progress}%` : '点击上传图片或资源包'}</b>
                  <small>图片 ≤ 10 MB · 资源包 ≤ 100 MB</small>
                  <input
                    type="file"
                    disabled={progress !== null}
                    accept={mediaAccept}
                    onChange={(e) => {
                      if (e.target.files?.[0]) doUpload(e.target.files[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                {progress !== null && <progress max={100} value={progress} aria-label="上传进度" />}
                {failedFile && (
                  <button className="button secondary full" onClick={() => doUpload(failedFile)}>
                    <RefreshCw size={15} />
                    重新上传 {failedFile.name}
                  </button>
                )}
                <div className="editor-files">
                  {files.data?.items.map((f: any) => (
                    <div className="editor-file" key={f.id}>
                      <div className="file-head">
                        {f.kind === 'image' ? <Image size={18} /> : <File size={18} />}
                        <strong>{f.original_name}</strong>
                        <small>{size(f.size)}</small>
                      </div>
                      <Badge status={f.scan_status} />
                      <div className="file-actions">
                        {f.kind === 'image' ? (
                          <>
                            <button
                              className="text-button"
                              onClick={() => update('coverId', form.coverId === f.id ? null : f.id)}
                            >
                              {form.coverId === f.id ? '取消封面' : '设为封面'}
                            </button>
                            <button
                              className="text-button"
                              onClick={() =>
                                update(
                                  'body',
                                  form.body + `\n\n![${f.original_name}](/api/files/${f.id})\n`,
                                )
                              }
                            >
                              插入正文
                            </button>
                          </>
                        ) : (
                          <button
                            className="text-button"
                            onClick={() =>
                              update(
                                'attachments',
                                form.attachments.includes(f.id)
                                  ? form.attachments.filter((v: string) => v !== f.id)
                                  : [...form.attachments, f.id],
                              )
                            }
                          >
                            {form.attachments.includes(f.id) ? '移除引用' : '加入附件'}
                          </button>
                        )}
                        <button
                          className="text-button danger"
                          onClick={async () => {
                            if (!confirm('删除未使用的上传文件？已被修订引用的文件会保留。'))
                              return;
                            try {
                              await api('/files/' + f.id, { method: 'DELETE' });
                              update(
                                'attachments',
                                form.attachments.filter((v: string) => v !== f.id),
                              );
                              if (form.coverId === f.id) update('coverId', null);
                              files.reload();
                            } catch (e: any) {
                              toast(e.message, true);
                            }
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="form-tip">
                  正文和附件一起提交审核；免审账号直接发布。修改或替换素材后请重新提交。
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
