import { useEffect, useState, useCallback, useRef, type SetStateAction } from 'react';
let csrf = '';
export const setCsrf = (value: string) => {
  csrf = value;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      'X-CSRF-Token': csrf,
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({ error: '服务器返回异常，请重试' }));
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, body.error || '操作失败');
  }
  return body;
}
export const send = (url: string, body: any = {}, method = 'POST') =>
  api(url, { method, body: JSON.stringify(body) });
export function useApi<T = any>(url: string | null) {
  const [data, setData] = useState<T | null>(null),
    [dataUrl, setDataUrl] = useState(url),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [tick, setTick] = useState(0);
  const sequence = useRef(0),
    currentUrl = useRef(url);
  currentUrl.current = url;
  const updateData = useCallback(
    (value: SetStateAction<T | null>) => {
      if (currentUrl.current === url) setData(value);
    },
    [url],
  );
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // Keep mounted content during background updates; stale requests may not
  // replace a newer response or write into another route.
  const refresh = useCallback(async () => {
    if (!url || currentUrl.current !== url) return;
    const request = ++sequence.current;
    try {
      const value = await api<T>(url);
      if (currentUrl.current === url && request === sequence.current) {
        setData(value);
        setDataUrl(url);
        setError('');
      }
      return value;
    } finally {
      if (currentUrl.current === url && request === sequence.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    let active = true;
    const request = ++sequence.current;
    setDataUrl(url);
    setData(null);
    setError('');
    if (!url) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<T>(url)
      .then((v) => {
        if (active && request === sequence.current) setData(v);
      })
      .catch((e) => {
        if (active && request === sequence.current) setError(e.message);
      })
      .finally(() => {
        if (active && request === sequence.current) setLoading(false);
      });
    return () => {
      active = false;
      ++sequence.current;
    };
  }, [url, tick]);
  // A new route renders before effects clear the previous response. Never expose
  // that response (or its error/loading state) under a different request key.
  const current = dataUrl === url;
  return {
    data: current ? data : null,
    error: current ? error : '',
    loading: Boolean(url) && (!current || loading),
    reload,
    refresh,
    setData: updateData,
  };
}
export function upload(
  cid: string,
  file: File,
  onProgress: (n: number) => void,
  purpose: 'content' | 'comment' = 'content',
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/contents/${cid}/${purpose === 'comment' ? 'comment-files' : 'files'}`);
    xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error('上传失败，请重试'));
    xhr.onload = () => {
      let value: any;
      try {
        value = JSON.parse(xhr.responseText);
      } catch {
        return reject(new Error('上传失败'));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(value);
      else reject(new Error(value.error || '上传失败'));
    };
    const data = new FormData();
    data.append('file', file);
    xhr.send(data);
  });
}
export type User = {
  id: string;
  name: string;
  username: string;
  role: 'member' | 'moderator' | 'admin';
  department_id: string | null;
  bio: string;
  avatar_version?: string | null;
  must_reset: boolean;
  moderation_exempt: boolean;
};
export const typeLabels: Record<string, string> = {
  experience: '经验分享',
  project: '开发项目',
  skill: '技能包',
  prompt: '提示词',
  discussion: '论坛话题',
};
export const statusLabels: Record<string, string> = {
  draft: '草稿',
  queued: '待审核',
  pending: '待审核',
  running: '审核中',
  review: '待人工复核',
  rejected: '已退回',
  approved: '已通过',
  published: '已发布',
  withdrawn: '已下架',
  deleted: '已删除',
  failed: '审核异常',
  done: '已完成',
  clean: '可用',
  blocked: '已隔离',
  open: '待处理',
  resolved: '已处理',
};
export const date = (value: string) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        timeZone: 'Asia/Shanghai',
      }).format(new Date(value))
    : '';
export const size = (n: number) =>
  n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB';
