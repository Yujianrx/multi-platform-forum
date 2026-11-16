import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, Check } from 'lucide-react';
import { useApi } from '../api';
import { Loading, ErrorState, Empty, Pagination } from '../components';
import { ImageCarousel } from '../ImageCarousel';
import { HonorLeaderboard } from '../Honors';
import MobileContentCard from './MobileContentCard';
import { MobileSheet } from './MobileSheet';

export default function MobileHome() {
  const [params, setParams] = useSearchParams(),
    [filtering, setFiltering] = useState(false);
  const ranking = params.get('channel') === 'ranking',
    type = params.get('type') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = new URLSearchParams({ resources: '1', sort: 'latest', page: String(page) });
  if (type) query.set('type', type);
  if (params.get('category')) query.set('category', params.get('category')!);
  if (params.get('channel') === 'featured') query.set('featured', '1');
  const home = useApi(ranking ? null : '/home'),
    taxonomy = useApi(filtering ? '/taxonomy' : null);
  const content = useApi(ranking ? null : '/contents?' + query);
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }
  if (ranking)
    return (
      <div className="m-home-board">
        <HonorLeaderboard />
      </div>
    );
  return (
    <div className="m-home">
      <nav className="m-type-tabs" aria-label="内容类型">
        {[
          ['', '全部'],
          ['experience', '经验'],
          ['project', '项目'],
          ['skill', '技能包'],
          ['prompt', '提示词'],
        ].map(([key, label]) => (
          <button key={key} aria-pressed={key === type} onClick={() => change('type', key)}>
            {label}
          </button>
        ))}
        <button
          className={'m-filter-toggle' + (params.has('category') ? ' selected' : '')}
          aria-label="筛选分类"
          onClick={() => setFiltering(true)}
        >
          <SlidersHorizontal size={18} />
        </button>
      </nav>
      <div className="m-carousel">
        <ImageCarousel banners={home.data?.banners || []} />
      </div>
      {content.loading ? (
        <Loading />
      ) : content.error ? (
        <ErrorState message={content.error} retry={content.reload} />
      ) : content.data?.items.length ? (
        <div className="m-content-grid">
          {content.data.items.map((item: any) => (
            <MobileContentCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <Empty
          title={params.get('channel') === 'featured' ? '暂时没有精选内容' : '这里还没有内容'}
          description=""
          action={
            <Link className="button secondary" to="/editor">
              分享一个新发现
            </Link>
          }
        />
      )}
      <Pagination
        total={content.data?.total || 0}
        page={page}
        onChange={(n) => {
          change('page', String(n));
          window.scrollTo(0, 0);
        }}
      />
      {filtering && (
        <MobileSheet title="内容分类" close={() => setFiltering(false)}>
          {taxonomy.loading ? (
            <Loading />
          ) : taxonomy.error ? (
            <ErrorState message={taxonomy.error} retry={taxonomy.reload} />
          ) : (
            [{ id: '', name: '全部分类' }, ...(taxonomy.data?.categories || [])].map((c: any) => (
              <button
                key={c.id}
                className="m-menu-row"
                onClick={() => {
                  change('category', c.id);
                  setFiltering(false);
                }}
              >
                {c.name}
                {c.id === (params.get('category') || '') && <Check size={17} />}
              </button>
            ))
          )}
        </MobileSheet>
      )}
    </div>
  );
}
