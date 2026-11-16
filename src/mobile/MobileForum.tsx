import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, SlidersHorizontal, CheckCircle2, Pin, LockKeyhole } from 'lucide-react';
import { Avatar, Badge, Empty, ErrorState, Loading, Pagination } from '../components';
import { date } from '../api';
import { MobileSheet } from './MobileSheet';
import { previewText } from './presentation';

type Props = {
  params: URLSearchParams;
  topics: any;
  boards: any;
  resource: any;
  filter: (key: string, value: string) => void;
  onPage: (n: number) => void;
};
const kinds: Record<string, string> = {
  question: '问答',
  discussion: '交流',
  feedback: '建议',
  chat: '闲聊',
};
export default function MobileForum({ params, topics, boards, resource, filter, onPage }: Props) {
  const [filtering, setFiltering] = useState(false);
  const related = params.get('related');
  return (
    <div className="m-forum">
      <nav className="m-discussion-tabs" aria-label="讨论类型">
        {[
          ['', '全部'],
          ['question', '问答'],
          ['discussion', '交流'],
          ['feedback', '建议'],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={key === (params.get('kind') || '')}
            onClick={() => filter('kind', key)}
          >
            {label}
          </button>
        ))}
        <button
          className="m-filter-toggle"
          aria-label="筛选讨论"
          onClick={() => setFiltering(true)}
        >
          <SlidersHorizontal size={18} />
        </button>
      </nav>
      {(related ||
        params.get('q') ||
        params.get('board') ||
        params.get('scope') ||
        params.get('sort') ||
        params.get('resolved') ||
        params.get('kind') === 'chat') && (
        <div className="m-filter-summary">
          <span>
            {related
              ? `关联：${resource.data?.revision?.data.title || '当前内容'}`
              : params.get('q')
                ? `搜索：${params.get('q')}`
                : '已应用筛选'}
          </span>
          <button onClick={() => setFiltering(true)}>调整筛选</button>
        </div>
      )}
      {topics.loading ? (
        <Loading />
      ) : topics.error ? (
        <ErrorState message={topics.error} retry={topics.reload} />
      ) : !topics.data?.items.length ? (
        <Empty
          title="这里还没有话题"
          description=""
          action={
            <Link
              className="button secondary"
              to={'/forum/new' + (related ? '?related=' + related : '')}
            >
              发起讨论
            </Link>
          }
        />
      ) : (
        <div className="m-topic-list">
          {topics.data.items.map((t: any) => (
            <article className="m-topic" key={t.id}>
              <div className="m-topic-author">
                <Link to={'/author/' + t.author_id}>
                  <Avatar name={t.author} userId={t.author_id} version={t.author_avatar_version} />
                </Link>
                <div>
                  <Link to={'/author/' + t.author_id}>{t.author}</Link>
                  <small>
                    {date(t.created_at)} · {t.board}
                  </small>
                </div>
                <span className="m-topic-kind">{kinds[t.kind] || '交流'}</span>
              </div>
              <Link
                className="m-topic-title"
                to={(t.state === 'draft' ? '/forum/edit/' : '/forum/') + t.id}
              >
                {t.pinned && <Pin size={15} aria-label="置顶" />}
                {t.unread && <i className="m-unread-dot" />}
                {t.title || '未命名草稿'}
                {t.locked && <LockKeyhole size={15} aria-label="已锁定" />}
              </Link>
              {t.summary && <p className="m-topic-excerpt">{previewText(t.summary)}</p>}
              {t.resolved && (
                <div className="m-topic-resolved">
                  <CheckCircle2 size={15} />
                  已解决 · 查看采纳回答
                </div>
              )}
              {t.status !== 'approved' && <Badge status={t.status || 'draft'} />}
              <div className="m-topic-footer">
                <span>{t.views || 0} 次阅读</span>
                <Link to={(t.state === 'draft' ? '/forum/edit/' : '/forum/') + t.id}>
                  <MessageCircle size={16} />
                  {t.replies || 0} 条回复
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
      <Pagination
        total={topics.data?.total || 0}
        page={Number(params.get('page') || 1)}
        onChange={onPage}
      />
      {filtering && (
        <MobileSheet title="筛选讨论" close={() => setFiltering(false)}>
          <div className="m-filter-fields">
            <label>
              话题范围
              <select
                aria-label="话题范围"
                value={params.get('scope') || 'all'}
                onChange={(e) => filter('scope', e.target.value)}
              >
                {Object.entries({
                  all: '全部话题',
                  mine: '我的帖子',
                  participated: '我的参与',
                  following: '我的关注',
                }).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              排列顺序
              <select
                aria-label="话题排序"
                value={params.get('sort') || 'active'}
                onChange={(e) => filter('sort', e.target.value)}
              >
                {Object.entries({
                  active: '最新回复',
                  newest: '最新发布',
                  popular: '热门',
                  unanswered: '未回复',
                }).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              话题类型
              <select
                aria-label="话题类型"
                value={params.get('kind') || ''}
                onChange={(e) => filter('kind', e.target.value)}
              >
                <option value="">全部类型</option>
                {Object.entries(kinds).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              版块
              <select
                aria-label="论坛版块"
                value={params.get('board') || ''}
                onChange={(e) => filter('board', e.target.value)}
              >
                <option value="">全部版块</option>
                {boards.data?.items.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              解决状态
              <select
                aria-label="解决状态"
                value={params.get('resolved') || ''}
                onChange={(e) => filter('resolved', e.target.value)}
              >
                <option value="">全部状态</option>
                <option value="0">进行中</option>
                <option value="1">已解决</option>
              </select>
            </label>
            {boards.error && <ErrorState message={boards.error} retry={boards.reload} />}
            {params.get('q') && (
              <button className="m-menu-row" onClick={() => filter('q', '')}>
                清除搜索：{params.get('q')}
              </button>
            )}
            {related && (
              <button className="m-menu-row" onClick={() => filter('related', '')}>
                查看全部关联内容
              </button>
            )}
            <button className="m-primary" onClick={() => setFiltering(false)}>
              完成
            </button>
          </div>
        </MobileSheet>
      )}
    </div>
  );
}
