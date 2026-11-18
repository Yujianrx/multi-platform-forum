import { useState, type FormEvent } from 'react';
import { send, useApi } from '../api';
import { ErrorState, Loading } from '../components';
import { useApp } from '../context';

export default function WechatBinding() {
  const { user, toast } = useApp();
  const binding = useApi<{ bound: boolean }>('/mini/binding');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!binding.data || busy) return;
    setBusy(true);
    try {
      const bound = binding.data.bound;
      binding.setData(await send('/mini/binding', bound ? undefined : { code }, bound ? 'DELETE' : 'POST'));
      setCode('');
      toast(bound ? '已解除微信绑定' : '绑定成功，请返回小程序');
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  if (binding.loading) return <Loading />;
  if (binding.error) return <ErrorState message={binding.error} retry={binding.reload} />;
  return (
    <form className="panel form-stack" onSubmit={submit}>
      <h1>微信小程序</h1>
      <p>{user.name} · {binding.data?.bound ? '已绑定微信' : '绑定社区账号'}</p>
      {!binding.data?.bound && (
        <label>
          <span>填写你本人微信小程序上显示的配对码</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" maxLength={24} required />
        </label>
      )}
      <button className="button" disabled={busy} type="submit">
        {binding.data?.bound ? '解除绑定并退出小程序' : '确认绑定'}
      </button>
    </form>
  );
}
