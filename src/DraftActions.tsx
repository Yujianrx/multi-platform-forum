import { useState } from 'react';
import { send } from './api';
import { useApp } from './context';

export function isDeletableDraft(state: string, status?: string | null) {
  return (
    state !== 'deleted' &&
    (status === 'draft' ||
      !status ||
      (state === 'withdrawn' && !['queued', 'review'].includes(status)))
  );
}

export function DeleteDraftButton({
  id,
  revisionId,
  published,
  onDeleted,
  onStale,
  beforeDelete,
  onBusyChange,
  disabled,
}: {
  id: string;
  revisionId: string | null;
  published: boolean;
  onDeleted: () => void;
  onStale?: () => void;
  beforeDelete?: () => Promise<string | null>;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const { toast } = useApp(),
    [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="text-button danger"
      disabled={busy || disabled}
      onClick={async () => {
        if (
          !confirm(
            published
              ? '删除这份未发布的草稿？已发布版本会保留。'
              : '删除这份草稿？此操作无法撤销。',
          )
        )
          return;
        setBusy(true);
        onBusyChange?.(true);
        try {
          const latestRevision = beforeDelete ? await beforeDelete() : revisionId;
          await send('/contents/' + id + '/draft', { revisionId: latestRevision }, 'DELETE');
          toast(published ? '草稿已删除，已发布版本保留' : '草稿已删除');
          onDeleted();
        } catch (e: any) {
          toast(e.message, true);
          onStale?.();
        } finally {
          setBusy(false);
          onBusyChange?.(false);
        }
      }}
    >
      {busy ? '正在删除…' : '删除草稿'}
    </button>
  );
}
