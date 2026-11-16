import { DeleteDraftButton, isDeletableDraft } from '../DraftActions';
import { PersonalHonors, PublicHonors } from '../Honors';
import { AvatarSettings } from '../AvatarSettings';
import { ApiAccess } from '../ApiAccess';
import {
  PASSWORD_HINT,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '../../server/account-policy';
import { useState, lazy } from 'react';
import { useMobile } from '../mobile/useMobile';
const MobileProfileHeader = lazy(() =>
  import('../mobile/MobileProfile').then((m) => ({ default: m.MobileProfileHeader })),
);
const MobileProfileTabs = lazy(() =>
  import('../mobile/MobileProfile').then((m) => ({ default: m.MobileProfileTabs })),
);
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus,
  FileText,
  Bookmark,
  Download,
  Bell,
  Settings,
  Clock,
  ShieldCheck,
  CheckCheck,
  ArrowRight,
} from '../icons';
import { useApi, send, date } from '../api';
import { useApp } from '../context';
import { Avatar, ContentCard, Loading, ErrorState, Empty, Pagination, Field } from '../components';
export function Profile() {
  const mobile = useMobile();
  const { user, toast, refresh } = useApp(),
    [params, setParams] = useSearchParams(),
    tab =
      (mobile && params.get('tab') === 'menu' ? 'published' : params.get('tab')) ||
      (mobile ? 'published' : 'all'),
    page = Number(params.get('page') || 1),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(user.name),
    [bio, setBio] = useState(user.bio),
    [password, setPassword] = useState(''),
    [current, setCurrent] = useState('');
  const content = useApi(
    ['settings', 'api', 'honors'].includes(tab) ? null : `/contents?mine=${tab}&page=${page}`,
  );
  const tabs: any[] = [
    ...(mobile ? [['published', '我的发布', FileText]] : []),
    ['all', '我的发布', FileText],
    ['honors', '我的贡献', ShieldCheck],
    ['draft', '草稿箱', FileText],
    ['review', '等待审核', Clock],
    ['rejected', '被退回', Clock],
    ['bookmarks', '我的收藏', Bookmark],
    ['downloads', '下载记录', Download],
    ['settings', '资料与密码', Settings],
    ['api', 'AI 接入', Settings],
  ];
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await send('/auth/password', { currentPassword: current, password });
      setPassword('');
      setCurrent('');
      await refresh();
      toast('密码已修改，其他会话已退出');
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-page">
      {mobile ? (
        !['settings', 'api', 'honors'].includes(tab) && <MobileProfileHeader />
      ) : (
        <div className="profile-hero">
          <Avatar name={user.name} userId={user.id} version={user.avatar_version} />
          <div>
            <span className="eyebrow">MY CREATIVE SPACE</span>
            <h1>{user.name} 的共创空间</h1>
            <p>{user.bio || '把每一次探索，变成值得留下的分享。'}</p>
          </div>
          <Link className="button" to="/editor">
            <Plus size={17} />
            发布新内容
          </Link>
        </div>
      )}
      <div className="profile-layout">
        {mobile ? (
          <MobileProfileTabs tab={tab} change={(t) => setParams({ tab: t })} />
        ) : (
          <aside className="profile-menu panel">
            {tabs.map(([key, label, Icon]) => (
              <button
                className={key === tab ? 'active' : ''}
                key={key}
                onClick={() => setParams({ tab: key })}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
            <Link to="/notifications">
              <Bell size={18} />
              消息通知
            </Link>
            {user.role !== 'member' && (
              <Link to="/admin">
                <ShieldCheck size={18} />
                管理后台
              </Link>
            )}
          </aside>
        )}
        <section className="profile-content">
          {tab === 'honors' ? (
            <PersonalHonors
              key={params.get('honor') || 'ledger'}
              initialTab={mobile && params.get('honor') === 'badges' ? 'badges' : 'ledger'}
            />
          ) : tab === 'api' ? (
            <ApiAccess />
          ) : tab === 'settings' ? (
            <div className="settings-stack">
              {user.must_reset && <div className="notice">请设置新密码后继续使用社区。</div>}
              <form
                className="panel"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await send('/auth/profile', { name, bio }, 'PATCH');
                    await refresh();
                    toast('资料已保存');
                  } catch (e: any) {
                    toast(e.message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h2>个人资料</h2>
                <AvatarSettings />
                <Field label="账号">
                  <input value={user.username} disabled />
                </Field>
                <Field label="姓名">
                  <input
                    required
                    value={name}
                    maxLength={50}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field label="个人简介">
                  <textarea
                    maxLength={300}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={3}
                  />
                </Field>
                <p className="form-tip">部门与角色由管理员维护，如需调整请联系管理员。</p>
                <button className="button" disabled={busy}>
                  保存资料
                </button>
              </form>
              <form className="panel" onSubmit={changePassword}>
                <h2>修改密码</h2>
                <Field label="当前密码">
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </Field>
                <Field label="新密码" hint={PASSWORD_HINT + '修改后其他会话失效。'}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                    maxLength={PASSWORD_MAX_LENGTH}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <button className="button" disabled={busy}>
                  更新密码
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="section-heading">
                <h2>{tabs.find((t) => t[0] === tab)?.[1] || '我的内容'}</h2>
                <button className="text-button" onClick={content.reload}>
                  刷新状态
                </button>
              </div>
              {tab === 'downloads' && (
                <p className="notice">
                  这里展示仍有权限访问的下载内容；历史版本可在详情页再次下载。
                </p>
              )}
              {content.loading ? (
                <Loading />
              ) : content.error ? (
                <ErrorState message={content.error} retry={content.reload} />
              ) : !content.data?.items.length ? (
                <Empty
                  title="这里暂时还是空的"
                  action={
                    <Link to="/editor" className="button secondary">
                      开始一次分享
                      <ArrowRight size={16} />
                    </Link>
                  }
                />
              ) : (
                <div className="card-grid profile-grid">
                  {content.data.items.map((i: any) => (
                    <div key={i.id}>
                      <ContentCard item={i} />
                      {i.reason && <p className="review-reason">{i.reason}</p>}
                      {i.author_id === user.id && (
                        <div className="profile-card-actions">
                          <Link
                            className="text-button"
                            to={(i.type === 'discussion' ? '/forum/edit/' : '/editor/') + i.id}
                          >
                            继续编辑 →
                          </Link>
                          {isDeletableDraft(i.state, i.status) && (
                            <DeleteDraftButton
                              id={i.id}
                              revisionId={i.revision_id || null}
                              published={i.state === 'published'}
                              onStale={content.reload}
                              onDeleted={() => {
                                if (content.data.items.length === 1 && page > 1)
                                  setParams({ tab, page: String(page - 1) });
                                else content.reload();
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Pagination
                total={content.data?.total || 0}
                page={page}
                onChange={(p) => setParams({ tab, page: String(p) })}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
export function Notifications() {
  const { toast } = useApp(),
    [page, setPage] = useState(1),
    data = useApi('/notifications?page=' + page);
  return (
    <div className="notifications-page">
      <div className="page-title">
        <span className="eyebrow">STAY CONNECTED</span>
        <h1>消息，把我们连在一起</h1>
        <p>关于讨论、审核与社区的最新动态。</p>
      </div>
      <div className="section-heading">
        <h2>
          全部消息 <span className="count-pill">{data.data?.unread || 0} 未读</span>
        </h2>
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await send('/notifications/read');
              data.reload();
              toast('已全部标为已读');
            } catch (e: any) {
              toast(e.message, true);
            }
          }}
        >
          <CheckCheck size={17} />
          全部已读
        </button>
      </div>
      {data.loading ? (
        <Loading />
      ) : data.error ? (
        <ErrorState message={data.error} retry={data.reload} />
      ) : !data.data?.items.length ? (
        <Empty title="暂时没有新消息" description="参与一次讨论，或分享你的新发现。" />
      ) : (
        <div className="panel notification-list">
          {data.data.items.map((n: any) => (
            <div key={n.id} className={'notification ' + (!n.read_at ? 'unread' : '')}>
              <span className="notification-icon">
                <Bell size={21} />
              </span>
              <div>
                <b>
                  {(
                    {
                      moderation: '审核动态',
                      comment: '新的讨论',
                      withdrawn: '内容通知',
                      announcement: '社区公告',
                      report: '举报处理',
                    } as any
                  )[n.kind] || '社区通知'}
                </b>
                <p>{n.message}</p>
                <time>{date(n.created_at)}</time>
              </div>
              {n.content_id && (
                <Link
                  className="icon-button"
                  aria-label="查看相关内容"
                  to={'/content/' + n.content_id}
                >
                  <ArrowRight size={19} />
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
      <Pagination total={data.data?.total || 0} page={page} onChange={setPage} />
    </div>
  );
}
export function Author() {
  const { id } = useParams(),
    [page, setPage] = useState(1),
    author = useApi('/authors/' + id),
    contents = useApi(`/contents?author=${id}&page=${page}`);
  if (author.error) return <ErrorState message={author.error} />;
  return (
    <div className="author-page">
      <div className="profile-hero">
        <Avatar name={author.data?.name} userId={id} version={author.data?.avatar_version} />
        <div>
          <span className="eyebrow">MEET THE CREATOR</span>
          <h1>{author.data?.name || '共创者'}</h1>
          <p>{author.data?.bio || '在实践中探索，在分享中成长。'}</p>
        </div>
      </div>
      <PublicHonors userId={id!} />
      <h2>TA 的分享</h2>
      {contents.loading ? (
        <Loading />
      ) : contents.error ? (
        <ErrorState message={contents.error} retry={contents.reload} />
      ) : !contents.data?.items.length ? (
        <Empty title="暂无可查看的分享" />
      ) : (
        <div className="card-grid explore-grid">
          {contents.data.items.map((i: any) => (
            <ContentCard key={i.id} item={i} />
          ))}
        </div>
      )}
      <Pagination total={contents.data?.total || 0} page={page} onChange={setPage} />
    </div>
  );
}
