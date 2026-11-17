import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, RefreshCw } from 'lucide-react';
import { useApp } from '../context';

export const HOME_REFRESH_EVENT = 'mobile-home-refresh';

export function MobileRefresh({
  children,
  onRefresh,
}: {
  children: ReactNode;
  onRefresh: () => Promise<unknown>;
}) {
  const root = useRef<HTMLDivElement>(null),
    callback = useRef(onRefresh),
    busy = useRef(false);
  const [distance, setDistance] = useState(0),
    [refreshing, setRefreshing] = useState(false);
  const { toast } = useApp();
  callback.current = onRefresh;
  useEffect(() => {
    const element = root.current!;
    let start: { x: number; y: number } | null = null,
      pulled = 0,
      mounted = true;
    document.documentElement.classList.add('m-refresh-enabled');
    const refresh = async () => {
      if (busy.current) return;
      busy.current = true;
      setRefreshing(true);
      setDistance(0);
      try {
        await callback.current();
      } catch {
        if (mounted) toast('刷新失败，请重试', true);
      } finally {
        busy.current = false;
        if (mounted) setRefreshing(false);
      }
    };
    const begin = (event: TouchEvent) => {
      const target = event.target as HTMLElement;
      start =
        !busy.current &&
        window.scrollY <= 0 &&
        event.touches.length === 1 &&
        !target.closest('input,textarea,select,button,[contenteditable],dialog')
          ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
          : null;
      pulled = 0;
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1 || window.scrollY > 0) {
        start = null;
        pulled = 0;
        setDistance(0);
        return;
      }
      const dx = event.touches[0].clientX - start.x,
        dy = event.touches[0].clientY - start.y;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
        start = null;
        pulled = 0;
        setDistance(0);
        return;
      }
      if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
        if (event.cancelable) event.preventDefault();
        pulled = Math.min(96, dy * 0.5);
        setDistance(pulled);
      } else {
        pulled = 0;
        setDistance(0);
      }
    };
    const end = () => {
      start = null;
      if (pulled >= 64) void refresh();
      else setDistance(0);
      pulled = 0;
    };
    const cancel = () => {
      start = null;
      pulled = 0;
      setDistance(0);
    };
    const navigationRefresh = () => {
      window.scrollTo(0, 0);
      void refresh();
    };
    element.addEventListener('touchstart', begin, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', cancel);
    window.addEventListener(HOME_REFRESH_EVENT, navigationRefresh);
    return () => {
      mounted = false;
      document.documentElement.classList.remove('m-refresh-enabled');
      element.removeEventListener('touchstart', begin);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', cancel);
      window.removeEventListener(HOME_REFRESH_EVENT, navigationRefresh);
    };
  }, [toast]);
  return (
    <div ref={root} className="m-refresh" aria-busy={refreshing}>
      <div
        className="m-refresh-indicator"
        role="status"
        style={{ height: refreshing ? 48 : distance }}
      >
        {(refreshing || distance > 0) && (
          <>
            {refreshing ? (
              <RefreshCw size={16} className="m-refresh-spin" />
            ) : (
              <ArrowDown size={16} />
            )}
            <span>{refreshing ? '正在刷新' : distance >= 64 ? '松开刷新' : '下拉刷新'}</span>
          </>
        )}
      </div>
      {children}
    </div>
  );
}
