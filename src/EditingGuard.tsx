import { useEffect, useRef, useState } from 'react';
import { useBlocker, useLocation } from 'react-router-dom';

export function useEditingGuard(options: {
  enabled: boolean;
  isDirty: () => boolean;
  busy: boolean;
  save: () => Promise<unknown>;
}) {
  const latest = useRef(options),
    allowed = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  latest.current = options;
  const location = useLocation();
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allowed.current &&
      latest.current.enabled &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    allowed.current = false;
  }, [location.key]);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      setError('');
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [blocker.state]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (
        !allowed.current &&
        latest.current.enabled &&
        (latest.current.isDirty() || latest.current.busy)
      ) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const cancel = () => {
    if (!saving && blocker.state === 'blocked') blocker.reset();
  };
  const locked = saving || options.busy;
  return {
    blocked: blocker.state === 'blocked',
    saving,
    allowNavigation: () => {
      allowed.current = true;
    },
    dialog:
      blocker.state === 'blocked' ? (
        <dialog
          ref={dialog}
          className="admin-dialog editing-leave-dialog"
          aria-labelledby="editing-leave-title"
          onCancel={(e) => {
            e.preventDefault();
            cancel();
          }}
        >
          <h2 id="editing-leave-title">离开当前编辑？</h2>
          <p>
            {options.busy
              ? '正在保存或上传，请等待完成。'
              : options.isDirty()
                ? '还有修改未保存，直接离开会丢失这些修改。'
                : '当前内容已保存为草稿，还未发布。'}
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="editing-leave-actions">
            <button className="button secondary" autoFocus disabled={saving} onClick={cancel}>
              继续编辑
            </button>
            <button
              className="button"
              disabled={locked}
              onClick={async () => {
                setSaving(true);
                setError('');
                try {
                  await latest.current.save();
                  allowed.current = true;
                  blocker.proceed();
                } catch (e: any) {
                  setError('未能保存，已留在当前页：' + e.message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? '正在保存…' : '保存后离开'}
            </button>
            <button
              className="text-button danger"
              disabled={locked}
              onClick={() => {
                allowed.current = true;
                blocker.proceed();
              }}
            >
              直接离开
            </button>
          </div>
        </dialog>
      ) : null,
  };
}
