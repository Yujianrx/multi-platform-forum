import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { Avatar, Badge } from '../components';
import { typeLabels } from '../api';
import { previewText } from './presentation';

export default function MobileContentCard({ item }: { item: any }) {
  const [failed, setFailed] = useState('');
  const href =
    (item.type === 'discussion'
      ? item.state === 'published'
        ? '/forum/'
        : '/forum/edit/'
      : item.state === 'published'
        ? '/content/'
        : '/editor/') + item.id;
  const cover = item.cover_id ? `/api/files/${item.cover_id}?revision=${item.revision_id}` : '';
  const hasCover = cover && cover !== failed;
  return (
    <article className={'m-content-card m-card-' + item.type}>
      <Link to={href} className="m-card-open">
        {hasCover ? (
          <img
            className="m-card-cover"
            src={cover}
            loading="lazy"
            decoding="async"
            alt=""
            onError={() => setFailed(cover)}
          />
        ) : (
          <div className="m-text-cover">
            <span>{typeLabels[item.type]}</span>
            <h3>{item.title || '未命名草稿'}</h3>
            <small>{item.category}</small>
          </div>
        )}
        {hasCover ? (
          <h3 className="m-card-title">{item.title || '未命名草稿'}</h3>
        ) : (
          <p className="m-card-summary">{previewText(item.summary)}</p>
        )}
      </Link>
      <div className="m-card-meta">
        <Link to={'/author/' + item.author_id} className="m-card-author">
          <Avatar
            small
            name={item.author}
            userId={item.author_id}
            version={item.author_avatar_version}
          />
          <span>{item.author}</span>
        </Link>
        <span className="m-card-likes" aria-label={`${item.likes || 0} 个赞`}>
          <Heart size={14} />
          {item.likes || 0}
        </span>
      </div>
      {(item.state !== 'published' || item.featured) && (
        <div className="m-card-status">
          {item.state !== 'published' ? (
            <Badge status={item.status || item.state} />
          ) : (
            <span>精选</span>
          )}
        </div>
      )}
    </article>
  );
}
