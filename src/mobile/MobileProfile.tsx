import { Link } from 'react-router-dom';
import { Building2, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useApi } from '../api';
import { useApp } from '../context';
import { Avatar, ErrorState, Loading } from '../components';
import { BadgeDetails } from '../Honors';
import { useState } from 'react';

export function MobileProfileHeader() {
  const { user } = useApp(),
    honors = useApi('/honors/me'),
    tax = useApi('/taxonomy');
  const [badge, setBadge] = useState<any>(null);
  const department = tax.data?.departments.find((d: any) => d.id === user.department_id)?.name;
  const level = honors.data?.level;
  return (
    <div className="m-profile-summary">
      <div className="m-profile-person">
        <Avatar name={user.name} userId={user.id} version={user.avatar_version} />
        <div>
          <h1>{user.name}</h1>
          {department && (
            <span>
              <Building2 size={14} />
              {department}
            </span>
          )}
        </div>
      </div>
      {user.bio && <p className="m-profile-bio">{user.bio}</p>}
      <div className="m-profile-links">
        <Link to="/me?tab=review">等待审核</Link>
        <Link to="/me?tab=rejected">被退回</Link>
        <Link className="m-edit-profile" to="/me?tab=settings">
          编辑资料
        </Link>
      </div>
      {honors.loading ? (
        <Loading />
      ) : honors.error ? (
        <ErrorState message={honors.error} retry={honors.reload} />
      ) : (
        level && (
          <>
            <Link className="m-level-card" to="/me?tab=honors">
              <div>
                <span>
                  <em>Lv.{level.number}</em>
                  {level.name}
                </span>
                <strong>
                  {level.total}
                  <small>积分</small>
                </strong>
              </div>
              <progress aria-label="等级进度" value={level.progress} max="100" />
              <p>
                {level.next ? `距「${level.next.name}」还需 ${level.remaining} 分` : '已达最高等级'}
                <ChevronRight size={13} />
              </p>
            </Link>
            <div className="m-badge-strip">
              {honors.data.badges.slice(0, 4).map((b: any) => (
                <button key={b.id} aria-label={b.name} onClick={() => setBadge(b)}>
                  <img
                    src={b.image}
                    alt={b.name}
                    width="44"
                    height="44"
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              ))}
              {!honors.data.badges.length && <span>还没有获得勋章</span>}
              <Link to="/me?tab=honors&honor=badges">
                勋章墙
                <ChevronRight size={13} />
              </Link>
            </div>
          </>
        )
      )}
      {badge && <BadgeDetails badge={badge} close={() => setBadge(null)} />}
    </div>
  );
}

export function MobileProfileTabs({ tab, change }: { tab: string; change: (tab: string) => void }) {
  return (
    <nav className="m-profile-tabs" aria-label="我的内容">
      {[
        ['published', '发布'],
        ['draft', '草稿'],
        ['bookmarks', '收藏'],
        ['downloads', '下载'],
      ].map(([key, label]) => (
        <button key={key} aria-pressed={tab === key} onClick={() => change(key)}>
          {label}
        </button>
      ))}
      <Link className="m-icon" to="/me?tab=menu" aria-label="更多个人功能">
        <MoreHorizontal size={20} />
      </Link>
    </nav>
  );
}
