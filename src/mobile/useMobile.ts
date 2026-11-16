import { useSyncExternalStore } from 'react';

// Keep this in sync with mobile.css. A shared query avoids per-card listeners.
export const MOBILE_QUERY = '(max-width: 760px)';
const listeners = new Set<() => void>();
let media: MediaQueryList | undefined;
const query = () => (media ??= window.matchMedia(MOBILE_QUERY));
const changed = () => listeners.forEach((notify) => notify());
function subscribe(notify: () => void) {
  if (!listeners.size) query().addEventListener('change', changed);
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
    if (!listeners.size) query().removeEventListener('change', changed);
  };
}
export function useMobile() {
  return useSyncExternalStore(
    subscribe,
    () => query().matches,
    () => false,
  );
}
