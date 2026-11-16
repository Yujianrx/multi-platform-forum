import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, Flame } from '../icons';
import { useApi, typeLabels } from '../api';
import { ContentCard, Loading, ErrorState, Empty, Pagination } from '../components';
export function Explore({ ranking = false }: { ranking?: boolean }) {
  const [params, setParams] = useSearchParams(),
    [query, setQuery] = useState(params.get('q') || '');
  const tax = useApi('/taxonomy');
  const page = Number(params.get('page') || 1);
  const request = useApi((ranking ? '/rankings?' : '/contents?') + params.toString());
  useEffect(() => setQuery(params.get('q') || ''), [params]);
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }
  return (
    <div className="explore-page">
      <div className="page-title">
        <span className="eyebrow">
          {ranking ? 'COMMUNITY LEADERBOARD' : 'EXPLORE THE POSSIBILITIES'}
        </span>
        <h1>
          {ranking ? (
            <>
              <Flame size={32} />
              社区内容人气榜
            </>
          ) : params.get('type') ? (
            typeLabels[params.get('type')!]
          ) : (
            '探索，让灵感发生'
          )}
        </h1>
        <p>
          {ranking
            ? '真实参与，持续分享。发现团队里备受认可的好内容。'
            : '找到新的工作方式，也找到与你一起探索的人。'}
        </p>
      </div>
      {ranking ? (
        <div className="filter-panel">
          <div className="segmented">
            <button
              className={
                !params.get('metric') || params.get('metric') === 'likes' ? 'selected' : ''
              }
              onClick={() => update('metric', 'likes')}
            >
              点赞榜
            </button>
            <button
              className={params.get('metric') === 'views' ? 'selected' : ''}
              onClick={() => update('metric', 'views')}
            >
              浏览榜
            </button>
            <button
              className={params.get('metric') === 'downloads' ? 'selected' : ''}
              onClick={() => update('metric', 'downloads')}
            >
              下载榜
            </button>
          </div>
          <select
            aria-label="榜单周期"
            value={params.get('period') || 'week'}
            onChange={(e) => update('period', e.target.value)}
          >
            <option value="week">近 7 天</option>
            <option value="month">近 30 天</option>
            <option value="all">累计总榜</option>
          </select>
          <p className="muted">
            {params.get('metric') === 'views'
              ? '浏览按同人同内容每天（北京时间）计一次，不含作者自己。'
              : params.get('metric') === 'downloads'
                ? '下载按同人同内容每天去重，不含作者自己。'
                : '点赞按首次有效事件时间统计，取消点赞后扣除。'}
          </p>
          <Link className="text-button" to="/honors">
            贡献榜 →
          </Link>
        </div>
      ) : (
        <>
          <form
            className="large-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              update('q', query);
            }}
          >
            <Search size={21} />
            <input
              aria-label="搜索内容"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索经验、项目、技能包和提示词…"
            />
            <button className="button">搜索</button>
          </form>
          <div className="filter-panel">
            <div className="type-filters">
              <button
                className={!params.get('type') ? 'selected' : ''}
                onClick={() => update('type', '')}
              >
                全部类型
              </button>
              {Object.entries(typeLabels).map(([key, label]) => (
                <button
                  key={key}
                  className={params.get('type') === key ? 'selected' : ''}
                  onClick={() => update('type', key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="filter-controls">
              <SlidersHorizontal size={17} />
              <select
                aria-label="分类筛选"
                value={params.get('category') || ''}
                onChange={(e) => update('category', e.target.value)}
              >
                <option value="">全部分类</option>
                {tax.data?.categories.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="标签筛选"
                value={params.get('tag') || ''}
                onChange={(e) => update('tag', e.target.value)}
              >
                <option value="">全部标签</option>
                {tax.data?.tags.map((t: any) => (
                  <option key={t.id}>{t.name}</option>
                ))}
              </select>
              <select
                aria-label="内容排序"
                value={params.get('sort') || 'latest'}
                onChange={(e) => update('sort', e.target.value)}
              >
                <option value="latest">最新发布</option>
                <option value="likes">最多点赞</option>
                <option value="downloads">最多下载</option>
              </select>
            </div>
          </div>
        </>
      )}
      <div className="result-heading">
        <h2>
          {params.get('q')
            ? `“${params.get('q')}” 的搜索结果`
            : ranking
              ? '热门内容'
              : '发现好内容'}
        </h2>
        <span>{request.data ? `${request.data.total} 篇内容` : '正在加载'}</span>
      </div>
      {request.loading ? (
        <Loading />
      ) : request.error ? (
        <ErrorState message={request.error} retry={request.reload} />
      ) : !request.data?.items.length ? (
        <Empty title="还没有找到匹配的内容" description="试试其他关键词，或调整分类和类型筛选。" />
      ) : (
        <div className="card-grid explore-grid">
          {request.data.items.map((item: any, index: number) => (
            <div key={item.id}>
              {ranking && (
                <div className="ranking-card-header">
                  <b>#{(page - 1) * 12 + index + 1}</b>
                  <span>
                    {item.score}{' '}
                    {params.get('metric') === 'downloads'
                      ? '次有效下载'
                      : params.get('metric') === 'views'
                        ? '次有效浏览'
                        : '个赞'}
                  </span>
                </div>
              )}
              <ContentCard item={item} />
            </div>
          ))}
        </div>
      )}
      <Pagination
        total={request.data?.total || 0}
        page={page}
        onChange={(p) => update('page', String(p))}
      />
    </div>
  );
}
