import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from './api';
import { Avatar, Empty, ErrorState, Loading, Pagination } from './components';
import { HONOR_CATEGORIES, HONOR_LEVELS, honorWeek } from '../server/honors-policy';
export function honorDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
const date = honorDate;
export const categoryName = (v: string) =>
  HONOR_CATEGORIES[v as keyof typeof HONOR_CATEGORIES] || v;
export function HonorDialog({
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
    <dialog className="admin-dialog honor-dialog" ref={ref} onCancel={close}>
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={close}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function BadgeDetails({ badge, close }: { badge: any; close: () => void }) {
  return (
    <HonorDialog title={badge.name} close={close}>
      <div className="honor-badge-detail">
        <img src={badge.image} width="144" height="144" alt="" />
        <span className="honor-tag">{badge.mode === 'auto' ? '自动授予' : '人工授予'}</span>
        <p>{badge.condition}</p>
        {badge.awarded_at ? (
          <>
            <p>获得于 {date(badge.awarded_at)}</p>
            {badge.mode === 'manual' && <p>{badge.reason}</p>}
            {badge.needs_review && <p>授予依据已变化，等待管理员复核</p>}
          </>
        ) : (
          <p className="muted">尚未获得</p>
        )}
      </div>
    </HonorDialog>
  );
}
export function HonorStrip({ honors, userId }: { honors: any; userId: string }) {
  const [selected, setSelected] = useState<any>(null);
  if (!honors) return null;
  return (
    <div className="honor-strip">
      <Link className="honor-level" to={'/author/' + userId}>
        Lv.{honors.level.number} {honors.level.name}
      </Link>
      {honors.badges.slice(0, 3).map((b: any) => (
        <button
          className="honor-badge-button"
          key={b.id}
          aria-label={b.name}
          onClick={() => setSelected(b)}
        >
          <img src={b.image} width="28" height="28" loading="lazy" decoding="async" alt={b.name} />
        </button>
      ))}
      {honors.badges.length > 3 && (
        <Link className="text-button" to={'/author/' + userId}>
          +{honors.badges.length - 3}
        </Link>
      )}
      {selected && <BadgeDetails badge={selected} close={() => setSelected(null)} />}
    </div>
  );
}
export function BadgeWall({ profile }: { profile: any }) {
  const [selected, setSelected] = useState<any>(null);
  return (
    <>
      <div className="honor-wall">
        {profile.definitions.map((b: any) => {
          const earned = profile.badges.find((a: any) => a.id === b.id);
          return (
            <button
              className={'honor-badge-tile ' + (earned ? 'earned' : 'locked')}
              key={b.id}
              onClick={() => setSelected({ ...b, ...earned })}
            >
              <img src={b.image} width="104" height="104" loading="lazy" decoding="async" alt="" />
              <b>{b.name}</b>
              <span>{earned ? date(earned.awarded_at) : '尚未获得'}</span>
              <small>
                {b.mode === 'auto' ? '自动授予' : '人工授予'}
                {earned?.needs_review ? ' · 待复核' : ''}
              </small>
            </button>
          );
        })}
      </div>
      {selected && <BadgeDetails badge={selected} close={() => setSelected(null)} />}
    </>
  );
}
function LevelProgress({ profile }: { profile: any }) {
  const l = profile.level;
  return (
    <div className="honor-progress panel">
      <div className="honor-progress-head">
        <div>
          <span className="honor-tag">Lv.{l.number}</span>
          <h2>{l.name}</h2>
        </div>
        <div className="honor-total">
          <strong>{l.total}</strong>
          <span>累计有效积分</span>
        </div>
      </div>
      <progress value={l.progress} max="100" aria-label="等级进度" />
      <p>{l.next ? `距离 ${l.next.name} 还需 ${l.remaining} 分` : '已达最高等级'}</p>
      {profile.weeks && (
        <div className="honor-week-stats">
          {Object.entries(HONOR_CATEGORIES).map(([key, name]) => {
            const week = profile.weeks.find((w: any) => w.category === key);
            return (
              <div key={key}>
                <span>本周{name}</span>
                <b>
                  {week?.points || 0}
                  <small> / 60 分</small>
                </b>
                <small>{week?.counted || 0} / 3 次计分</small>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
export function HonorRules() {
  const rules = useApi('/honors/rules');
  return (
    <div className="panel honor-rules">
      <h3>贡献规则</h3>
      <p>积分仅用于社区等级和荣誉。每类贡献每次 20 分，每人每周最多 3 次，三类合计最多 180 分。</p>
      <ul>
        <li>案例：原创、实用，包含实际问题、做法和结果。</li>
        <li>资源：项目或技能包说明完整，链接或文件可用。独立提示词暂不计分。</li>
        <li>答疑：审核通过，由提问者本人采纳；自问自答、版主代采纳不计分。</li>
        <li>免审账号可直接发布，贡献资格确认后计分。签到、浏览、点赞及重复搬运不加分。</li>
        <li>首次满足条件时归周；超额不顺延。同周贡献失效后按首次有效时间补位，恢复仍归原周。</li>
        <li>删除、下架、撤销采纳或资格失效会撤回积分；流水保留，等级与关联勋章重新计算。</li>
      </ul>
      <h3>等级门槛</h3>
      <div className="honor-levels">
        {HONOR_LEVELS.map((l, i) => (
          <div key={l.name}>
            <b>
              Lv.{i + 1} {l.name}
            </b>
            <span>{l.points} 分</span>
          </div>
        ))}
      </div>
      <p>
        北京时间周一 00:00 至下周一 00:00；周榜重置，累计积分保留。同分并列，如
        1、1、3。历史榜如有撤回或补位会保留更正版本。
      </p>
      <p>持续共创者按历史任意连续四周认定；之后断周不撤销，基础贡献失效则重新校验。</p>
      {rules.data && (
        <small>
          规则第 {rules.data.version} 版 · {date(rules.data.enabledAt)} 启用 · 旧内容不自动补分
        </small>
      )}
    </div>
  );
}
export function PersonalHonors() {
  const [tab, setTab] = useState('ledger'),
    [page, setPage] = useState(1),
    [category, setCategory] = useState(''),
    [kind, setKind] = useState('');
  const profile = useApi('/honors/me'),
    list = useApi(
      tab === 'ledger'
        ? `/honors/ledger?page=${page}${category ? '&category=' + category : ''}${kind ? '&kind=' + kind : ''}`
        : tab === 'contributions'
          ? `/honors/contributions?page=${page}`
          : null,
    );
  if (profile.loading) return <Loading />;
  if (profile.error) return <ErrorState message={profile.error} retry={profile.reload} />;
  if (!profile.data) return null;
  return (
    <div className="honor-personal">
      <LevelProgress profile={profile.data} />
      <div className="honor-tabs" role="tablist" aria-label="我的贡献">
        {[
          ['ledger', '积分明细'],
          ['contributions', '贡献记录'],
          ['badges', '勋章墙'],
          ['rules', '规则'],
        ].map(([k, n]) => (
          <button
            role="tab"
            aria-selected={k === tab}
            className={k === tab ? 'active' : ''}
            onClick={() => {
              setTab(k);
              setPage(1);
            }}
            key={k}
          >
            {n}
          </button>
        ))}
      </div>
      {tab === 'badges' ? (
        <div className="panel">
          <BadgeWall profile={profile.data} />
          {profile.data.history.some((b: any) => b.revoked_at) && (
            <details className="honor-history">
              <summary>获得与撤回记录</summary>
              {profile.data.history.map((b: any) => (
                <p key={b.id}>
                  {b.name} · {date(b.awarded_at)} 获得
                  {b.revoked_at ? ` · ${date(b.revoked_at)} 撤回：${b.revoke_reason}` : ''}
                </p>
              ))}
            </details>
          )}
        </div>
      ) : tab === 'rules' ? (
        <HonorRules />
      ) : (
        <>
          <div className="honor-filters">
            {tab === 'ledger' && (
              <>
                <select
                  aria-label="积分类别"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部类别</option>
                  {Object.entries(HONOR_CATEGORIES).map(([k, n]) => (
                    <option key={k} value={k}>
                      {n}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="积分变动"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部变动</option>
                  <option value="grant">发放与恢复</option>
                  <option value="revoke">撤回</option>
                </select>
              </>
            )}
            <Link className="text-button" to="/honors">
              查看周榜 →
            </Link>
          </div>
          {list.loading ? (
            <Loading />
          ) : list.error ? (
            <ErrorState message={list.error} retry={list.reload} />
          ) : !list.data?.items.length ? (
            <Empty title={tab === 'ledger' ? '暂无积分记录' : '暂无贡献记录'} />
          ) : (
            <div className="panel honor-records">
              {list.data.items.map((r: any) => (
                <article key={r.id}>
                  <div>
                    <span className="honor-tag">{categoryName(r.category)}</span>
                    {r.content_id ? (
                      <Link to={'/content/' + r.content_id}>{r.title || '查看贡献来源'}</Link>
                    ) : (
                      <b>来源已移除或不可查看</b>
                    )}
                    <p>{r.valid && !r.points ? '本周该类已达计分上限' : r.reason}</p>
                    <small>
                      {date(r.created_at || r.first_valid_at)}
                      {r.week ? ` · 归属 ${r.week} 当周` : ''}
                    </small>
                  </div>
                  <strong className={r.delta < 0 ? 'honor-negative' : 'honor-score'}>
                    {tab === 'ledger' ? (r.delta > 0 ? '+' : '') + r.delta : r.points + ' 分'}
                  </strong>
                </article>
              ))}
            </div>
          )}
          <Pagination total={list.data?.total || 0} page={page} onChange={setPage} />
        </>
      )}
    </div>
  );
}
export function PublicHonors({ userId }: { userId: string }) {
  const p = useApi('/honors/users/' + userId);
  return p.data ? (
    <section className="honor-public">
      <LevelProgress profile={p.data} />
      <div className="panel">
        <h2>勋章墙</h2>
        <BadgeWall profile={p.data} />
      </div>
    </section>
  ) : p.error ? (
    <ErrorState message={p.error} />
  ) : (
    <Loading />
  );
}
export function HonorLeaderboard() {
  const [params, setParams] = useSearchParams(),
    week = params.get('week') || honorWeek(),
    board = params.get('board') || 'all',
    page = Number(params.get('page') || 1),
    version = params.get('version') || '';
  const p = useApi(
    `/honors/board?week=${week}&board=${board}&page=${page}${version ? '&version=' + version : ''}`,
  );
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    next.delete('page');
    if (key === 'week') next.delete('version');
    setParams(next);
  }
  return (
    <div className="honor-board-page">
      <div className="page-intro">
        <h1>社区贡献榜</h1>
        <p>每一次有用的分享，都值得被看见。</p>
      </div>
      <div className="honor-filters">
        <select aria-label="榜单周次" value={week} onChange={(e) => change('week', e.target.value)}>
          {[honorWeek(), ...(p.data?.periods || []).map((w: any) => w.week)]
            .filter((w, i, a) => a.indexOf(w) === i)
            .map((w) => (
              <option key={w} value={w}>
                {w} 当周{w === honorWeek() ? '（本周）' : ''}
              </option>
            ))}
        </select>
        {p.data?.versions.length > 1 && (
          <select
            aria-label="历史榜单版本"
            value={version}
            onChange={(e) => change('version', e.target.value)}
          >
            <option value="">最新更正版本</option>
            {p.data.versions.map((v: any) => (
              <option value={v.version} key={v.version}>
                第 {v.version} 版 · {date(v.created_at)}
              </option>
            ))}
          </select>
        )}
        <Link className="text-button" to="/rankings">
          内容人气榜 →
        </Link>
      </div>
      <div className="honor-tabs" role="tablist" aria-label="贡献榜分类">
        {[['all', '综合'], ...Object.entries(HONOR_CATEGORIES)].map(([k, n]) => (
          <button
            role="tab"
            aria-selected={k === board}
            className={k === board ? 'active' : ''}
            key={k}
            onClick={() => change('board', k)}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="honor-board-note">
        北京时间 {week} 00:00 — {p.data?.nextWeek || '下周一'} 00:00。同分并列，积分不清零。
        {p.data?.correctedAt ? ' 已更正：' + date(p.data.correctedAt) : ''}
      </p>
      {p.loading ? (
        <Loading />
      ) : p.error ? (
        <ErrorState message={p.error} retry={p.reload} />
      ) : (
        <>
          <div className="honor-my-rank panel">
            {p.data?.myRank ? (
              <>
                我的本周排名 <b>第 {p.data.myRank.rank} 名</b>
                <span>{p.data.myRank.points} 分</span>
              </>
            ) : (
              <span>本周尚未上榜</span>
            )}
          </div>
          {!p.data?.items.length ? (
            <Empty title="本周还没有有效贡献" />
          ) : (
            <div className="panel honor-board-list">
              {p.data.items.map((r: any) => (
                <Link to={'/author/' + r.user_id} className="honor-rank-row" key={r.user_id}>
                  <strong className="honor-rank">{r.rank}</strong>
                  <Avatar name={r.name} userId={r.user_id} version={r.avatar_version} />
                  <b>{r.name}</b>
                  <strong className="honor-score">
                    {r.points}
                    <small> 分</small>
                  </strong>
                </Link>
              ))}
            </div>
          )}
          <Pagination
            total={p.data?.total || 0}
            page={page}
            onChange={(n) => {
              const q = new URLSearchParams(params);
              q.set('page', String(n));
              setParams(q);
            }}
          />
        </>
      )}
      <details className="honor-rule-details">
        <summary>计分与排名规则</summary>
        <HonorRules />
      </details>
    </div>
  );
}
export function HomeHonors() {
  const [board, setBoard] = useState('all'),
    p = useApi('/honors/board?limit=5&board=' + board);
  return (
    <div className="aside-card ranking-card">
      <div className="section-title">
        <h3>本周贡献榜</h3>
        <Link to="/honors" aria-label="完整贡献榜">
          ↗
        </Link>
      </div>
      <div className="honor-home-tabs">
        {[['all', '综合'], ...Object.entries(HONOR_CATEGORIES)].map(([k, n]) => (
          <button className={board === k ? 'active' : ''} key={k} onClick={() => setBoard(k)}>
            {n}
          </button>
        ))}
      </div>
      {p.loading ? (
        <Loading />
      ) : p.error ? (
        <ErrorState message={p.error} retry={p.reload} />
      ) : !p.data?.items.length ? (
        <p className="honor-home-empty">本周还没有有效贡献</p>
      ) : (
        p.data.items.map((r: any) => (
          <Link className="rank-item" key={r.user_id} to={'/author/' + r.user_id}>
            <span className="rank-number">{r.rank}</span>
            <div>
              <h4>{r.name}</h4>
              <small>{r.points} 分</small>
            </div>
          </Link>
        ))
      )}
      <Link className="text-button" to="/me?tab=honors">
        我的贡献 →
      </Link>
    </div>
  );
}
