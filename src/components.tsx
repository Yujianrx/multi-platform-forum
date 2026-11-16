import {
  useState,
  lazy,
  Suspense,
  useId,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Heart,
  Download,
  MessageCircle,
  Code2,
  Sparkles,
  Package,
  Quote,
  SearchX,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from './icons';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkRichText } from './remark-rich-text';
import { typeLabels, statusLabels, date } from './api';
import { isSticker } from './stickers';
import { useMobile } from './mobile/useMobile';
const MobileContentCard = lazy(() => import('./mobile/MobileContentCard'));
export const typeIcons: any = {
  experience: Sparkles,
  project: Code2,
  skill: Package,
  prompt: Quote,
  discussion: MessageCircle,
};
export function Avatar({
  name = '',
  small = false,
  userId,
  version,
}: {
  name?: string;
  small?: boolean;
  userId?: string;
  version?: string | null;
}) {
  const src = userId && version ? '/api/avatars/' + userId + '?v=' + version : '';
  const [failed, setFailed] = useState('');
  const color = ['mint', 'peach', 'lilac', 'blue'][
    [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 4
  ];
  return (
    <span className={`avatar ${small ? 'small' : ''} ${color}`} aria-hidden="true">
      {src && failed !== src ? (
        <img src={src} decoding="async" alt="" onError={() => setFailed(src)} />
      ) : (
        name.slice(-2)
      )}
    </span>
  );
}
export function Badge({ status }: { status: string }) {
  return <span className={`badge status-${status}`}>{statusLabels[status] || status}</span>;
}
export function Empty({
  title = '这里还没有内容',
  description = '分享一个小发现，也可能成为同事的大灵感。',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <SearchX size={30} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="skeleton-grid" role="status" aria-label="正在加载">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="empty error" role="alert">
      <h3>暂时无法显示</h3>
      <p>{message}</p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={16} />
          重试
        </button>
      )}
    </div>
  );
}
export function Pagination({
  total,
  page,
  limit = 12,
  onChange,
}: {
  total: number;
  page: number;
  limit?: number;
  onChange: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="分页">
      <button
        className="icon-button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="上一页"
      >
        <ChevronLeft size={18} />
      </button>
      <span>
        第 {page} / {pages} 页 · 共 {total} 条
      </span>
      <button
        className="icon-button"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
        aria-label="下一页"
      >
        <ChevronRight size={18} />
      </button>
    </nav>
  );
}
export function Artwork({ type, compact = false }: { type: string; compact?: boolean }) {
  const Icon = typeIcons[type] || Sparkles;
  return (
    <div className={`artwork art-${type} ${compact ? 'compact' : ''}`} aria-hidden="true">
      <span className="art-orbit orbit-one" />
      <span className="art-orbit orbit-two" />
      <div className="art-window">
        <div className="window-dots">
          <i />
          <i />
          <i />
        </div>
        <div className="art-symbol">
          <Icon size={compact ? 32 : 48} strokeWidth={1.5} />
        </div>
        <div className="art-lines">
          <i />
          <i />
          <i />
        </div>
      </div>
      <span className="art-sticker">
        {type === 'skill'
          ? 'READY TO USE'
          : type === 'project'
            ? 'BUILD WITH AI'
            : type === 'prompt'
              ? 'BETTER PROMPTS'
              : 'IDEAS IN ACTION'}
      </span>
    </div>
  );
}
export function ContentCard({ item }: { item: any }) {
  const mobile = useMobile();
  if (mobile)
    return (
      <Suspense fallback={null}>
        <MobileContentCard item={item} />
      </Suspense>
    );
  const Icon = typeIcons[item.type] || Sparkles;
  const href =
    item.type === 'discussion'
      ? (item.state === 'published' ? '/forum/' : '/forum/edit/') + item.id
      : (item.state === 'published' ? '/content/' : '/editor/') + item.id;
  return (
    <article className="content-card">
      <Link className="card-cover" to={href} tabIndex={-1} aria-hidden="true">
        {item.cover_id ? (
          <img
            loading="lazy"
            decoding="async"
            src={`/api/files/${item.cover_id}?revision=${item.revision_id}`}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <Artwork type={item.type} />
        )}
        <span className="cover-type">
          <Icon size={13} />
          {typeLabels[item.type]}
        </span>
        {item.featured && <span className="featured-label">精选</span>}
      </Link>
      <div className="card-body">
        <div className="card-tags">
          <span>{item.category}</span>
          {item.tags?.slice(0, 2).map((t: string) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <h3>
          <Link to={href}>{item.title || '未命名草稿'}</Link>
        </h3>
        <p className="card-summary">{item.summary || '继续编辑，让这个想法更完整。'}</p>
        <div className="card-meta">
          <Link to={`/author/${item.author_id}`} className="author">
            <Avatar
              name={item.author}
              small
              userId={item.author_id}
              version={item.author_avatar_version}
            />
            {item.author}
          </Link>
          <time>{date(item.published_at || item.updated_at)}</time>
        </div>
        <div className="card-bottom">
          <span>
            <Heart size={14} />
            {item.likes || 0}
          </span>
          <span>
            <MessageCircle size={14} />
            {item.comments || 0}
          </span>
          {item.has_download && (
            <span>
              <Download size={14} />
              {item.downloads || 0}
            </span>
          )}
          {item.state !== 'published' && <Badge status={item.status || item.state} />}
          <ArrowUpRight className="card-arrow" size={18} />
        </div>
      </div>
    </article>
  );
}
export function MarkdownBody({ children }: { children: string }) {
  return (
    <div className="prose">
      <Markdown
        remarkPlugins={[remarkGfm, remarkRichText]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children} ↗
            </a>
          ),
          img: ({ src, alt }) =>
            typeof src === 'string' &&
            (isSticker(src) || /^\/api\/files\/[0-9a-f-]{36}(\?.*)?$/.test(src)) ? (
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className={isSticker(src) ? 'sticker-link' : 'content-image-link'}
              >
                <img
                  loading="lazy"
                  decoding="async"
                  className={isSticker(src) ? 'sticker-image' : 'content-image'}
                  src={src}
                  alt={alt || '正文图片'}
                />
              </a>
            ) : (
              <span className="muted">[请上传图片到站内]</span>
            ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const uid = useId();
  return (
    <label className="field">
      <span id={uid + '-label'}>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<any>, {
            'aria-labelledby': uid + '-label',
            'aria-describedby': hint ? uid + '-hint' : undefined,
          })
        : children}
      {hint && <small id={uid + '-hint'}>{hint}</small>}
    </label>
  );
}
