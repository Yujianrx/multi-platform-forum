import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from './icons';
import { brandAssets } from './brand-assets';

export type CarouselBanner = {
  id: string;
  title: string;
  description?: string;
  type?: string;
  content_id?: string | null;
  external_url?: string | null;
  image_id?: string | null;
  href?: string;
};
const defaults: CarouselBanner[] = [
  {
    id: 'experience',
    type: 'experience',
    title: '把 AI 用进日常，把好经验分享出来。',
    description: '分享真实实践，让每一个好方法被更多人看见。',
    href: '/explore?type=experience',
  },
  {
    id: 'project',
    type: 'project',
    title: '让好想法，长成好项目。',
    description: '从一个灵感开始，和同事一起把它变成现实。',
    href: '/explore?type=project',
  },
  {
    id: 'skill',
    type: 'skill',
    title: '少一点重复，多一点创造。',
    description: '发现即拿即用的技能包与提示词，让工作更轻松。',
    href: '/explore?type=skill',
  },
];
function artwork(banner: CarouselBanner) {
  return brandAssets.banners[
    banner.type === 'project'
      ? 'projects'
      : ['skill', 'prompt'].includes(banner.type || '')
        ? 'skills'
        : 'experience'
  ];
}
function BannerImage({ banner }: { banner: CarouselBanner }) {
  const [failed, setFailed] = useState(false);
  return (
    <img
      className="carousel-image"
      src={!failed && banner.image_id ? `/api/files/${banner.image_id}` : artwork(banner).src}
      srcSet={
        !failed && banner.image_id
          ? undefined
          : `${artwork(banner).small} 1086w, ${artwork(banner).src} 2172w`
      }
      sizes="(max-width: 760px) 100vw, (max-width: 1500px) 90vw, 1400px"
      width={2172}
      height={724}
      decoding="async"
      alt=""
      fetchPriority="high"
      onError={() => setFailed(true)}
    />
  );
}
export function ImageCarousel({ banners }: { banners: CarouselBanner[] }) {
  const slides = banners.length ? banners : defaults;
  const [slide, setSlide] = useState(0),
    [paused, setPaused] = useState(false),
    [hovered, setHovered] = useState(false);
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [hidden, setHidden] = useState(document.hidden);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const current = slide % slides.length,
    banner = slides[current];
  const running = slides.length > 1 && !paused && !hovered && !reduced && !hidden;
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(preference.matches),
      visibility = () => setHidden(document.hidden);
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSlide((s) => (s + 1) % slides.length), 6500);
    return () => window.clearInterval(timer);
  }, [running, slides.length]);
  useEffect(() => {
    const next = slides[(current + 1) % slides.length];
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    ).connection;
    if (
      slides.length < 2 ||
      hidden ||
      connection?.saveData ||
      connection?.effectiveType?.includes('2g')
    )
      return;
    const timer = window.setTimeout(() => {
      const image = new Image();
      image.fetchPriority = 'low';
      image.decoding = 'async';
      if (!next.image_id) {
        image.sizes = '(max-width: 760px) 100vw, (max-width: 1500px) 90vw, 1400px';
        image.srcset = `${artwork(next).small} 1086w, ${artwork(next).src} 2172w`;
      }
      image.src = next.image_id ? `/api/files/${next.image_id}` : artwork(next).src;
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [current, slides, hidden]);
  function select(index: number) {
    setSlide((index + slides.length) % slides.length);
    setPaused(true);
  }
  const href = banner.content_id
    ? '/content/' + banner.content_id
    : banner.external_url || banner.href || '/explore';
  const action = (
    <>
      发现灵感 <ArrowUpRight size={19} />
    </>
  );
  return (
    <section
      className="hero image-carousel"
      aria-label="首页推荐轮播"
      aria-roledescription="轮播图"
      data-slide={current + 1}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={(e) => {
        if (!(e.target as HTMLElement).closest('.pause-button')) setPaused(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          select(current + (e.key === 'ArrowRight' ? 1 : -1));
        }
      }}
      onTouchStart={(e) => {
        touch.current = { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
      }}
      onTouchEnd={(e) => {
        if (!touch.current) return;
        const dx = e.changedTouches[0].clientX - touch.current.x,
          dy = e.changedTouches[0].clientY - touch.current.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2)
          select(current + (dx < 0 ? 1 : -1));
        touch.current = null;
      }}
    >
      <BannerImage key={banner.id + ':' + banner.image_id} banner={banner} />
      <div className="carousel-shade" />
      <div
        className="hero-copy"
        role="group"
        aria-roledescription="幻灯片"
        aria-label={`${current + 1} / ${slides.length}`}
        aria-live={running ? 'off' : 'polite'}
      >
        <h1>{banner.title}</h1>
        {banner.description && <p>{banner.description}</p>}
        <div className="hero-actions">
          {banner.external_url && !banner.content_id ? (
            <a
              className="button carousel-primary"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {action}
            </a>
          ) : (
            <Link className="button carousel-primary" to={href}>
              {action}
            </Link>
          )}
          <Link className="button carousel-secondary" to="/editor">
            分享我的实践 <ArrowUpRight size={18} />
          </Link>
        </div>
      </div>
      {slides.length > 1 && (
        <div className="carousel-controls">
          <button
            className="carousel-arrow"
            aria-label="上一张推荐"
            onClick={() => select(current - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <div className="carousel-dots">
            {slides.map((b, i) => (
              <button
                key={b.id}
                className={i === current ? 'current' : ''}
                aria-label={`查看推荐 ${i + 1}`}
                aria-pressed={i === current}
                onClick={() => select(i)}
              />
            ))}
          </div>
          <button
            className="carousel-arrow"
            aria-label="下一张推荐"
            onClick={() => select(current + 1)}
          >
            <ChevronRight size={18} />
          </button>
          <span className="carousel-count" aria-hidden="true">
            {String(current + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
          </span>
          {!reduced && (
            <button
              className="pause-button"
              aria-label={paused ? '播放轮播' : '暂停轮播'}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
