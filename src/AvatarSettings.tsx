import { useRef, useState } from 'react';
import { Camera } from './icons';
import { api } from './api';
import { useApp } from './context';
import { Avatar } from './components';
import { AvatarCropper, type AvatarCrop } from './AvatarCropper';

export function AvatarSettings() {
  const { user, refresh, toast } = useApp();
  const input = useRef<HTMLInputElement>(null),
    selection = useRef(0);
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [crop, setCrop] = useState<AvatarCrop | null>(null);
  function clear() {
    selection.current++;
    setFile(null);
    setPreview('');
    setCrop(null);
    setError('');
  }
  function choose(next?: File) {
    if (!next) return;
    clear();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(next.type)) {
      setError('请选择 PNG、JPEG 或 WebP 图片');
      return;
    }
    if (next.size > 5 * 1024 * 1024) {
      setError('头像不能超过 5 MB');
      return;
    }
    const ticket = selection.current,
      reader = new FileReader();
    reader.onload = () => {
      if (ticket === selection.current) {
        setFile(next);
        setPreview(String(reader.result));
      }
    };
    reader.onerror = () => setError('图片无法读取，请重新选择');
    reader.readAsDataURL(next);
  }
  async function save() {
    if (!file || !crop || busy) return;
    setBusy(true);
    setError('');
    try {
      const data = new FormData();
      data.append('crop', JSON.stringify(crop));
      data.append('file', file);
      await api('/auth/avatar', { method: 'POST', body: data });
      clear();
      await refresh();
      toast('头像已更新');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api('/auth/avatar', { method: 'DELETE' });
      clear();
      await refresh();
      toast('已恢复默认头像');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="avatar-settings">
      <div className="avatar-settings-main">
        <Avatar name={user.name} userId={user.id} version={user.avatar_version} />
        <div>
          <div className="avatar-actions">
            <button
              type="button"
              className="button secondary small-button"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Camera size={16} />
              更换头像
            </button>
            {file && (
              <>
                <button
                  type="button"
                  className="button small-button"
                  disabled={busy || !crop}
                  onClick={save}
                >
                  {busy ? '正在保存…' : '保存头像'}
                </button>
                <button type="button" className="text-button" disabled={busy} onClick={clear}>
                  取消
                </button>
              </>
            )}
            {!file && user.avatar_version && (
              <button type="button" className="text-button" disabled={busy} onClick={remove}>
                移除头像
              </button>
            )}
          </div>
          <small>PNG / JPEG / WebP，5 MB 以内</small>
        </div>
      </div>
      {preview && (
        <AvatarCropper
          key={preview}
          src={preview}
          disabled={busy}
          onChange={setCrop}
          onError={setError}
        />
      )}
      <input
        ref={input}
        className="avatar-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="上传头像"
        disabled={busy}
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
