import { useEffect, useState, useRef } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  Blocks,
  House,
  Menu,
  MessagesSquare,
  NotebookPen,
  PackageOpen,
  Plus,
  Search,
  Settings,
  TextCursorInput,
  UserRound,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { BrandIdentity } from '../BrandIdentity';
import { useApp } from '../context';
import { MobileSheet } from './MobileSheet';
import { HOME_REFRESH_EVENT } from './MobileRefresh';

export function MobileHeader() {
  const { site } = useApp(),
    location = useLocation(),
    navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [searching, setSearching] = useState(false),
    [query, setQuery] = useState('');
  const home = location.pathname === '/',
    mine = location.pathname === '/me';
  const titles: Record<string, string> = {
    '/forum': '讨论',
    '/notifications': '消息',
    '/explore': '搜索与发现',
    '/honors': '社区贡献榜',
    '/rankings': '社区人气榜',
    '/admin': '管理工作台',
  };
  const title = mine
    ? params.get('tab') === 'settings'
      ? '资料与密码'
      : ''
    : titles[location.pathname] ||
      (location.pathname.startsWith('/editor') ||
      location.pathname.startsWith('/forum/edit') ||
      location.pathname === '/forum/new'
        ? '发布内容'
        : '内容详情');
  useEffect(() => setSearching(false), [location.pathname, location.search]);
  return (
    <>
      <header className="site-header m-header">
        {home ? (
          <>
            <Link to="/" className="m-brand" aria-label={site.name}>
              <BrandIdentity site={site} />
            </Link>
            <nav className="m-channel-tabs" aria-label="首页频道">
              {[
                ['latest', '最新'],
                ['featured', '精选'],
                ['ranking', '榜单'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={(params.get('channel') || 'latest') === value}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set('channel', value);
                    next.delete('page');
                    setParams(next);
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
          </>
        ) : mine && !title ? (
          <Link className="m-icon" to="/me?tab=menu" aria-label="个人菜单">
            <Menu />
          </Link>
        ) : (
          <div className="m-header-title">
            {!['/forum', '/notifications'].includes(location.pathname) && (
              <button
                className="m-icon"
                aria-label="返回"
                onClick={() =>
                  navigate(mine ? '/me' : location.pathname.startsWith('/forum/') ? '/forum' : '/')
                }
              >
                <ArrowLeft />
              </button>
            )}
            <h1>{title}</h1>
          </div>
        )}
        <div className="m-header-actions">
          <button
            className="m-icon"
            aria-label={location.pathname === '/forum' ? '搜索讨论' : '搜索内容'}
            onClick={() => {
              setQuery(params.get('q') || '');
              setSearching(true);
            }}
          >
            <Search />
          </button>
          {mine && !title && (
            <Link className="m-icon" to="/me?tab=settings" aria-label="设置">
              <Settings />
            </Link>
          )}
        </div>
      </header>
      {searching && (
        <MobileSheet
          title={location.pathname === '/forum' ? '搜索讨论' : '搜索内容'}
          close={() => setSearching(false)}
        >
          <form
            className="m-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(
                (location.pathname === '/forum' ? '/forum' : '/explore') +
                  '?q=' +
                  encodeURIComponent(query.trim()),
              );
              setSearching(false);
            }}
          >
            <input
              autoFocus
              aria-label="搜索关键词"
              maxLength={100}
              placeholder="搜索经验、项目和讨论"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="m-primary" type="submit">
              搜索
            </button>
          </form>
        </MobileSheet>
      )}
    </>
  );
}

export function MobileNavigation({
  unread,
  logout,
}: {
  unread: number;
  logout: () => Promise<void>;
}) {
  const lastHomeTap = useRef(0);
  const [publishing, setPublishing] = useState(false),
    location = useLocation(),
    [params] = useSearchParams();
  const { user } = useApp();
  useEffect(() => setPublishing(false), [location.pathname, location.search]);
  return (
    <>
      <nav className="m-bottom-nav" aria-label="手机导航">
        <NavLink
          to="/"
          end
          onClick={(event) => {
            const now = performance.now();
            if (location.pathname === '/') {
              event.preventDefault();
              if (lastHomeTap.current && now - lastHomeTap.current < 500) {
                lastHomeTap.current = 0;
                window.dispatchEvent(new Event(HOME_REFRESH_EVENT));
                return;
              }
            }
            lastHomeTap.current = now;
          }}
        >
          <House />
          <span>首页</span>
        </NavLink>
        <NavLink to="/forum">
          <MessagesSquare />
          <span>讨论</span>
        </NavLink>
        <button className="m-publish" aria-label="选择发布类型" onClick={() => setPublishing(true)}>
          <span>
            <Plus />
          </span>
        </button>
        <NavLink to="/notifications">
          <span className="m-notification-icon">
            <Bell />
            {unread > 0 && <i aria-label={`${unread} 条未读`} />}
          </span>
          <span>消息</span>
        </NavLink>
        <NavLink to="/me">
          <UserRound />
          <span>我的</span>
        </NavLink>
      </nav>
      {publishing && (
        <MobileSheet title="想分享点什么？" close={() => setPublishing(false)}>
          <div className="m-publish-types">
            {[
              ['experience', '经验', NotebookPen],
              ['project', '项目', Blocks],
              ['skill', '技能包', PackageOpen],
              ['prompt', '提示词', TextCursorInput],
              ['discussion', '讨论', MessagesSquare],
            ].map(([type, label, Icon]: any) => (
              <Link
                key={type}
                to={type === 'discussion' ? '/forum/new' : '/editor?type=' + type}
                onClick={() => setPublishing(false)}
              >
                <span>
                  <Icon size={25} />
                </span>
                {label}
              </Link>
            ))}
          </div>
        </MobileSheet>
      )}
      {location.pathname === '/me' && params.get('tab') === 'menu' && (
        <MobileMenu logout={logout} admin={user.role !== 'member'} />
      )}
    </>
  );
}

function MobileMenu({ logout, admin }: { logout: () => Promise<void>; admin: boolean }) {
  const navigate = useNavigate();
  return (
    <MobileSheet title="我的社区" close={() => navigate('/me', { replace: true })}>
      {[
        ['all', '全部内容'],
        ['review', '等待审核'],
        ['rejected', '被退回'],
        ['honors', '积分与勋章'],
        ['settings', '资料与密码'],
        ['api', 'AI 接入'],
      ].map(([key, label]) => (
        <Link className="m-menu-row" to={'/me?tab=' + key} key={key}>
          {label}
          <ChevronRight size={16} />
        </Link>
      ))}
      {admin && (
        <Link className="m-menu-row" to="/admin">
          管理后台
          <ChevronRight size={16} />
        </Link>
      )}
      <button className="m-menu-row" onClick={() => void logout()}>
        退出登录
        <LogOut size={17} />
      </button>
    </MobileSheet>
  );
}
