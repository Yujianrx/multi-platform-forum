import { DeleteDraftButton, isDeletableDraft } from '../DraftActions';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Ticket,
  Layers,
  FileText,
  ShieldCheck,
  MessageSquare,
  Flag,
  HardDrive,
  Settings,
  ScrollText,
  Image,
  Plus,
  X,
  Copy,
  RefreshCw,
  ArrowUpRight,
  Check,
  AlertCircle,
} from '../icons';
import { api, send, useApi, date, size, typeLabels } from '../api';
import { useApp } from '../context';
import { HonorsAdmin } from '../HonorsAdmin';
import { ReviewMaterials } from '../admin/ReviewMaterials';
import { Field, Loading, ErrorState, Empty, Pagination, Badge, MarkdownBody } from '../components';
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog ref={ref} className="admin-dialog" onCancel={close}>
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="关闭">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Admin() {
  const { user, site, toast, refresh } = useApp(),
    [params, setParams] = useSearchParams(),
    section = params.get('section') || 'overview',
    page = Number(params.get('page') || 1),
    [modal, setModal] = useState<any>(null),
    [form, setForm] = useState<any>({}),
    [secret, setSecret] = useState(''),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState<any>(null),
    [filter, setFilter] = useState(''),
    [search, setSearch] = useState(''),
    [reviewIds, setReviewIds] = useState<string[]>([]),
    [reviewErrors, setReviewErrors] = useState<{ id: string; title: string; error: string }[]>([]);
  const tax = useApi('/taxonomy'),
    overview = useApi('/admin/overview');
  const resource = ['taxonomy', 'honors'].includes(section)
    ? null
    : section === 'overview'
      ? null
      : `/admin/${section}?page=${page}${section === 'contents' ? `&q=${encodeURIComponent(search)}${filter ? '&state=' + filter : ''}` : ''}`;
  const data = useApi(resource);
  const list = data.data?.items || [];
  useEffect(() => {
    setReviewIds([]);
    setReviewErrors([]);
  }, [section, page]);
  useEffect(() => {
    if (section === 'moderation' && data.data)
      setReviewIds((ids) => ids.filter((id) => data.data.items.some((j: any) => j.id === id)));
  }, [section, data.data]);
  useEffect(() => {
    if (section !== 'settings') setSettings(null);
    else if (data.data) setSettings(data.data);
  }, [section, data.data]);
  const tabs: any[] = [
    ['overview', '工作台', LayoutDashboard, false],
    ['users', '成员与权限', Users, true],
    ['invitations', '邀请码', Ticket, true],
    ['taxonomy', '部门 / 分类 / 标签', Layers, true],
    ['contents', '内容管理', FileText, false],
    ['moderation', '审核队列', ShieldCheck, false],
    ['honors', '积分与荣誉', ShieldCheck, false],
    ['comments', '评论管理', MessageSquare, false],
    ['reports', '举报处理', Flag, false],
    ['files', '附件与存储', HardDrive, true],
    ['banners', '首页轮播', Image, true],
    ['rules', '审核规则', ShieldCheck, true],
    ['settings', '站点设置', Settings, true],
    ['audit', '操作日志', ScrollText, true],
  ];
  const selected = tabs.find((t) => t[0] === section);
  if (selected?.[3] && user.role !== 'admin') return <ErrorState message="需要超级管理员权限" />;
  const change = (key: string, value: any) => setForm((f: any) => ({ ...f, [key]: value }));
  const localDate = (value: string) => {
    if (!value) return '';
    const d = new Date(value);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const open = (kind: string, item: any = {}) => {
    setSecret('');
    setModal({ kind, item });
    setForm(
      kind === 'user'
        ? {
            departmentId: item.department_id,
            role: item.role,
            active: item.active,
            moderationExempt: item.moderation_exempt ?? false,
            phone: item.phone_e164 || '',
            scopes: item.scopes || [],
          }
        : kind === 'invite'
          ? {
              label: '新同事入职',
              departmentId: tax.data?.departments[0]?.id || null,
              maxUses: 1,
              days: 7,
            }
          : kind === 'banner'
            ? {
                contentId: item.content_id || '',
                title: item.title || '',
                description: item.description || '',
                externalUrl: item.external_url || '',
                imageId: item.image_id || '',
                position: item.position || 0,
                enabled: item.enabled ?? true,
                startsAt: localDate(item.starts_at),
                endsAt: localDate(item.ends_at),
              }
            : kind === 'rule'
              ? { name: '', phrase: '', reason: '', enabled: true, action: 'review' }
              : kind === 'taxonomy'
                ? { name: item.name || '', kind: item.kind || 'departments' }
                : {
                    reason: '',
                    message: '',
                    decision: kind === 'batchReview' ? 'rejected' : 'approved',
                  },
    );
  };
  async function act(fn: () => Promise<any>, message = '操作成功', close = true) {
    setBusy(true);
    try {
      const result = await fn();
      toast(message);
      data.reload();
      tax.reload();
      overview.reload();
      if (close) setModal(null);
      return result;
    } catch (e: any) {
      toast(e.message, true);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const kind = modal.kind;
    try {
      if (kind === 'invite') {
        const r = await act(
          () =>
            send('/admin/invitations', {
              label: form.label,
              departmentId: form.departmentId || null,
              maxUses: Number(form.maxUses),
              expiresAt: new Date(Date.now() + Number(form.days) * 86400000).toISOString(),
            }),
          '邀请码已生成',
          false,
        );
        setSecret(r.code);
      } else if (kind === 'user') {
        await act(() => send('/admin/users/' + modal.item.id, { ...form, phone: form.phone.trim() || null }, 'PATCH'));
        if (modal.item.id === user.id) await refresh();
      } else if (kind === 'deleteUser') {
        await act(
          () => send('/admin/users/' + modal.item.id, { username: form.username }, 'DELETE'),
          '账号已删除，历史内容已保留',
        );
        if (list.length === 1 && page > 1) setParams({ section, page: String(page - 1) });
      } else if (kind === 'taxonomy') {
        if (modal.item.id)
          await act(() =>
            send(`/admin/taxonomy/${form.kind}/${modal.item.id}`, { name: form.name }, 'PATCH'),
          );
        else await act(() => send('/admin/taxonomy/' + form.kind, { name: form.name }));
      } else if (kind === 'rule') await act(() => send('/admin/rules', form));
      else if (kind === 'batchReview') await reviewBatch('rejected', form.reason, modal.item.ids);
      else if (kind === 'review')
        await act(
          () =>
            send('/admin/moderation/' + modal.item.id + '/review', {
              decision: form.decision,
              confirmContribution: !!form.confirmContribution,
              ...(form.decision === 'rejected' ? { reason: form.reason } : {}),
            }),
          '审核已记录',
        );
      else if (kind === 'report')
        await act(() =>
          send('/admin/reports/' + modal.item.id, { resolution: form.reason }, 'PATCH'),
        );
      else if (kind === 'announcement')
        await act(() => send('/admin/announcement', { message: form.message }), '公告已发送');
      else if (kind === 'banner')
        await act(() =>
          send(
            '/admin/banners' + (modal.item.id ? '/' + modal.item.id : ''),
            {
              ...form,
              contentId: form.contentId || null,
              imageId: form.imageId || null,
              position: Number(form.position),
              startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
              endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
            },
            modal.item.id ? 'PATCH' : 'POST',
          ),
        );
    } catch {}
  }
  async function reviewBatch(decision: 'approved' | 'rejected', reason = '', ids = reviewIds) {
    if (busy || !ids.length) return;
    setBusy(true);
    try {
      const result = await send('/admin/moderation/batch-review', {
        jobIds: ids,
        decision,
        ...(reason ? { reason } : {}),
      });
      const failed = result.results.filter((r: any) => !r.ok);
      setReviewIds(failed.map((r: any) => r.id));
      setReviewErrors(
        failed.map((r: any) => ({
          id: r.id,
          title: list.find((j: any) => j.id === r.id)?.data?.title || '评论审核',
          error: r.error,
        })),
      );
      toast(
        `已${decision === 'approved' ? '通过' : '退回'} ${result.succeeded} 项${result.failed ? `，${result.failed} 项未完成` : ''}`,
        result.failed > 0,
      );
      setModal(null);
      data.reload();
      overview.reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  const actionButton = (label: string, fn: () => Promise<any>, danger = false) => (
    <button
      className={'text-button ' + (danger ? 'danger' : '')}
      disabled={busy}
      onClick={() => act(fn).catch(() => {})}
    >
      {label}
    </button>
  );
  return (
    <div className="admin-page">
      <div className="admin-title">
        <div>
          <span className="eyebrow">COMMUNITY WORKSPACE</span>
          <h1>让社区保持活力</h1>
          <p>管理内容与成员，让每一份分享安心流动。</p>
        </div>
        <span className="role-label">
          <ShieldCheck size={17} />
          {user.role === 'admin' ? '超级管理员' : '授权版主'}
        </span>
      </div>
      <div className="admin-layout">
        <aside className="admin-nav panel">
          {tabs
            .filter((t) => !t[3] || user.role === 'admin')
            .map(([key, label, Icon]) => (
              <button
                key={key}
                className={section === key ? 'active' : ''}
                onClick={() => {
                  setParams({ section: key });
                  setSearch('');
                  setFilter('');
                }}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
        </aside>
        <section className="admin-content">
          <div className="section-heading">
            <h2>{selected?.[1]}</h2>
            <div className="actions">
              <button
                className="icon-button"
                aria-label="刷新"
                onClick={() => {
                  data.reload();
                  overview.reload();
                  tax.reload();
                }}
              >
                <RefreshCw size={17} />
              </button>
              {section === 'invitations' && (
                <button className="button small-button" onClick={() => open('invite')}>
                  <Plus size={15} />
                  生成邀请码
                </button>
              )}
              {section === 'banners' && (
                <button className="button small-button" onClick={() => open('banner')}>
                  <Plus size={15} />
                  添加轮播
                </button>
              )}
              {section === 'rules' && (
                <button className="button small-button" onClick={() => open('rule')}>
                  <Plus size={15} />
                  新增规则
                </button>
              )}
              {section === 'overview' && user.role === 'admin' && (
                <button className="button small-button" onClick={() => open('announcement')}>
                  发布公告
                </button>
              )}
            </div>
          </div>
          {section === 'honors' ? (
            <HonorsAdmin />
          ) : section === 'overview' ? (
            <>
              {overview.loading ? (
                <Loading />
              ) : overview.error ? (
                <ErrorState message={overview.error} retry={overview.reload} />
              ) : (
                <>
                  <div className="admin-stats">
                    {[
                      ['users', '社区成员', '人'],
                      ['published', '已发布内容', '篇'],
                      ['pending', '等待复核', '项'],
                      ['downloads', '有效下载', '次'],
                    ]
                      .filter(([k]) => overview.data[k] !== undefined)
                      .map(([k, l, u]) => (
                        <div className="panel" key={k}>
                          <span>{l}</span>
                          <strong>
                            {overview.data[k]}
                            <small>{u}</small>
                          </strong>
                        </div>
                      ))}
                  </div>
                  <div className="panel service-status">
                    <h3>审核与安全服务</h3>
                    <div>
                      <span className="service-icon">
                        <ShieldCheck size={24} />
                      </span>
                      <div>
                        <b>
                          内容审核：
                          {overview.data.provider === 'none'
                            ? '未配置真实供应商'
                            : overview.data.provider === 'development'
                              ? '开发模拟器'
                              : '已配置'}
                        </b>
                        <p>
                          {overview.data.provider === 'none'
                            ? '生产内容保持待人工复核，不会自动放行。'
                            : '开发模拟结果仅用于演示和测试，不代表真实识别能力。'}
                        </p>
                      </div>
                      <Badge status={overview.data.provider === 'none' ? 'review' : 'approved'} />
                    </div>
                    <div>
                      <span className="service-icon">
                        <HardDrive size={24} />
                      </span>
                      <div>
                        <b>
                          恶意文件扫描：
                          {overview.data.scanner === 'configured' ? '已配置 ClamAV 连接' : '未配置'}
                        </b>
                        <p>
                          待检查文件随正文一并审核；免审账号的附件同步免审，已检出恶意的文件仍被阻止。
                        </p>
                      </div>
                    </div>
                    <p className="notice">
                      审核供应商与扫描服务的凭证仅由服务器环境配置；变更后重启服务。规则可设置为人工复核或直接退回，政治语境需结合全文判断。
                    </p>
                  </div>
                  <div className="panel">
                    <h3>工作台快捷入口</h3>
                    <div className="admin-shortcuts">
                      {[
                        ['moderation', '处理审核队列'],
                        ['contents', '整理精选内容'],
                        ['reports', '查看举报反馈'],
                      ].map(([k, l]) => (
                        <button
                          key={k}
                          className="button secondary"
                          onClick={() => setParams({ section: k })}
                        >
                          {l}
                          <ArrowUpRight size={17} />
                        </button>
                      ))}
                    </div>
                    <p className="muted">
                      当前持久化文件占用：{size(overview.data.storage || 0)} ·
                      日志不保存密码、密钥或完整令牌。
                    </p>
                  </div>
                </>
              )}
            </>
          ) : section === 'taxonomy' ? (
            <div className="taxonomy-grid">
              {[
                ['departments', '部门'],
                ['categories', '内容分类 / 论坛版块'],
                ['tags', '标签'],
                ['tools', '工具名称'],
              ].map(([kind, label]) => (
                <div className="panel" key={kind}>
                  <div className="section-heading">
                    <h3>{label}</h3>
                    <button
                      className="icon-button"
                      aria-label={'添加' + label}
                      onClick={() => open('taxonomy', { kind })}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {tax.data?.[kind].map((t: any) => (
                    <div className="taxonomy-row" key={t.id}>
                      <span>{t.name}</span>
                      <div>
                        {kind !== 'tags' && (
                          <button
                            className="text-button"
                            onClick={() => open('taxonomy', { ...t, kind })}
                          >
                            改名
                          </button>
                        )}
                        <button
                          className="text-button danger"
                          onClick={() => {
                            if (confirm(`确认删除“${t.name}”？被使用的部门或分类无法删除。`))
                              act(() =>
                                api(`/admin/taxonomy/${kind}/${t.id}`, { method: 'DELETE' }),
                              ).catch(() => {});
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : data.loading ? (
            <Loading />
          ) : data.error ? (
            <ErrorState message={data.error} retry={data.reload} />
          ) : section === 'settings' && settings ? (
            <form
              className="panel settings-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await act(() => send('/admin/settings', settings, 'PUT'), '站点设置已更新');
                  await refresh();
                } catch {}
              }}
            >
              <Field label="站点名称">
                <input
                  required
                  maxLength={40}
                  value={settings.name}
                  onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                />
              </Field>
              <Field label="Logo 标记" hint="可使用文字或 Emoji，最多 8 个字符。">
                <input
                  maxLength={8}
                  value={settings.logo}
                  placeholder="✳"
                  onChange={(e) => setSettings({ ...settings, logo: e.target.value })}
                />
              </Field>
              <Field
                label="图片 Logo"
                hint="PNG / JPEG / WebP，最多 10 MB。上传后直接更新，登录后展示。"
              >
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    const body = new FormData();
                    body.append('file', file);
                    try {
                      await act(
                        () => api('/admin/logo', { method: 'POST', body }),
                        '图片 Logo 已更新',
                      );
                      await refresh();
                    } catch {}
                  }}
                />
              </Field>
              {site.hasLogo && (
                <div className="brand-preview">
                  <img src={'/api/logo?v=' + site.logoVersion} alt="当前站点 Logo" />
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={async () => {
                      try {
                        await act(() => api('/admin/logo', { method: 'DELETE' }), '已恢复文字标记');
                        await refresh();
                      } catch {}
                    }}
                  >
                    移除图片 Logo
                  </button>
                </div>
              )}
              <Field label="站点简介">
                <textarea
                  maxLength={200}
                  value={settings.description}
                  onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                />
              </Field>
              <div className="three-fields">
                {[
                  ['imageMaxMB', '单张图片上限 MB', 10],
                  ['resourceMaxMB', '资源包上限 MB', 100],
                  ['quotaMB', '每人存储额度 MB', 102400],
                ].map(([k, l, m]) => (
                  <Field key={k} label={String(l)}>
                    <input
                      type="number"
                      min={1}
                      max={Number(m)}
                      required
                      value={settings[k]}
                      onChange={(e) => setSettings({ ...settings, [k]: Number(e.target.value) })}
                    />
                  </Field>
                ))}
              </div>
              <fieldset className="tag-picker">
                <legend>允许上传类型</legend>
                {[
                  'png',
                  'jpg',
                  'jpeg',
                  'webp',
                  'gif',
                  'txt',
                  'md',
                  'json',
                  'csv',
                  'zip',
                  'pdf',
                  'docx',
                  'xlsx',
                  'pptx',
                ].map((t) => (
                  <label key={t}>
                    <input
                      type="checkbox"
                      checked={settings.allowedTypes.includes(t)}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          allowedTypes: e.target.checked
                            ? [...settings.allowedTypes, t]
                            : settings.allowedTypes.filter((s: string) => s !== t),
                        })
                      }
                    />
                    {t}
                  </label>
                ))}
              </fieldset>
              <button className="button" disabled={busy}>
                保存站点设置
              </button>
            </form>
          ) : (
            <>
              {section === 'contents' && (
                <div className="admin-filter">
                  <input
                    aria-label="按标题查找内容"
                    placeholder="按标题查找…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setParams({ section });
                    }}
                  />
                  <select
                    aria-label="内容状态筛选"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setParams({ section });
                    }}
                  >
                    <option value="">全部状态</option>
                    {[
                      ['published', '已发布'],
                      ['draft', '草稿 / 待审'],
                      ['withdrawn', '已下架'],
                      ['deleted', '已删除'],
                    ].map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {section === 'rules' && (
                <p className="notice">
                  明确辱骂短语直接退回。煽动暴力、恐怖主义、政变及仇恨攻击不得通过，任何国家一视同仁；正常新闻、研究和时政讨论可通过。涉及政治语境的关键词仅用于提示人工复核。
                </p>
              )}
              {section === 'moderation' && (
                <>
                  {list.length > 0 && (
                    <div className="review-toolbar">
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={reviewIds.length === list.length}
                          ref={(el) => {
                            if (el)
                              el.indeterminate =
                                reviewIds.length > 0 && reviewIds.length < list.length;
                          }}
                          disabled={busy}
                          onChange={(e) =>
                            setReviewIds(e.target.checked ? list.map((j: any) => j.id) : [])
                          }
                        />
                        全选本页
                      </label>
                      <span>已选 {reviewIds.length} 项</span>
                      <div className="actions">
                        <button
                          className="button secondary small-button"
                          disabled={busy || !reviewIds.length}
                          onClick={() => open('batchReview', { ids: [...reviewIds] })}
                        >
                          批量退回
                        </button>
                        <button
                          className="button small-button"
                          disabled={busy || !reviewIds.length}
                          onClick={() => void reviewBatch('approved')}
                        >
                          {busy ? '处理中…' : '批量通过'}
                        </button>
                      </div>
                    </div>
                  )}
                  {reviewErrors.length > 0 && (
                    <div className="panel review-batch-errors" role="alert">
                      {reviewErrors.map((r) => (
                        <p key={r.id}>
                          <strong>{r.title}</strong>
                          <span>{r.error}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
              {!list.length ? (
                <Empty title="暂无记录" description="后续操作和社区活动会显示在这里。" />
              ) : section === 'moderation' ? (
                <div className="review-list">
                  {list.map((j: any) => (
                    <article className="panel review-item" key={j.id}>
                      <div className="section-heading">
                        <div className="review-choice">
                          <input
                            type="checkbox"
                            aria-label={'选择 ' + (j.data?.title || '评论审核')}
                            checked={reviewIds.includes(j.id)}
                            disabled={busy}
                            onChange={(e) =>
                              setReviewIds((ids) =>
                                e.target.checked ? [...ids, j.id] : ids.filter((id) => id !== j.id),
                              )
                            }
                          />
                          <h3>{j.data?.title || '评论审核'}</h3>
                        </div>
                        <Badge status={j.status} />
                      </div>
                      <p>{j.data?.summary || j.comment_body}</p>
                      <details className="review-materials-toggle">
                        <summary>
                          查看正文与附件{j.files?.length ? `（${j.files.length}）` : ''}
                        </summary>
                        <ReviewMaterials job={j} />
                      </details>
                      <p className="review-reason">
                        {j.last_error || '等待审核执行'} · 已尝试 {j.attempts} 次
                      </p>
                      <div className="actions">
                        <Link
                          className="text-button"
                          to={`/content/${j.content_id}${j.revision_id ? '?revision=' + j.revision_id : ''}`}
                        >
                          查看完整内容 ↗
                        </Link>
                        <button
                          className="text-button"
                          onClick={async () => {
                            try {
                              const r = await api('/admin/moderation/' + j.id + '/records');
                              open('records', { records: r.items });
                            } catch (e: any) {
                              toast(e.message, true);
                            }
                          }}
                        >
                          审核记录
                        </button>
                        <button
                          className="button secondary small-button"
                          onClick={() =>
                            act(
                              () => send('/admin/moderation/' + j.id + '/retry'),
                              '已加入重试队列',
                            ).catch(() => {})
                          }
                        >
                          重试
                        </button>
                        <button
                          className="button small-button"
                          disabled={busy}
                          onClick={() => open('review', j)}
                        >
                          人工复核
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="table-wrap panel">
                  <table>
                    <thead>
                      <tr>
                        {(section === 'users'
                          ? ['成员', '部门 / 角色', '状态', '操作']
                          : section === 'invitations'
                            ? ['邀请码名称', '部门 / 名额', '有效期', '操作']
                            : section === 'contents'
                              ? ['内容', '作者 / 类型', '状态', '运营操作']
                              : section === 'files'
                                ? ['文件', '占用 / 归属', '检查状态', '操作']
                                : section === 'audit'
                                  ? ['操作', '对象', '操作者 / 时间', '结果']
                                  : section === 'comments'
                                    ? ['评论内容', '作者', '状态', '操作']
                                    : section === 'reports'
                                      ? ['举报原因', '处理结果', '状态', '操作']
                                      : section === 'banners'
                                        ? ['轮播标题', '顺序 / 目标', '状态', '操作']
                                        : ['规则名称', '命中短语', '处理方式', '解释原因', '操作']
                        ).map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r: any) => (
                        <tr key={r.id}>
                          {section === 'users' ? (
                            <>
                              <td>
                                <b>{r.name}</b>
                                <small>{r.username}</small>
                              </td>
                              <td>
                                {r.department || '未分配'}
                                <small>
                                  {
                                    (
                                      {
                                        admin: '超级管理员',
                                        moderator: '版主',
                                        member: '普通成员',
                                      } as any
                                    )[r.role]
                                  }
                                </small>
                              </td>
                              <td>
                                <Badge status={r.active ? 'approved' : 'blocked'} />
                                {r.moderation_exempt && <small>发布免审</small>}
                              </td>
                              <td>
                                <div className="table-actions">
                                  <button className="text-button" onClick={() => open('user', r)}>
                                    权限与部门
                                  </button>
                                  <button
                                    className="text-button"
                                    onClick={async () => {
                                      if (
                                        !confirm(
                                          '发起密码重置后，该成员所有会话和旧密码立即失效。继续？',
                                        )
                                      )
                                        return;
                                      try {
                                        const result = await act(
                                          () => send('/admin/users/' + r.id + '/reset'),
                                          '一次性重置凭证已生成',
                                          false,
                                        );
                                        open('secret', { title: '一次性密码重置凭证' });
                                        setSecret(result.token);
                                      } catch {}
                                    }}
                                  >
                                    重置密码
                                  </button>
                                  {r.id !== user.id && (
                                    <button
                                      className="text-button danger"
                                      disabled={busy}
                                      onClick={() => open('deleteUser', r)}
                                    >
                                      删除账号
                                    </button>
                                  )}
                                </div>
                              </td>
                            </>
                          ) : section === 'invitations' ? (
                            <>
                              <td>
                                <b>{r.label}</b>
                                <small>凭证仅在创建时显示</small>
                              </td>
                              <td>
                                {r.department || '未分配'}
                                <small>
                                  {r.used_count} / {r.max_uses} 次
                                </small>
                              </td>
                              <td>
                                {date(r.expires_at)}
                                <small>
                                  {r.revoked
                                    ? '已撤销'
                                    : new Date(r.expires_at) < new Date()
                                      ? '已过期'
                                      : '有效'}
                                </small>
                              </td>
                              <td>
                                <div className="table-actions">
                                  <button
                                    className="text-button"
                                    onClick={async () => {
                                      try {
                                        const uses = await api(
                                          '/admin/invitations/' + r.id + '/uses',
                                        );
                                        open('uses', { records: uses.items });
                                      } catch (e: any) {
                                        toast(e.message, true);
                                      }
                                    }}
                                  >
                                    使用记录
                                  </button>
                                  {!r.revoked &&
                                    actionButton(
                                      '撤销',
                                      () => send('/admin/invitations/' + r.id + '/revoke'),
                                      true,
                                    )}
                                </div>
                              </td>
                            </>
                          ) : section === 'contents' ? (
                            <>
                              <td>
                                <Link to={'/content/' + r.id}>{r.title || '未命名草稿'}</Link>
                                <small>
                                  {r.featured ? '精选 · ' : ''}
                                  {r.pinned ? '置顶' : ''}
                                </small>
                              </td>
                              <td>
                                {r.author}
                                <small>{typeLabels[r.type]}</small>
                              </td>
                              <td>
                                <Badge status={r.state} />
                                <small>
                                  <Badge status={r.status || 'draft'} />
                                </small>
                              </td>
                              <td>
                                <div className="table-actions">
                                  {actionButton(r.featured ? '取消精选' : '设为精选', () =>
                                    send(
                                      '/admin/contents/' + r.id,
                                      { featured: !r.featured, pinned: r.pinned },
                                      'PATCH',
                                    ),
                                  )}
                                  {actionButton(r.pinned ? '取消置顶' : '置顶', () =>
                                    send(
                                      '/admin/contents/' + r.id,
                                      { featured: r.featured, pinned: !r.pinned },
                                      'PATCH',
                                    ),
                                  )}
                                  {user.role === 'admin' && isDeletableDraft(r.state, r.status) && (
                                    <DeleteDraftButton
                                      id={r.id}
                                      revisionId={r.latest_revision_id || null}
                                      published={r.state === 'published'}
                                      onDeleted={data.reload}
                                      onStale={data.reload}
                                    />
                                  )}
                                  {r.state === 'published' && (
                                    <button
                                      className="text-button danger"
                                      onClick={() => {
                                        if (confirm('确认下架此内容？'))
                                          act(() => send('/contents/' + r.id + '/withdraw')).catch(
                                            () => {},
                                          );
                                      }}
                                    >
                                      下架
                                    </button>
                                  )}
                                </div>
                              </td>
                            </>
                          ) : section === 'files' ? (
                            <>
                              <td>
                                <b>{r.original_name}</b>
                                <small>{r.mime}</small>
                              </td>
                              <td>
                                {size(r.size)}
                                <small>{r.owner}</small>
                              </td>
                              <td>
                                <Badge status={r.scan_status} />
                                <small>{r.scan_reason}</small>
                              </td>
                              <td>
                                <div className="table-actions">
                                  <a
                                    className="text-button"
                                    href={`/api/admin/files/${r.id}/quarantine`}
                                  >
                                    下载隔离文件
                                  </a>
                                  <Link className="text-button" to="/admin?section=moderation">
                                    查看审核队列
                                  </Link>
                                </div>
                              </td>
                            </>
                          ) : section === 'audit' ? (
                            <>
                              <td>{r.action}</td>
                              <td className="id-cell">{r.target}</td>
                              <td>
                                {r.actor || '系统'}
                                <small>{new Date(r.created_at).toLocaleString('zh-CN')}</small>
                              </td>
                              <td>
                                {r.result}
                                <details>
                                  <summary>详情</summary>
                                  <pre>{JSON.stringify(r.details, null, 2)}</pre>
                                </details>
                              </td>
                            </>
                          ) : section === 'comments' ? (
                            <>
                              <td>
                                <p className="table-body">{r.body}</p>
                                <Link className="text-button" to={'/content/' + r.content_id}>
                                  查看讨论
                                </Link>
                              </td>
                              <td>{r.author}</td>
                              <td>
                                <Badge status={r.status} />
                              </td>
                              <td>
                                {r.status !== 'deleted' && (
                                  <button
                                    className="text-button danger"
                                    onClick={() => {
                                      if (confirm('确认删除该评论？'))
                                        act(() =>
                                          api('/comments/' + r.id, { method: 'DELETE' }),
                                        ).catch(() => {});
                                    }}
                                  >
                                    删除
                                  </button>
                                )}
                              </td>
                            </>
                          ) : section === 'reports' ? (
                            <>
                              <td>
                                {r.reason}
                                <small>
                                  <Link to={'/content/' + r.content_id}>查看相关内容 ↗</Link>
                                </small>
                              </td>
                              <td>{r.resolution || '尚未处理'}</td>
                              <td>
                                <Badge status={r.status} />
                              </td>
                              <td>
                                {r.status === 'open' && (
                                  <button className="text-button" onClick={() => open('report', r)}>
                                    处理举报
                                  </button>
                                )}
                              </td>
                            </>
                          ) : section === 'banners' ? (
                            <>
                              <td>
                                <b>{r.title}</b>
                                <small>{r.description}</small>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  aria-label={'轮播顺序 ' + r.title}
                                  className="order-input"
                                  defaultValue={r.position}
                                  onBlur={(e) => {
                                    if (Number(e.target.value) !== r.position)
                                      act(() =>
                                        send(
                                          '/admin/banners/' + r.id,
                                          { enabled: r.enabled, position: Number(e.target.value) },
                                          'PATCH',
                                        ),
                                      ).catch(() => {});
                                  }}
                                />
                                <small>{r.content_id ? '站内内容' : '外部链接'}</small>
                              </td>
                              <td>
                                {r.enabled ? '启用' : '关闭'}
                                <small>
                                  {r.starts_at ? date(r.starts_at) : '即时'} →{' '}
                                  {r.ends_at ? date(r.ends_at) : '长期'}
                                </small>
                              </td>
                              <td>
                                <div className="table-actions">
                                  <button className="text-button" onClick={() => open('banner', r)}>
                                    编辑
                                  </button>
                                  {actionButton(r.enabled ? '停用' : '启用', () =>
                                    send(
                                      '/admin/banners/' + r.id,
                                      { enabled: !r.enabled, position: r.position },
                                      'PATCH',
                                    ),
                                  )}
                                  {actionButton(
                                    '删除',
                                    () => api('/admin/banners/' + r.id, { method: 'DELETE' }),
                                    true,
                                  )}
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>{r.name}</td>
                              <td>{r.phrase}</td>
                              <td>{r.action === 'reject' ? '直接退回' : '人工复核'}</td>
                              <td>{r.reason}</td>
                              <td>
                                {actionButton(
                                  '删除',
                                  () => api('/admin/rules/' + r.id, { method: 'DELETE' }),
                                  true,
                                )}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination
                total={data.data?.total || list.length}
                page={page}
                onChange={(p) => setParams({ section, page: String(p) })}
              />
            </>
          )}
        </section>
      </div>
      {modal && (
        <Modal
          title={
            modal.item.title ||
            (
              {
                invite: '生成邀请码',
                user: '调整成员权限',
                deleteUser: '删除员工账号',
                taxonomy: '维护分类与部门',
                rule: '新增审核规则',
                review: '人工审核',
                batchReview: `批量退回 ${modal.item.ids?.length || 0} 项`,
                report: '处理举报',
                banner: '添加首页轮播',
                announcement: '发布管理员公告',
                uses: '邀请码使用记录',
                records: '审核记录',
                secret: '一次性凭证',
              } as any
            )[modal.kind]
          }
          close={() => setModal(null)}
        >
          {secret ? (
            <div className="secret-box">
              <p>请通过公司可信渠道交给对应成员。凭证不会再次显示。</p>
              <code>{secret}</code>
              <button
                className="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(secret);
                    toast('凭证已复制');
                  } catch {
                    toast('复制失败，请手动复制', true);
                  }
                }}
              >
                <Copy size={16} />
                复制凭证
              </button>
              {modal.kind === 'secret' && <p>有效期 30 分钟；成员使用后必须设置新密码。</p>}
            </div>
          ) : ['uses', 'records'].includes(modal.kind) ? (
            <div className="records-list">
              {!modal.item.records.length && <Empty title="暂无记录" />}
              {modal.item.records.map((r: any, i: number) => (
                <div key={i} className="record">
                  <b>{r.name || r.provider}</b>
                  <p>{r.username || r.reason}</p>
                  {r.decision && <Badge status={r.decision} />}
                  <small>{new Date(r.used_at || r.created_at).toLocaleString('zh-CN')}</small>
                  {r.categories?.length > 0 && <p>{r.categories.join('、')}</p>}
                </div>
              ))}
            </div>
          ) : (
            <form onSubmit={submit}>
              {modal.kind === 'deleteUser' && (
                <>
                  <p>
                    删除 {modal.item.name}{' '}
                    后，该账号将无法登录或通过接口投稿。历史文章、回复与贡献记录保留，作者显示为“已删除成员”。
                  </p>
                  <Field label="输入账号确认删除" hint={modal.item.username}>
                    <input
                      required
                      autoComplete="off"
                      value={form.username || ''}
                      onChange={(e) => change('username', e.target.value)}
                    />
                  </Field>
                </>
              )}
              {modal.kind === 'invite' && (
                <>
                  <Field label="邀请码名称">
                    <input
                      required
                      value={form.label}
                      onChange={(e) => change('label', e.target.value)}
                    />
                  </Field>
                  <Field label="默认部门">
                    <select
                      value={form.departmentId || ''}
                      onChange={(e) => change('departmentId', e.target.value || null)}
                    >
                      <option value="">暂不分配</option>
                      {tax.data?.departments.map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="使用次数">
                    <input
                      type="number"
                      required
                      min={1}
                      max={10000}
                      value={form.maxUses}
                      onChange={(e) => change('maxUses', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="有效天数">
                    <input
                      type="number"
                      required
                      min={1}
                      max={365}
                      value={form.days}
                      onChange={(e) => change('days', Number(e.target.value))}
                    />
                  </Field>
                </>
              )}
              {modal.kind === 'user' && (
                <>
                  <p>
                    {modal.item.name} · {modal.item.username}
                  </p>
                  <Field label="成员角色">
                    <select value={form.role} onChange={(e) => change('role', e.target.value)}>
                      <option value="member">普通成员</option>
                      <option value="moderator">版主</option>
                      <option value="admin">超级管理员</option>
                    </select>
                  </Field>
                  <Field label="所属部门">
                    <select
                      value={form.departmentId || ''}
                      onChange={(e) => change('departmentId', e.target.value || null)}
                    >
                      <option value="">暂不分配</option>
                      {tax.data?.departments.map((d: any) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="手机号" hint="用于微信小程序匹配此账号">
                    <input type="tel" value={form.phone} maxLength={32} onChange={(e) => change('phone', e.target.value)} />
                  </Field>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => change('active', e.target.checked)}
                    />
                    账号启用
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={form.moderationExempt}
                      onChange={(e) => change('moderationExempt', e.target.checked)}
                    />
                    发布免审
                  </label>
                  <p className="form-tip">开启后，新提交的帖子、文章、回复及其图片和附件均免审。</p>
                  {form.role === 'moderator' && (
                    <div className="scope-editor">
                      <h3>版主管理范围</h3>
                      <p className="form-tip">
                        一条授权中同时选部门与分类时，两者都需满足。未授权时版主不能处理内容。
                      </p>
                      {form.scopes.map((s: any, i: number) => (
                        <div className="scope-row" key={i}>
                          <select
                            aria-label="授权部门"
                            value={s.departmentId || ''}
                            onChange={(e) =>
                              change(
                                'scopes',
                                form.scopes.map((x: any, n: number) =>
                                  n === i ? { ...x, departmentId: e.target.value || null } : x,
                                ),
                              )
                            }
                          >
                            <option value="">不限部门</option>
                            {tax.data?.departments.map((d: any) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="授权分类"
                            value={s.categoryId || ''}
                            onChange={(e) =>
                              change(
                                'scopes',
                                form.scopes.map((x: any, n: number) =>
                                  n === i ? { ...x, categoryId: e.target.value || null } : x,
                                ),
                              )
                            }
                          >
                            <option value="">不限分类</option>
                            {tax.data?.categories.map((d: any) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="删除授权"
                            onClick={() =>
                              change(
                                'scopes',
                                form.scopes.filter((_: any, n: number) => n !== i),
                              )
                            }
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          change('scopes', [
                            ...form.scopes,
                            {
                              departmentId: tax.data?.departments[0]?.id || null,
                              categoryId: null,
                            },
                          ])
                        }
                      >
                        + 添加授权范围
                      </button>
                    </div>
                  )}
                  <p className="notice">
                    停用立即撤销已有会话。角色变更需要重新登录，部门变更实时生效。
                  </p>
                </>
              )}
              {modal.kind === 'taxonomy' && (
                <Field label="名称">
                  <input
                    required
                    maxLength={50}
                    value={form.name}
                    onChange={(e) => change('name', e.target.value)}
                  />
                </Field>
              )}
              {modal.kind === 'rule' && (
                <>
                  <Field label="规则名称">
                    <input
                      required
                      minLength={2}
                      value={form.name}
                      onChange={(e) => change('name', e.target.value)}
                    />
                  </Field>
                  <Field label="明确描述的命中短语（至少 2 字）">
                    <input
                      required
                      minLength={2}
                      value={form.phrase}
                      onChange={(e) => change('phrase', e.target.value)}
                    />
                  </Field>
                  <Field label="处理方式">
                    <select
                      value={form.action || 'review'}
                      onChange={(e) => change('action', e.target.value)}
                    >
                      <option value="review">人工复核</option>
                      <option value="reject">直接退回</option>
                    </select>
                  </Field>
                  <Field label="规则解释与复核依据（至少 10 字）">
                    <textarea
                      required
                      minLength={10}
                      value={form.reason}
                      onChange={(e) => change('reason', e.target.value)}
                    />
                  </Field>
                </>
              )}
              {['review', 'batchReview', 'report'].includes(modal.kind) && (
                <>
                  {modal.kind === 'review' && (
                    <>
                      <ReviewMaterials job={modal.item} />
                      <p className="notice">通过内容时同步通过关联文件。</p>
                    </>
                  )}
                  {modal.kind === 'review' &&
                    form.decision === 'approved' &&
                    !modal.item.comment_id &&
                    ['experience', 'project', 'skill'].includes(modal.item.type) && (
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={!!form.confirmContribution}
                          onChange={(e) => change('confirmContribution', e.target.checked)}
                        />
                        同时确认贡献资格：已核实案例原创实用，或资源说明完整且可用
                      </label>
                    )}
                  {!['report', 'batchReview'].includes(modal.kind) && (
                    <Field label="处理结论">
                      <select
                        value={form.decision}
                        onChange={(e) => change('decision', e.target.value)}
                      >
                        <option value="approved">通过正文及附件</option>
                        <option value="rejected">退回内容</option>
                      </select>
                    </Field>
                  )}
                  {(form.decision === 'rejected' || modal.kind === 'report') && (
                    <Field label={modal.kind === 'report' ? '处理原因' : '退回原因'}>
                      <textarea
                        required
                        minLength={5}
                        maxLength={1000}
                        value={form.reason}
                        onChange={(e) => change('reason', e.target.value)}
                        rows={5}
                      />
                    </Field>
                  )}
                </>
              )}
              {modal.kind === 'announcement' && (
                <Field label="公告内容">
                  <textarea
                    required
                    maxLength={1000}
                    value={form.message}
                    onChange={(e) => change('message', e.target.value)}
                    rows={5}
                  />
                </Field>
              )}
              {modal.kind === 'banner' && (
                <>
                  <Field label="轮播标题">
                    <input
                      required
                      maxLength={100}
                      value={form.title}
                      onChange={(e) => change('title', e.target.value)}
                    />
                  </Field>
                  <Field label="说明">
                    <textarea
                      maxLength={300}
                      value={form.description}
                      onChange={(e) => change('description', e.target.value)}
                    />
                  </Field>
                  <Field
                    label="目标内容 ID"
                    hint="从内容详情地址最后一段复制；部门内容仅向有权限的成员展示。"
                  >
                    <input
                      value={form.contentId}
                      onChange={(e) => change('contentId', e.target.value)}
                    />
                  </Field>
                  <Field label="或外部链接">
                    <input
                      type="url"
                      value={form.externalUrl}
                      onChange={(e) => change('externalUrl', e.target.value)}
                    />
                  </Field>
                  <Field label="目标内容中的图片 ID（可选）">
                    <input
                      value={form.imageId}
                      onChange={(e) => change('imageId', e.target.value)}
                    />
                  </Field>
                  <Field label="顺序">
                    <input
                      type="number"
                      value={form.position}
                      onChange={(e) => change('position', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="开始展示时间（可选）">
                    <input
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(e) => change('startsAt', e.target.value)}
                    />
                  </Field>
                  <Field label="结束展示时间（可选）">
                    <input
                      type="datetime-local"
                      value={form.endsAt}
                      onChange={(e) => change('endsAt', e.target.value)}
                    />
                  </Field>
                </>
              )}
              <div className="dialog-actions">
                <button className="button secondary" type="button" onClick={() => setModal(null)}>
                  取消
                </button>
                <button
                  className="button"
                  disabled={
                    busy || (modal.kind === 'deleteUser' && form.username !== modal.item.username)
                  }
                >
                  {busy
                    ? '正在保存…'
                    : ['review', 'batchReview'].includes(modal.kind)
                      ? form.decision === 'approved'
                        ? '确认通过'
                        : '确认退回'
                      : modal.kind === 'deleteUser'
                        ? '确认删除账号'
                        : '确认保存'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
