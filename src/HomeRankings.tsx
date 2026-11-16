import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from './api';
import { Loading, ErrorState } from './components';
import { Flame, ArrowUpRight } from './icons';

export function HomeRankings() {
  const [metric, setMetric] = useState('likes'),
    [period, setPeriod] = useState('week');
  const ranking = useApi(`/rankings?metric=${metric}&period=${period}&limit=5`);
  return (
    <section className="aside-card ranking-card home-popularity" aria-label="社区人气榜">
      <div className="aside-heading">
        <h3>
          <Flame size={18} />
          社区人气榜
        </h3>
        <Link to={`/rankings?metric=${metric}&period=${period}`} aria-label="完整人气榜">
          <ArrowUpRight size={18} />
        </Link>
      </div>
      <div className="segmented" aria-label="人气榜类型">
        {Object.entries({ likes: '点赞榜', views: '浏览榜' }).map(([key, label]) => (
          <button
            key={key}
            className={metric === key ? 'selected' : ''}
            aria-pressed={metric === key}
            onClick={() => setMetric(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="rank-periods" aria-label="人气榜周期">
        {Object.entries({ week: '近 7 天', month: '近 30 天', all: '累计' }).map(([key, label]) => (
          <button
            key={key}
            className={period === key ? 'active' : ''}
            aria-pressed={period === key}
            onClick={() => setPeriod(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {ranking.loading ? (
        <Loading />
      ) : ranking.error ? (
        <ErrorState message={ranking.error} retry={ranking.reload} />
      ) : !ranking.data?.items.length ? (
        <p className="honor-home-empty">暂无可上榜的内容</p>
      ) : (
        ranking.data.items.map((r: any, index: number) => (
          <Link
            className="rank-item"
            key={r.id}
            to={(r.type === 'discussion' ? '/forum/' : '/content/') + r.id}
          >
            <span className={'rank-number rank-' + index}>
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <h4>{r.title}</h4>
              <div className="rank-meta">
                <small>{r.author}</small>
                <small>
                  {r.score} {metric === 'views' ? '次浏览' : '赞'}
                </small>
              </div>
            </div>
          </Link>
        ))
      )}
      <Link className="text-button ranking-more" to={`/rankings?metric=${metric}&period=${period}`}>
        查看完整{metric === 'likes' ? '点赞榜' : '浏览榜'} →
      </Link>
    </section>
  );
}
