import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  Component,
  Suspense,
  lazy,
  type ReactNode,
} from 'react';
import { useMobile } from './mobile/useMobile';
import { Link, NavLink, Route, Routes, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Sparkles, Search, Plus, Bell, LogOut, ShieldCheck, CheckCircle2, X } from './icons';
import { api, send, setCsrf, type User } from './api';
import { BrandIdentity } from './BrandIdentity';
import { AppContext } from './context';
import { Avatar, Loading, ErrorState } from './components';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Explore } from './pages/Explore';
import { Editor } from './pages/Editor';
import { Detail } from './pages/Detail';
import { Profile, Notifications, Author } from './pages/Profile';
import { Forum, ForumEditor, ForumTopic } from './pages/Forum';
import { HonorLeaderboard } from './Honors';
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const WechatBinding = lazy(() => import('./pages/WechatBinding'));
const MobileHeader = lazy(() =>
  import('./mobile/MobileShell').then((m) => ({ default: m.MobileHeader })),
);
const MobileNavigation = lazy(() =>
  import('./mobile/MobileShell').then((m) => ({ default: m.MobileNavigation })),
);
class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <ErrorState message="页面遇到问题，请刷新重试" retry={() => window.location.reload()} />
    ) : (
      <Suspense fallback={<Loading />}>{this.props.children}</Suspense>
    );
  }
}
export default function App() {
  const mobile = useMobile();
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('mobile-app', mobile);
    return () => document.documentElement.classList.remove('mobile-app');
  }, [mobile]);
  const [user, setUser] = useState<User | null>(null),
    [site, setSite] = useState<any>({ name: '小鱼号AI共创社区' }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null),
    [query, setQuery] = useState(''),
    [unread, setUnread] = useState(0);
  const navigate = useNavigate(),
    location = useLocation();
  const refresh = useCallback(async () => {
    const info = await api('/public');
    setSite(info);
    try {
      const session = await api('/auth/me');
      setUser(session.user);
      setCsrf(session.csrf);
    } catch (e: any) {
      if (e.status !== 401) throw e;
      setUser(null);
    }
  }, []);
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    const expired = () => {
      setUser(null);
      setCsrf('');
    };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, [refresh]);
  useEffect(() => {
    document.title = site.name || '小鱼号AI共创社区';
  }, [site]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const check = () =>
      api('/notifications?limit=1')
        .then((r) => {
          if (active) setUnread(r.unread);
        })
        .catch(() => {});
    check();
    const interval = setInterval(check, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [user, location.pathname]);
  const toast = useCallback((message: string, error = false) => setNotice({ message, error }), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  if (loading)
    return (
      <main className="app-loading">
        <Sparkles />
        <p>正在打开共创空间…</p>
      </main>
    );
  if (error) return <ErrorState message={error} retry={() => window.location.reload()} />;
  if (!user)
    return (
      <Login
        site={site}
        onLogin={async () => {
          await refresh();
          if (location.pathname !== '/wechat') navigate('/');
        }}
      />
    );
  return (
    <AppContext.Provider value={{ user, site, refresh, toast }}>
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      {mobile ? (
        <Suspense fallback={null}>
          <MobileHeader />
        </Suspense>
      ) : (
        <header className="site-header">
          <div className="header-inner">
            <Link to="/" className="brand site-brand">
              <BrandIdentity site={site} />
            </Link>
            <nav className="desktop-nav" aria-label="主导航">
              <NavLink to="/" end>
                首页
              </NavLink>
              <NavLink to="/forum">讨论区</NavLink>
              {[
                ['experience', '经验分享'],
                ['project', '开发项目'],
                ['skill', '技能包'],
                ['prompt', '提示词'],
              ].map(([type, title]) => {
                const selected =
                  location.pathname === '/explore' &&
                  new URLSearchParams(location.search).get('type') === type;
                return (
                  <Link
                    key={type}
                    to={'/explore?type=' + type}
                    className={selected ? 'active' : ''}
                    aria-current={selected ? 'page' : undefined}
                  >
                    {title}
                  </Link>
                );
              })}
            </nav>
            <form
              className="header-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate('/explore?q=' + encodeURIComponent(query));
              }}
            >
              <Search size={17} />
              <input
                aria-label="全站搜索"
                placeholder="发现好灵感…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>↵</kbd>
            </form>
            <Link className="button publish" to="/editor">
              <Plus size={17} />
              发布
            </Link>
            <Link
              className="icon-button notification-button"
              to="/notifications"
              aria-label={`消息，${unread} 条未读`}
            >
              <Bell size={20} />
              {unread > 0 && <i />}
            </Link>
            <Link className="profile-link" to="/me" aria-label="个人中心">
              <Avatar name={user.name} userId={user.id} version={user.avatar_version} />
            </Link>
          </div>
        </header>
      )}
      <main id="main" className="main-shell">
        <Boundary key={location.pathname}>
          <Routes>
            <Route
              path="/"
              element={user.must_reset ? <Navigate to="/me?tab=settings" /> : <Home />}
            />
            <Route path="/explore" element={<Explore />} />
            <Route path="/forum" element={<Forum />} />
            <Route path="/forum/new" element={<ForumEditor />} />
            <Route path="/forum/edit/:id" element={<ForumEditor />} />
            <Route path="/forum/:id" element={<ForumTopic />} />
            <Route path="/rankings" element={<Explore ranking />} />
            <Route path="/honors" element={<HonorLeaderboard />} />
            <Route path="/editor/:id?" element={<Editor />} />
            <Route path="/content/:id" element={<Detail />} />
            <Route path="/me" element={<Profile />} />
            <Route path="/wechat" element={user.must_reset ? <Navigate to="/me?tab=settings" /> : <WechatBinding />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/author/:id" element={<Author />} />
            <Route
              path="/admin"
              element={
                user.role !== 'member' ? <Admin /> : <ErrorState message="你没有管理后台访问权限" />
              }
            />
            <Route path="*" element={<ErrorState message="页面不存在" />} />
          </Routes>
        </Boundary>
      </main>
      {!mobile && (
        <footer className="site-footer">
          <span>
            <Sparkles size={15} />
            {site.name} · 每一份分享，都让我们更进一步。
          </span>
          <div>
            {site.development && <span className="dev-pill">开发环境 · 示例内容</span>}
            {user.role !== 'member' && (
              <Link to="/admin">
                <ShieldCheck size={14} />
                管理后台
              </Link>
            )}
            <button
              onClick={async () => {
                try {
                  await send('/auth/logout');
                  setUser(null);
                  setCsrf('');
                } catch (e: any) {
                  toast(e.message, true);
                }
              }}
            >
              <LogOut size={14} />
              退出登录
            </button>
          </div>
        </footer>
      )}
      {mobile && (
        <Suspense fallback={null}>
          <MobileNavigation
            unread={unread}
            logout={async () => {
              try {
                await send('/auth/logout');
                setUser(null);
                setCsrf('');
              } catch (e: any) {
                toast(e.message, true);
              }
            }}
          />
        </Suspense>
      )}
      {notice && (
        <div
          className={`toast ${notice.error ? 'error' : ''}`}
          role={notice.error ? 'alert' : 'status'}
        >
          <CheckCircle2 size={19} />
          {notice.message}
          <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
