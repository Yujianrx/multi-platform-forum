import { HomeRankings } from '../HomeRankings';
import { useState, lazy } from 'react';
import { useMobile } from '../mobile/useMobile';
const MobileHome = lazy(() => import('../mobile/MobileHome'));
import { HomeHonors } from '../Honors';
import { ImageCarousel } from '../ImageCarousel';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  Flame,
  ChevronRight,
  Lightbulb,
  Code2,
  ChartNoAxesCombined,
  Palette,
  BriefcaseBusiness,
  Plus,
  BookOpen,
  Package,
  Users,
  Check,
} from '../icons';
import { useApi, typeLabels } from '../api';
import { useApp } from '../context';
import { ContentCard, Loading, ErrorState, Empty } from '../components';
import { ForumPreview } from './Forum';
export function Home() {
  return useMobile() ? <MobileHome /> : <DesktopHome />;
}
function DesktopHome() {
  const { user } = useApp();
  const home = useApi('/home'),
    tax = useApi('/taxonomy'),
    [active, setActive] = useState('');
  const featured = useApi('/contents?resources=1&featured=1&limit=3'),
    latest = useApi('/contents?resources=1&limit=6' + (active ? '&type=' + active : '')),
    resources = useApi('/contents?type=skill&limit=3');
  const icons: Record<string, typeof BriefcaseBusiness> = {
    业务应用: BriefcaseBusiness,
    办公提效: Lightbulb,
    数据分析: ChartNoAxesCombined,
    研发技术: Code2,
    设计创作: Palette,
  };
  return (
    <>
      <div className="page-greeting">
        <span>
          <i className="status-dot" />
          一起把 AI 用得更好
        </span>
        <small>你好，{user.name}。今天有什么新发现？</small>
      </div>
      <ImageCarousel banners={home.data?.banners || []} />
      <div className="community-layout">
        <div className="community-feed">
          <ForumPreview />
          <div className="category-shortcuts">
            {tax.data?.categories?.slice(0, 5).map((c: any, i: number) => {
              const Icon = icons[c.name] || BookOpen;
              return (
                <Link key={c.id} to={'/explore?category=' + c.id}>
                  <span className={`category-icon category-${i}`}>
                    <Icon size={44} />
                  </span>
                  <span>{c.name}</span>
                  <ChevronRight size={16} />
                </Link>
              );
            })}
          </div>

          <section>
            <div className="section-heading">
              <h2>
                <span className="heading-mark orange" />
                值得一看的好分享
              </h2>
              <Link to="/explore">
                探索更多
                <ArrowRight size={16} />
              </Link>
            </div>
            {featured.loading ? (
              <Loading />
            ) : featured.error ? (
              <ErrorState message={featured.error} retry={featured.reload} />
            ) : featured.data?.items.length ? (
              <div className="card-grid">
                {featured.data.items.map((i: any) => (
                  <ContentCard key={i.id} item={i} />
                ))}
              </div>
            ) : (
              <Empty
                title="精选内容，等你入选"
                description="分享你的实践，管理员会推荐有价值的内容。"
              />
            )}
          </section>
          <section className="latest-section">
            <div className="section-heading">
              <h2>
                <span className="heading-mark mint" />
                社区新鲜事
              </h2>
              <Link to="/explore">
                全部内容
                <ArrowRight size={16} />
              </Link>
            </div>
            <div className="feed-tabs">
              <button className={!active ? 'active' : ''} onClick={() => setActive('')}>
                全部动态
              </button>
              {Object.entries(typeLabels)
                .filter(([key]) => key !== 'discussion')
                .map(([key, label]) => (
                  <button
                    key={key}
                    className={active === key ? 'active' : ''}
                    onClick={() => setActive(key)}
                  >
                    {label}
                  </button>
                ))}
            </div>
            {latest.loading ? (
              <Loading />
            ) : latest.error ? (
              <ErrorState message={latest.error} retry={latest.reload} />
            ) : latest.data?.items.length ? (
              <div className="card-grid">
                {latest.data.items.map((i: any) => (
                  <ContentCard key={i.id} item={i} />
                ))}
              </div>
            ) : (
              <Empty />
            )}
            <Link className="more-link" to="/explore">
              发现更多分享
              <ArrowRight size={16} />
            </Link>
          </section>
          <section className="resource-section">
            <div className="section-heading">
              <h2>
                <Package size={21} />
                拿来就用的技能包
              </h2>
              <Link to="/explore?type=project">
                发现开发项目
                <ArrowRight size={16} />
              </Link>
            </div>
            <div className="resource-list">
              {resources.data?.items.map((i: any) => (
                <Link key={i.id} to={'/content/' + i.id}>
                  <span className="resource-icon">
                    <Package size={25} />
                  </span>
                  <div>
                    <b>{i.title}</b>
                    <small>
                      {i.tool || i.category} · v{i.version || '1.0.0'}
                    </small>
                  </div>
                  <ArrowUpRight size={18} />
                </Link>
              ))}
            </div>
            {resources.data && !resources.data.items.length && (
              <Empty title="第一份技能包，等你上传" />
            )}
          </section>
        </div>
        <aside className="community-aside">
          <div className="aside-card invitation-card">
            <span className="invite-spark">
              <Sparkles size={28} />
            </span>
            <h3>好经验，值得被分享</h3>
            <p>一个小技巧、一段提示词、一个新项目，都是团队成长的养分。</p>
            <Link className="button full" to="/editor">
              <Plus size={17} />
              发布我的分享
            </Link>
            <div className="community-stats">
              <div>
                <b>{home.data?.stats.contents ?? '—'}</b>
                <small>篇分享</small>
              </div>
              <div>
                <b>{home.data?.stats.resources ?? '—'}</b>
                <small>份资源</small>
              </div>
              <div>
                <b>{home.data?.stats.authors ?? '—'}</b>
                <small>位共创者</small>
              </div>
            </div>
          </div>
          <HomeHonors />
          <HomeRankings />
          <div className="aside-card guide-card">
            <span className="guide-icon">
              <BookOpen size={24} />
            </span>
            <h3>共创，从这里开始</h3>
            <p>把过程说清楚，把经验留下来。</p>
            <ul>
              <li>
                <Check size={15} />
                分享真实的实践与收获
              </li>
              <li>
                <Check size={15} />
                尊重原创，注明引用来源
              </li>
              <li>
                <Check size={15} />
                留意部门范围与敏感信息
              </li>
            </ul>
            <Link to="/editor">
              写下你的第一篇分享
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="aside-footnote">
            <Users size={18} />
            <span>在一起，让好的想法走得更远。</span>
          </div>
        </aside>
      </div>
    </>
  );
}
