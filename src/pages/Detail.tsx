import { DeleteDraftButton, isDeletableDraft } from '../DraftActions';
import { HonorStrip } from '../Honors';
import { MediaComposer, CommentMedia, type MediaFile } from '../MediaComposer';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ForumPreview } from './Forum';
import {
  ArrowLeft,
  Heart,
  Bookmark,
  MessageCircle,
  Download,
  Copy,
  Flag,
  ExternalLink,
  File,
  Clock,
  Send,
  Edit3,
  MoreHorizontal,
  RefreshCw,
  ChevronDown,
} from '../icons';
import { api, send, useApi, date, size, typeLabels, upload } from '../api';
import { useApp } from '../context';
import { Loading, ErrorState, Empty, Avatar, MarkdownBody, Badge, Pagination } from '../components';
const fieldLabels: Record<string, string> = {
  problem: '解决的问题 / 技能用途',
  techStack: '技术栈',
  usage: '使用方法',
  members: '参与成员',
  tool: '适用工具 / 模型',
  dependencies: '运行环境与依赖',
  installation: '安装步骤',
  example: '使用示例',
  scenario: '应用场景',
  input: '输入说明',
  result: '效果示例',
  changelog: '更新日志',
};
export function Detail() {
  const { id } = useParams(),
    navigate = useNavigate(),
    [params] = useSearchParams(),
    { user, toast } = useApp(),
    [version, setVersion] = useState(params.get('revision') || ''),
    [commentPage, setCommentPage] = useState(1),
    [text, setText] = useState(''),
    [commentFiles, setCommentFiles] = useState<MediaFile[]>([]),
    [mediaBusy, setMediaBusy] = useState(false),
    [reply, setReply] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [reporting, setReporting] = useState(false),
    [report, setReport] = useState('');
  const detail = useApi(`/contents/${id}${version ? '?revision=' + version : ''}`),
    versions = useApi(`/contents/${id}/versions?limit=50`),
    comments = useApi(`/contents/${id}/comments?page=${commentPage}`);
  const canRecordView =
    detail.data?.state === 'published' && detail.data?.type !== 'discussion' && !version;
  useEffect(() => {
    if (canRecordView) send('/contents/' + id + '/visit').catch(() => {});
  }, [id, canRecordView]);
  async function action(fn: () => Promise<any>, success?: string) {
    setBusy(true);
    try {
      const result = await fn();
      if (success) toast(success);
      if (result?.metrics)
        detail.setData((previous: any) =>
          previous
            ? { ...previous, metrics: { ...previous.metrics, ...result.metrics } }
            : previous,
        );
      else await detail.refresh();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  if (detail.loading) return <Loading />;
  if (detail.error) return <ErrorState message={detail.error} retry={detail.reload} />;
  const d = detail.data,
    r = d?.revision;
  if (d?.type === 'discussion')
    return <Navigate replace to={'/forum/' + id + (version ? '?revision=' + version : '')} />;
  const draftAction =
    (d.author_id === user.id || user.role === 'admin') &&
    isDeletableDraft(d.state, d.latest?.status || r?.status) ? (
      <DeleteDraftButton
        id={id!}
        revisionId={d.latest_revision_id || null}
        published={d.state === 'published'}
        onDeleted={() => {
          if (d.state === 'published') {
            setVersion('');
            detail.reload();
          } else navigate('/me?tab=draft');
        }}
        onStale={detail.reload}
      />
    ) : null;
  if (!r)
    return (
      <Empty
        title="这篇内容还在酝酿"
        action={
          <div className="draft-detail-actions">
            <Link className="button" to={'/editor/' + id}>
              继续编辑
            </Link>
            {draftAction}
          </div>
        }
      />
    );
  const data = r.data,
    own = d.author_id === user.id,
    fields = data.fields || {};
  return (
    <div className="detail-page">
      <Link className="back-link" to="/explore">
        <ArrowLeft size={16} />
        返回发现
      </Link>
      {d.latest && d.latest.id !== r.id && (
        <div className="notice">
          有一个{d.latest.status === 'draft' ? '草稿' : '新的修订'}：
          <Badge status={d.latest.status} />
          {d.latest.reason && <span>{d.latest.reason}</span>}
          <button className="text-button" onClick={() => setVersion(d.latest.id)}>
            查看该修订
          </button>
        </div>
      )}
      {r.status !== 'approved' && (
        <div className="notice">
          <Badge status={r.status} />
          {r.reason || '内容已保存，审核通过后即可公开展示。'}
          <button className="text-button" onClick={detail.reload}>
            <RefreshCw size={14} />
            刷新状态
          </button>
        </div>
      )}
      <div className="detail-layout">
        <div className="detail-main">
          <article className="article panel">
            <div className="tag-row">
              <span className={'tag type-' + d.type}>{typeLabels[d.type]}</span>
              {data.tags.map((t: string) => (
                <Link className="tag" key={t} to={'/explore?tag=' + encodeURIComponent(t)}>
                  #{t}
                </Link>
              ))}
              <span className="visibility-label">
                {data.visibility === 'company' ? '全公司可见' : '指定部门可见'}
              </span>
            </div>
            <h1>{data.title}</h1>
            <div className="article-byline">
              <Link className="author" to={'/author/' + d.author_id}>
                <Avatar
                  name={d.author.name}
                  userId={d.author_id}
                  version={d.author.avatar_version}
                />
                <span>
                  <b>{d.author.name}</b>
                  <small>{d.author.department || '共创成员'}</small>
                </span>
              </Link>
              <span>
                {date(r.created_at)} · 修订 {r.number}
              </span>
              {draftAction}
              {own && (
                <Link className="text-button" to={'/editor/' + id}>
                  <Edit3 size={15} />
                  编辑
                </Link>
              )}
            </div>
            <p className="article-summary">{data.summary}</p>
            {data.coverId && (
              <img
                className="article-cover"
                loading="lazy"
                src={`/api/files/${data.coverId}?revision=${r.id}`}
                alt={data.title}
              />
            )}
            <MarkdownBody>{data.body}</MarkdownBody>
            {d.type === 'prompt' && (
              <section className="prompt-section">
                <div className="section-heading">
                  <h2>可直接复用的提示词</h2>
                  <button
                    className="button secondary small-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(fields.prompt);
                        toast('提示词已复制');
                      } catch {
                        toast('复制失败，请手动选择文本复制', true);
                      }
                    }}
                  >
                    <Copy size={16} />
                    复制提示词
                  </button>
                </div>
                <pre className="prompt-block">{fields.prompt}</pre>
              </section>
            )}
            <div className="detail-fields">
              {Object.entries(fieldLabels)
                .filter(([key]) => fields[key])
                .map(([key, label]) => (
                  <section key={key}>
                    <h2>{label}</h2>
                    <MarkdownBody>{fields[key]}</MarkdownBody>
                  </section>
                ))}
            </div>
            {(fields.demoUrl || fields.repoUrl) && (
              <div className="external-links">
                {fields.demoUrl && (
                  <a
                    className="button secondary"
                    href={`/api/contents/${id}/external/demoUrl`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={16} />
                    演示地址 · 外部链接
                  </a>
                )}
                {fields.repoUrl && (
                  <a
                    className="button secondary"
                    href={`/api/contents/${id}/external/repoUrl`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={16} />
                    代码仓库 · 外部链接
                  </a>
                )}
              </div>
            )}
            <div className="article-interactions">
              <button
                className={'button ' + (d.metrics.liked ? '' : 'secondary')}
                disabled={busy || mediaBusy || d.state !== 'published'}
                onClick={() =>
                  action(() => send(`/contents/${id}/like`, { active: !d.metrics.liked }, 'PUT'))
                }
              >
                <Heart size={18} fill={d.metrics.liked ? 'currentColor' : 'none'} />
                {d.metrics.likes} 赞
              </button>
              <button
                className={'button ' + (d.metrics.bookmarked ? '' : 'secondary')}
                disabled={busy || mediaBusy || d.state !== 'published'}
                onClick={() =>
                  action(
                    () =>
                      send(`/contents/${id}/bookmark`, { active: !d.metrics.bookmarked }, 'PUT'),
                    d.metrics.bookmarked ? '已取消收藏' : '已收藏',
                  )
                }
              >
                <Bookmark size={18} />
                {d.metrics.bookmarked ? '已收藏' : '收藏'}
              </button>
              <a href="#comments" className="button secondary">
                <MessageCircle size={18} />
                {d.metrics.comments} 条评论
              </a>
              <button
                className="text-button report-button"
                disabled={d.state !== 'published'}
                onClick={() => setReporting(!reporting)}
              >
                <Flag size={15} />
                举报
              </button>
            </div>
            {reporting && (
              <form
                className="report-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  action(
                    () => send(`/contents/${id}/reports`, { reason: report }),
                    '举报已提交',
                  ).then(() => setReporting(false));
                }}
              >
                <label>
                  请描述具体问题
                  <textarea
                    required
                    minLength={5}
                    maxLength={2000}
                    value={report}
                    onChange={(e) => setReport(e.target.value)}
                  />
                </label>
                <button className="button small-button" disabled={busy}>
                  提交举报
                </button>
              </form>
            )}
          </article>
          <ForumPreview related={id} />
          <section id="comments" className="comments-section panel">
            <h2>
              一起聊聊 <span>{comments.data?.total || 0}</span>
            </h2>
            <p className="muted">问题、建议，或者一句鼓励，都让分享更有价值。</p>
            {reply && (
              <div className="notice">
                回复 {reply.author}
                <button className="text-button" onClick={() => setReply(null)}>
                  取消回复
                </button>
              </div>
            )}
            <form
              className="comment-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const result = await send(`/contents/${id}/comments`, {
                    body: text,
                    parentId: reply?.id || null,
                    attachments: commentFiles.map((f) => f.id),
                  });
                  setText('');
                  setCommentFiles([]);
                  setReply(null);
                  if (result.status === 'approved')
                    detail.setData((previous: any) => ({
                      ...previous,
                      metrics: { ...previous.metrics, comments: previous.metrics.comments + 1 },
                    }));
                  void comments
                    .refresh()
                    .catch(() => toast('评论已提交，列表更新失败，请刷新评论区', true));
                  toast(
                    result.status === 'approved'
                      ? '评论已发布'
                      : result.status === 'review'
                        ? '评论与附件已提交审核'
                        : '评论已提交审核',
                  );
                } catch (e: any) {
                  toast(e.message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <MediaComposer
                label="评论内容"
                value={text}
                onChange={setText}
                files={commentFiles}
                onFilesChange={setCommentFiles}
                rows={5}
                maxLength={5000}
                maxFiles={10}
                disabled={busy || d.state !== 'published'}
                onBusyChange={setMediaBusy}
                uploadFile={(file, progress) => upload(id!, file, progress, 'comment')}
                removeFile={(file) => api('/files/' + file.id, { method: 'DELETE' })}
                placeholder="分享你的想法，也可以添加图片、表情包或附件…"
              />
              <div>
                <small>
                  {user.moderation_exempt ? '你的评论和回复可直接发布' : '评论和回复同样需要审核'}
                </small>
                <button
                  className="button small-button"
                  disabled={
                    busy ||
                    mediaBusy ||
                    d.state !== 'published' ||
                    (!text.trim() && !commentFiles.length)
                  }
                >
                  <Send size={15} />
                  发表评论
                </button>
              </div>
            </form>
            {comments.error && <ErrorState message={comments.error} retry={comments.reload} />}
            {comments.data?.items.map((cm: any) => (
              <div className="comment" key={cm.id}>
                <Avatar name={cm.author} userId={cm.author_id} version={cm.author_avatar_version} />
                <div className="comment-content">
                  <div>
                    <b>{cm.author}</b>
                    <HonorStrip honors={cm.honors} userId={cm.author_id} />
                    <time>{date(cm.created_at)}</time>
                    {cm.status !== 'approved' && <Badge status={cm.status} />}
                  </div>
                  {cm.parent_author && <small className="muted">回复 @{cm.parent_author}</small>}
                  <CommentMedia body={cm.body} files={cm.files} />
                  {cm.reason && cm.status !== 'approved' && <small>{cm.reason}</small>}
                  <div className="comment-actions">
                    {cm.status === 'approved' && (
                      <button className="text-button" onClick={() => setReply(cm)}>
                        回复
                      </button>
                    )}
                    {cm.status === 'approved' && (
                      <button
                        className="text-button"
                        onClick={async () => {
                          const reason = prompt('请描述举报该评论的原因（至少 5 个字）');
                          if (!reason) return;
                          try {
                            await send(`/contents/${id}/reports`, { reason, commentId: cm.id });
                            toast('举报已提交');
                          } catch (e: any) {
                            toast(e.message, true);
                          }
                        }}
                      >
                        举报
                      </button>
                    )}
                    {(cm.author_id === user.id || d.canManage) && (
                      <button
                        className="text-button danger"
                        onClick={async () => {
                          if (!confirm('确认删除这条评论？')) return;
                          try {
                            await api('/comments/' + cm.id, { method: 'DELETE' });
                            await comments.refresh();
                          } catch (e: any) {
                            toast(e.message, true);
                          }
                        }}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {comments.data?.total === 0 && (
              <p className="muted first-comment">成为第一个开启讨论的人。</p>
            )}
            <Pagination
              total={comments.data?.total || 0}
              page={commentPage}
              onChange={setCommentPage}
            />
          </section>
        </div>
        <aside className="detail-aside">
          <div className="panel author-card">
            <Avatar name={d.author.name} userId={d.author_id} version={d.author.avatar_version} />
            <h3>{d.author.name}</h3>
            <HonorStrip honors={d.honors} userId={d.author_id} />
            <p>{d.author.bio || '在实践中探索，在分享中成长。'}</p>
            <Link className="button secondary full" to={'/author/' + d.author_id}>
              看看 TA 的分享
            </Link>
          </div>
          {d.files.filter((f: any) => f.kind === 'resource').length > 0 && (
            <div className="panel">
              <h3>
                <Download size={18} />
                资源下载
              </h3>
              {d.files
                .filter((f: any) => f.kind === 'resource')
                .map((f: any) => (
                  <div key={f.id} className="attachment">
                    <File size={22} />
                    <div>
                      <b>{f.original_name}</b>
                      <small>
                        {size(f.size)} · v{fields.version || r.number} · {date(f.created_at)}
                      </small>
                      <Badge status={f.scan_status} />
                      {f.scan_status === 'clean' ? (
                        <a
                          className="button secondary small-button"
                          href={`/api/files/${f.id}?revision=${r.id}&download=1`}
                        >
                          <Download size={14} />
                          下载文件
                        </a>
                      ) : (
                        <p className="muted">{f.scan_reason}</p>
                      )}
                    </div>
                  </div>
                ))}
              <p className="form-tip">下载文件后请按说明检查和使用；平台不会执行技能包。</p>
            </div>
          )}
          {['project', 'skill'].includes(d.type) && (
            <div className="panel">
              <h3>
                <Clock size={18} />
                版本记录
              </h3>
              {versions.data?.items.map((v: any) => (
                <button
                  key={v.id}
                  className={'version-row ' + (v.id === r.id ? 'active' : '')}
                  onClick={() => setVersion(v.id)}
                >
                  <div>
                    <b>v{v.data.fields.version || v.number}</b>
                    <Badge status={v.status} />
                  </div>
                  <small>
                    {date(v.created_at)} · {v.data.fields.changelog || '内容更新'}
                  </small>
                </button>
              ))}
            </div>
          )}
          {(own || d.canManage) && (
            <div className="panel">
              <h3>内容管理</h3>
              {own && (
                <Link className="button secondary full" to={'/editor/' + id}>
                  编辑 / 新增版本
                </Link>
              )}
              <button
                className="button secondary full"
                onClick={() => {
                  if (confirm('确认下架？内容将退出首页、搜索和排行榜。'))
                    action(() => send('/contents/' + id + '/withdraw'), '内容已下架');
                }}
              >
                下架内容
              </button>
              {own && (
                <button
                  className="text-button danger"
                  onClick={async () => {
                    if (!confirm('确认删除这篇内容？删除后不可在个人中心恢复。')) return;
                    try {
                      await api('/contents/' + id, { method: 'DELETE' });
                      window.location.assign('/me');
                    } catch (e: any) {
                      toast(e.message, true);
                    }
                  }}
                >
                  删除内容
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
