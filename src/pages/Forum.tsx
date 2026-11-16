import { HonorStrip } from '../Honors';
import { MediaComposer, CommentMedia, type MediaFile } from '../MediaComposer';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  MessageSquare,
  Plus,
  Search,
  ArrowRight,
  ArrowLeft,
  Pin,
  LockKeyhole,
  CheckCircle2,
  Eye,
  Heart,
  Bookmark,
  Bell,
  Paperclip,
  Send,
  RefreshCw,
  Quote,
  Flag,
  Trash2,
  Pencil,
} from '../icons';
import { api, send, useApi, upload, date, size } from '../api';
import { useApp } from '../context';
import {
  Avatar,
  Badge,
  Loading,
  ErrorState,
  Empty,
  Pagination,
  MarkdownBody,
  Field,
} from '../components';
import '../forum.css';

export const topicKinds: Record<string, string> = {
  discussion: '讨论',
  question: '提问',
  feedback: '反馈',
  chat: '闲聊',
};
function topicLink(t: any) {
  return t.state === 'draft' ? '/forum/edit/' + t.id : '/forum/' + t.id;
}
export function TopicRows({ items, compact = false }: { items: any[]; compact?: boolean }) {
  return (
    <div className={'topic-list' + (compact ? ' compact-topics' : '')}>
      {!compact && (
        <div className="topic-table-head">
          <span>话题</span>
          <span>回复 / 阅读</span>
          <span>最近动态</span>
        </div>
      )}
      {items.map((t) => (
        <article className="topic-row" key={t.id}>
          <Link className="topic-avatar" to={'/author/' + t.author_id}>
            <Avatar name={t.author} userId={t.author_id} version={t.author_avatar_version} />
          </Link>
          <div className="topic-main">
            <div className="topic-title-line">
              {t.pinned && <Pin size={14} className="topic-pin" aria-label="置顶" />}
              {t.unread && <span className="topic-unread" title="有未读内容" />}
              <Link to={topicLink(t)}>{t.title || '未命名草稿'}</Link>
              {t.locked && <LockKeyhole size={14} aria-label="已锁定" />}
              {t.resolved && (
                <span className="resolved-pill">
                  <CheckCircle2 size={12} />
                  已解决
                </span>
              )}
            </div>
            <div className="topic-byline">
              <span className={'kind-pill kind-' + t.kind}>{topicKinds[t.kind]}</span>
              <span>{t.board}</span>
              <span>{t.author}</span>
              <span>{date(t.created_at)}</span>
              {t.status !== 'approved' && <Badge status={t.status || 'draft'} />}
            </div>
          </div>
          <div className="topic-count">
            <b>{t.replies}</b>
            <span>{t.views} 阅读</span>
          </div>
          <div className="topic-activity">
            <span>{t.last_author || t.author}</span>
            <small>{date(t.last_activity || t.created_at)}</small>
          </div>
        </article>
      ))}
    </div>
  );
}
export function ForumPreview({ related }: { related?: string }) {
  const list = useApi('/forum/topics?limit=4' + (related ? '&related=' + related : ''));
  return (
    <section className="forum-preview panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            <MessageSquare size={14} />
            一起聊聊
          </span>
          <h2>{related ? '围绕这份内容的讨论' : '好问题，也值得被看见'}</h2>
        </div>
        <Link to={'/forum' + (related ? '?related=' + related : '')}>
          进入讨论区 <ArrowRight size={16} />
        </Link>
      </div>
      {list.loading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState message={list.error} retry={list.reload} />
      ) : list.data?.items.length ? (
        <TopicRows items={list.data.items} compact />
      ) : (
        <p className="muted">还没有话题，分享你的问题或新想法。</p>
      )}
      <div className="forum-preview-foot">
        <span>
          {related
            ? '使用疑问、改进建议和实践心得，都可以单独开帖。'
            : '工具怎么选、遇到什么问题、最近有什么发现，都来聊聊。'}
        </span>
        <Link
          className="button secondary"
          to={'/forum/new' + (related ? '?related=' + related : '')}
        >
          <Plus size={15} />
          发起讨论
        </Link>
      </div>
    </section>
  );
}
export function Forum() {
  const [params, setParams] = useSearchParams(),
    [query, setQuery] = useState(params.get('q') || '');
  const boards = useApi('/forum/boards'),
    topics = useApi('/forum/topics?' + params.toString());
  const related = params.get('related'),
    resource = useApi(related ? '/contents/' + related : null);
  const page = Number(params.get('page') || 1),
    scope = params.get('scope') || 'all',
    sort = params.get('sort') || 'active';
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete('page');
    setParams(next);
  }
  return (
    <div className="forum-page">
      <div className="forum-heading">
        <div>
          <h1>
            讨论区<span>让想法，有来有回。</span>
          </h1>
          <p>一个问题、一次发现，都可以成为交流的开始。</p>
        </div>
        <Link className="button" to={'/forum/new' + (related ? '?related=' + related : '')}>
          <Plus size={18} />
          发起话题
        </Link>
      </div>
      {related && (
        <div className="notice">
          正在查看关联讨论：
          <Link to={'/content/' + related}>
            {resource.data?.revision?.data.title || '资源内容'}
          </Link>
          <button className="text-button" onClick={() => filter('related', '')}>
            查看全部讨论
          </button>
        </div>
      )}
      <div className="forum-layout">
        <div className="forum-feed">
          <div className="forum-scope tabs">
            {Object.entries({
              all: '全部话题',
              mine: '我的帖子',
              participated: '我的参与',
              following: '我的关注',
            }).map(([v, l]) => (
              <button
                className={scope === v ? 'active' : ''}
                onClick={() => filter('scope', v)}
                key={v}
              >
                {l}
              </button>
            ))}
          </div>
          <section className="panel forum-table">
            <div className="forum-toolbar">
              <div className="forum-sorts">
                {Object.entries({
                  active: '最新回复',
                  newest: '最新发布',
                  popular: '热门',
                  unanswered: '未回复',
                }).map(([v, l]) => (
                  <button
                    key={v}
                    className={sort === v ? 'active' : ''}
                    onClick={() => filter('sort', v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <form
                className="forum-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  filter('q', query);
                }}
              >
                <Search size={16} />
                <input
                  aria-label="搜索话题"
                  placeholder="搜索话题…"
                  maxLength={100}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="text-button" aria-label="执行话题搜索">
                  搜索
                </button>
              </form>
            </div>
            <div className="forum-filters">
              <select
                aria-label="话题类型"
                value={params.get('kind') || ''}
                onChange={(e) => filter('kind', e.target.value)}
              >
                <option value="">所有类型</option>
                {Object.entries(topicKinds).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <select
                aria-label="解决状态"
                value={params.get('resolved') || ''}
                onChange={(e) => filter('resolved', e.target.value)}
              >
                <option value="">所有状态</option>
                <option value="0">进行中</option>
                <option value="1">已解决</option>
              </select>
              <span>{topics.data?.total ?? '—'} 个话题</span>
            </div>
            {topics.loading ? (
              <Loading />
            ) : topics.error ? (
              <ErrorState message={topics.error} retry={topics.reload} />
            ) : topics.data?.items.length ? (
              <TopicRows items={topics.data.items} />
            ) : (
              <Empty
                title="这里还没有话题"
                description="换个筛选条件，或者来开启第一场讨论。"
                action={
                  <Link
                    className="button secondary"
                    to={'/forum/new' + (related ? '?related=' + related : '')}
                  >
                    发起话题
                  </Link>
                }
              />
            )}
            <Pagination
              total={topics.data?.total || 0}
              page={page}
              onChange={(p) => {
                const n = new URLSearchParams(params);
                n.set('page', String(p));
                setParams(n);
              }}
            />
          </section>
        </div>
        <aside className="forum-sidebar">
          <section className="panel">
            <h3>逛逛版块</h3>
            <button
              className={!params.get('board') ? 'board-link active' : 'board-link'}
              onClick={() => filter('board', '')}
            >
              <span>
                <MessageSquare size={17} />
                全部版块
              </span>
              <b>{boards.data?.items.reduce((n: number, b: any) => n + b.topics, 0) || 0}</b>
            </button>
            {boards.data?.items.map((b: any) => (
              <button
                key={b.id}
                onClick={() => filter('board', b.id)}
                className={'board-link' + (params.get('board') === b.id ? ' active' : '')}
              >
                <span>{b.name}</span>
                <b>{b.topics}</b>
              </button>
            ))}
            {boards.error && <ErrorState message={boards.error} retry={boards.reload} />}
          </section>
          <section className="forum-welcome">
            <span className="forum-doodle">
              <MessageSquare size={28} />
              <span>✦</span>
            </span>
            <h3>有问题，就一起想办法。</h3>
            <p>描述你的场景，贴上尝试过的方法。也欢迎分享灵感、反馈建议，或随意聊聊。</p>
            <div>
              <CheckCircle2 size={15} />
              友善交流，尊重不同观点
            </div>
            <div>
              <CheckCircle2 size={15} />
              给有帮助的回答一个赞
            </div>
          </section>
          <Link className="forum-resource-link" to="/explore">
            找一份现成的实践或资源 <ArrowRight size={16} />
          </Link>
        </aside>
      </div>
    </div>
  );
}

export function ForumEditor() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    navigate = useNavigate(),
    { toast, user } = useApp();
  const tax = useApi('/taxonomy'),
    existing = useApi(id ? '/contents/' + id + '?edit=1' : null),
    meta = useApi(id ? '/forum/topics/' + id : null);
  const related = params.get('related') || meta.data?.related_content_id,
    resource = useApi(related ? '/contents/' + related : null);
  const [form, setForm] = useState<any>({
      title: '',
      body: '',
      categoryId: '',
      visibility: 'company',
      departments: [],
      attachments: [],
      tags: [],
      coverId: null,
      fields: {},
    }),
    [kind, setKind] = useState('discussion'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState(false),
    [files, setFiles] = useState<any[]>([]),
    [progress, setProgress] = useState<number | null>(null);
  const cid = useRef<string | undefined>(id),
    rid = useRef<string | null>(null);
  useEffect(() => {
    if (tax.data && !id)
      setForm((f: any) => ({ ...f, categoryId: f.categoryId || tax.data.categories[0]?.id || '' }));
  }, [tax.data, id]);
  useEffect(() => {
    if (existing.data) {
      if (existing.data.type !== 'discussion') {
        navigate('/editor/' + id, { replace: true });
        return;
      }
      if (existing.data.revision) {
        setForm(existing.data.revision.data);
        rid.current = existing.data.revision.id;
      } else setForm((f: any) => ({ ...f, categoryId: existing.data.category_id }));
      setFiles(existing.data.files);
    }
  }, [existing.data, id, navigate]);
  useEffect(() => {
    if (meta.data) setKind(meta.data.kind);
  }, [meta.data]);
  const change = (key: string, value: any) => setForm((f: any) => ({ ...f, [key]: value }));
  async function ensureId() {
    if (!cid.current)
      cid.current = (
        await send('/forum/topics', {
          categoryId: form.categoryId,
          kind,
          relatedContentId: related || null,
        })
      ).id;
    return cid.current!;
  }
  async function save(submit: boolean) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!form.title.trim()) throw new Error('请给话题起个标题');
      if (submit && form.body.trim().length < 5) throw new Error('请至少用 5 个字描述话题');
      const key = await ensureId(),
        value = await send(
          '/contents/' + key,
          {
            data: { ...form, summary: form.body.slice(0, 200) || form.title },
            submit,
            baseRevisionId: rid.current,
          },
          'PUT',
        );
      rid.current = value.revisionId;
      toast(
        submit
          ? value.status === 'approved'
            ? '话题已发布'
            : value.status === 'review'
              ? '附件等待安全检查'
              : '话题已提交审核，通过后会出现在讨论区'
          : '草稿已保存',
      );
      navigate(submit ? '/forum/' + key : '/forum/edit/' + key, { replace: true });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (tax.loading || (id && (existing.loading || meta.loading))) return <Loading />;
  if (tax.error || existing.error || meta.error)
    return (
      <ErrorState
        message={tax.error || existing.error || meta.error}
        retry={() => {
          tax.reload();
          existing.reload();
          meta.reload();
        }}
      />
    );
  return (
    <div className="forum-editor">
      <Link className="back-link" to="/forum">
        <ArrowLeft size={16} />
        返回讨论区
      </Link>
      <div className="forum-heading">
        <div>
          <span className="eyebrow">START A CONVERSATION</span>
          <h1>{id ? '编辑话题' : '发起一个话题'}</h1>
          <p>把问题讲清楚，让同事更容易参与进来。</p>
        </div>
      </div>
      {related && (
        <div className="notice">
          关联内容：
          <Link to={'/content/' + related}>{resource.data?.revision?.data.title || '加载中…'}</Link>
          <small>话题同时受原内容的访问范围限制。</small>
        </div>
      )}
      <form
        className="panel forum-compose"
        onSubmit={(e) => {
          e.preventDefault();
          save(true);
        }}
      >
        <div className="forum-compose-grid">
          <Field label="话题类型">
            <select
              value={kind}
              disabled={!!cid.current || busy}
              onChange={(e) => setKind(e.target.value)}
            >
              {Object.entries(topicKinds).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="选择版块">
            <select
              value={form.categoryId}
              onChange={(e) => change('categoryId', e.target.value)}
              required
            >
              {tax.data?.categories.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="话题标题">
          <input
            placeholder="一句话说明你想聊什么"
            maxLength={120}
            required
            value={form.title}
            onChange={(e) => change('title', e.target.value)}
          />
        </Field>
        <div className="field">
          <span>话题正文</span>
          <MediaComposer
            label="话题正文"
            value={form.body}
            onChange={(v) => change('body', v)}
            files={files}
            onFilesChange={(next) => {
              setFiles(next);
              change(
                'attachments',
                next.map((f) => f.id),
              );
            }}
            disabled={busy}
            onBusyChange={setBusy}
            rows={12}
            uploadFile={async (file, onProgress) => upload(await ensureId(), file, onProgress)}
            placeholder="背景是什么？尝试过什么？想听听大家哪些建议？"
          />
        </div>
        <Field label="可见范围">
          <select value={form.visibility} onChange={(e) => change('visibility', e.target.value)}>
            <option value="company">全公司</option>
            <option value="departments">指定部门</option>
          </select>
        </Field>
        {form.visibility === 'departments' && (
          <div className="forum-departments">
            {tax.data?.departments.map((d: any) => (
              <label key={d.id}>
                <input
                  type="checkbox"
                  checked={form.departments.includes(d.id)}
                  onChange={(e) =>
                    change(
                      'departments',
                      e.target.checked
                        ? [...form.departments, d.id]
                        : form.departments.filter((x: string) => x !== d.id),
                    )
                  }
                />
                {d.name}
              </label>
            ))}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="forum-compose-actions">
          <span className="muted">
            {user.moderation_exempt
              ? '你的账号已开启免审，提交后直接发布。'
              : '话题通过审核后对可见范围内的同事展示。'}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => save(false)}
          >
            保存草稿
          </button>
          <button className="button" disabled={busy}>
            <Send size={16} />
            {busy ? '处理中…' : '发布话题'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ForumTopic() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    { user, toast } = useApp(),
    navigate = useNavigate();
  const detail = useApi(
      '/contents/' + id + (params.get('revision') ? '?revision=' + params.get('revision') : ''),
    ),
    topic = useApi('/forum/topics/' + id);
  const [page, setPage] = useState(1),
    [onlyAuthor, setOnlyAuthor] = useState(false),
    [text, setText] = useState(''),
    [replyFiles, setReplyFiles] = useState<MediaFile[]>([]),
    [mediaBusy, setMediaBusy] = useState(false),
    [quote, setQuote] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const comments = useApi(`/contents/${id}/comments?page=${page}${onlyAuthor ? '&author=1' : ''}`),
    replyBox = useRef<HTMLElement>(null);
  const d = detail.data,
    f = topic.data,
    r = d?.revision,
    own = d?.author_id === user.id,
    live = d?.state === 'published';
  useEffect(() => {
    if (live) send('/forum/topics/' + id + '/visit').catch(() => {});
  }, [id, live]);
  async function act(fn: () => Promise<any>, message?: string | ((result: any) => string)) {
    setBusy(true);
    try {
      const result = await fn();
      if (message) toast(typeof message === 'function' ? message(result) : message);
      detail.reload();
      topic.reload();
      comments.reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  const status = (value: any) =>
    act(() => send('/forum/topics/' + id + '/status', value, 'PATCH'), '话题状态已更新');
  async function report(commentId?: string) {
    const reason = window.prompt('请描述举报原因（至少 5 个字）');
    if (reason)
      await act(
        () => send('/contents/' + id + '/reports', { reason, commentId: commentId || null }),
        '举报已提交',
      );
  }
  if (detail.loading || topic.loading) return <Loading />;
  if (detail.error || topic.error)
    return (
      <ErrorState
        message={detail.error || topic.error}
        retry={() => {
          detail.reload();
          topic.reload();
        }}
      />
    );
  if (!r)
    return (
      <Empty
        title="话题还在草稿中"
        action={
          <Link className="button" to={'/forum/edit/' + id}>
            继续编辑
          </Link>
        }
      />
    );
  return (
    <div className="forum-topic-page">
      <Link className="back-link" to="/forum">
        <ArrowLeft size={16} />
        返回讨论区
      </Link>
      {(r.status !== 'approved' || (d.latest && d.latest.id !== r.id)) && (
        <div className="notice">
          <Badge status={d.latest?.status || r.status} />
          <span>{d.latest?.reason || r.reason || '话题通过审核后将对其他同事可见。'}</span>
          <button
            className="text-button"
            onClick={() => {
              detail.reload();
              comments.reload();
            }}
          >
            刷新状态
          </button>
        </div>
      )}
      <div className="topic-page-heading">
        <div className="topic-byline">
          <span className={'kind-pill kind-' + f.kind}>{topicKinds[f.kind]}</span>
          {f.resolved && (
            <span className="resolved-pill">
              <CheckCircle2 size={13} />
              已解决
            </span>
          )}
          {f.locked && (
            <span>
              <LockKeyhole size={13} />
              已锁定
            </span>
          )}
          {d.pinned && (
            <span>
              <Pin size={13} />
              置顶
            </span>
          )}
        </div>
        <h1>{r.data.title}</h1>
        <div className="topic-page-meta">
          <span>{date(d.created_at)} 发起</span>
          <span>
            <MessageSquare size={15} />
            {d.metrics.comments} 条回复
          </span>
          <span>
            <Eye size={15} />
            {f.views} 人阅读
          </span>
          {live && (
            <button
              className={'text-button' + (f.following ? ' is-active' : '')}
              disabled={busy}
              onClick={() =>
                act(
                  () => send('/forum/topics/' + id + '/follow', { active: !f.following }, 'PUT'),
                  f.following ? '已取消关注' : '已关注，有新回复时会通知你',
                )
              }
            >
              <Bell size={15} />
              {f.following ? '已关注' : '关注话题'}
            </button>
          )}
        </div>
      </div>
      {f.related && (
        <div className="notice">
          <Paperclip size={16} />
          关联内容：<Link to={'/content/' + f.related.id}>{f.related.title || '资源已下架'}</Link>
        </div>
      )}
      <article className="forum-post panel">
        <aside className="post-author">
          <Avatar name={d.author.name} userId={d.author_id} version={d.author.avatar_version} />
          <Link to={'/author/' + d.author_id}>{d.author.name}</Link>
          <span className="kind-pill">楼主</span>
          <small>{d.author.department}</small>
          <HonorStrip honors={d.honors} userId={d.author_id} />
        </aside>
        <div className="post-content">
          <div className="post-top">
            <span>{date(r.created_at)}</span>
            <span>1 楼</span>
          </div>
          <MarkdownBody>{r.data.body}</MarkdownBody>
          {d.files?.length > 0 && (
            <div className="forum-post-files">
              {d.files.map((file: any) => (
                <a
                  key={file.id}
                  href={`/api/files/${file.id}?revision=${r.id}`}
                  className="forum-file"
                >
                  <Paperclip size={15} />
                  {file.original_name}
                  <small>{size(file.size)}</small>
                </a>
              ))}
            </div>
          )}
          <div className="post-actions">
            <button
              disabled={busy || !live}
              className={d.metrics.liked ? 'is-active' : ''}
              onClick={() =>
                act(() => send('/contents/' + id + '/like', { active: !d.metrics.liked }, 'PUT'))
              }
            >
              <Heart size={16} />
              赞同 {d.metrics.likes}
            </button>
            <button
              disabled={busy || !live}
              onClick={() =>
                act(() =>
                  send('/contents/' + id + '/bookmark', { active: !d.metrics.bookmarked }, 'PUT'),
                )
              }
            >
              <Bookmark size={16} />
              {d.metrics.bookmarked ? '已收藏' : '收藏'}
            </button>
            {(own || user.role === 'admin') && (
              <Link to={'/forum/edit/' + id}>
                <Pencil size={15} />
                编辑
              </Link>
            )}
            <button disabled={!live || busy} onClick={() => report()}>
              <Flag size={14} />
              举报
            </button>
            {(own || d.canManage) && (
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm('确定下架这个话题？下架后其他同事将无法访问。'))
                    act(() => send('/contents/' + id + '/withdraw'), '话题已下架');
                }}
              >
                下架
              </button>
            )}
            {(own || user.role === 'admin') && (
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm('确定删除这个话题？'))
                    act(async () => {
                      await api('/contents/' + id, { method: 'DELETE' });
                      navigate('/forum');
                    });
                }}
              >
                <Trash2 size={14} />
                删除
              </button>
            )}
          </div>
        </div>
      </article>
      {live && (d.canManage || (own && f.kind === 'question')) && (
        <div className="forum-manage">
          <span>话题管理</span>
          {f.kind === 'question' && (own || d.canManage) && (
            <button
              disabled={busy}
              className="button secondary"
              onClick={() => status({ resolved: !f.resolved })}
            >
              {f.resolved ? '重新打开问题' : '标记已解决'}
            </button>
          )}
          {d.canManage && (
            <>
              <button
                disabled={busy}
                className="button secondary"
                onClick={() => status({ locked: !f.locked })}
              >
                {f.locked ? '解锁话题' : '锁定话题'}
              </button>
              <button
                disabled={busy}
                className="button secondary"
                onClick={() => status({ pinned: !d.pinned })}
              >
                {d.pinned ? '取消置顶' : '置顶话题'}
              </button>
            </>
          )}
        </div>
      )}
      <section className="forum-replies">
        <div className="section-heading">
          <h2>
            全部回复 <span className="muted">{comments.data?.total || 0}</span>
          </h2>
          <div className="forum-reply-tools">
            <label>
              <input
                type="checkbox"
                checked={onlyAuthor}
                onChange={(e) => {
                  setOnlyAuthor(e.target.checked);
                  setPage(1);
                }}
              />
              只看楼主
            </label>
            <button
              className="text-button"
              onClick={() => {
                comments.reload();
                detail.reload();
                topic.reload();
              }}
            >
              <RefreshCw size={14} />
              刷新回复
            </button>
          </div>
        </div>
        {comments.loading ? (
          <Loading />
        ) : comments.error ? (
          <ErrorState message={comments.error} retry={comments.reload} />
        ) : (
          comments.data?.items.map((cm: any) => (
            <article
              id={'reply-' + cm.id}
              key={cm.id}
              className={
                'forum-post panel' + (f.accepted_comment_id === cm.id ? ' accepted-post' : '')
              }
            >
              <aside className="post-author">
                <Avatar name={cm.author} userId={cm.author_id} version={cm.author_avatar_version} />
                <Link to={'/author/' + cm.author_id}>{cm.author}</Link>
                <HonorStrip honors={cm.honors} userId={cm.author_id} />
                {cm.author_id === d.author_id && <span className="kind-pill">楼主</span>}
              </aside>
              <div className="post-content">
                <div className="post-top">
                  <span>
                    {date(cm.created_at)}
                    {cm.status !== 'approved' && <Badge status={cm.status} />}
                  </span>
                  <span>{cm.status === 'approved' ? cm.floor + ' 楼' : '待审核'}</span>
                </div>
                {f.accepted_comment_id === cm.id && (
                  <div className="accepted-label">
                    <CheckCircle2 size={17} />
                    楼主采纳了这个回答
                  </div>
                )}
                {cm.parent_body && (
                  <blockquote className="reply-quote">
                    <b>引用 {cm.parent_author} 的回复</b>
                    <p>{cm.parent_body.slice(0, 300)}</p>
                  </blockquote>
                )}
                <CommentMedia body={cm.body} files={cm.files} />
                {cm.reason && cm.status !== 'approved' && <p className="muted">{cm.reason}</p>}
                <div className="post-actions">
                  {cm.status === 'approved' && (
                    <>
                      <button
                        disabled={!live || busy || (f.locked && !d.canManage)}
                        onClick={() => {
                          setQuote(cm);
                          replyBox.current?.focus();
                          replyBox.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }}
                      >
                        <Quote size={14} />
                        引用回复
                      </button>
                      {f.kind === 'question' && (own || d.canManage) && live && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            status({
                              acceptedCommentId: f.accepted_comment_id === cm.id ? null : cm.id,
                            })
                          }
                        >
                          <CheckCircle2 size={15} />
                          {f.accepted_comment_id === cm.id ? '取消采纳' : '采纳回答'}
                        </button>
                      )}
                      <button disabled={busy || !live} onClick={() => report(cm.id)}>
                        <Flag size={14} />
                        举报
                      </button>
                    </>
                  )}
                  {(cm.author_id === user.id || d.canManage) && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm('确定删除这条回复？'))
                          act(() => api('/comments/' + cm.id, { method: 'DELETE' }), '回复已删除');
                      }}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))
        )}
        {comments.data?.total === 0 && (
          <div className="forum-empty-replies">还没有回复，你的经验也许正好能帮到同事。</div>
        )}
        <Pagination total={comments.data?.total || 0} page={page} onChange={setPage} />
      </section>
      <form
        className="panel forum-reply-form"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            async () => {
              const result = await send('/contents/' + id + '/comments', {
                body: text,
                parentId: quote?.id || null,
                attachments: replyFiles.map((file) => file.id),
              });
              setText('');
              setReplyFiles([]);
              setQuote(null);
              setOnlyAuthor(false);
              setPage(1);
              return result;
            },
            (result) =>
              result.status === 'approved'
                ? '回复已发布'
                : result.status === 'review'
                  ? '回复附件等待安全检查'
                  : '回复已提交审核',
          );
        }}
      >
        <h3>加入讨论</h3>
        {!live ? (
          <p className="notice">话题发布后即可参与回复。</p>
        ) : f.locked && !d.canManage ? (
          <p className="notice">
            <LockKeyhole size={16} />
            此话题已锁定，暂时不能回复。
          </p>
        ) : (
          <>
            {quote && (
              <div className="reply-quote">
                <b>引用 {quote.author} 的回复</b>
                <p>{quote.body.slice(0, 160)}</p>
                <button type="button" className="text-button" onClick={() => setQuote(null)}>
                  取消引用
                </button>
              </div>
            )}
            <MediaComposer
              label="回复内容"
              focusRef={replyBox}
              value={text}
              onChange={setText}
              files={replyFiles}
              onFilesChange={setReplyFiles}
              rows={5}
              maxLength={5000}
              maxFiles={10}
              disabled={busy}
              onBusyChange={setMediaBusy}
              uploadFile={(file, onProgress) => upload(id!, file, onProgress, 'comment')}
              removeFile={(file) => api('/files/' + file.id, { method: 'DELETE' })}
              placeholder="分享你的想法、经验或解决方法，支持图片、表情包和附件…"
            />
            <div className="forum-compose-actions">
              <span className="muted">
                {user.moderation_exempt
                  ? '回复直接发布，支持图片、表情和附件。'
                  : '支持图文、表情和附件，回复通过审核后展示。'}
              </span>
              <button
                className="button"
                disabled={busy || mediaBusy || (!text.trim() && !replyFiles.length)}
              >
                <Send size={16} />
                发表回复
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
