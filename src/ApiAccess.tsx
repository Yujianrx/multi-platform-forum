import { useState } from 'react';
import { api, send, useApi, date } from './api';
import { useApp } from './context';
import { Field, Loading, ErrorState } from './components';
import './api-access.css';

export function ApiAccess() {
  const keys = useApi('/auth/api-keys'),
    taxonomy = useApi('/taxonomy'),
    { toast, user } = useApp();
  const [name, setName] = useState(''),
    [days, setDays] = useState(90),
    [busy, setBusy] = useState(false),
    [created, setCreated] = useState<{ id: string; token: string } | null>(null);
  const endpoint = window.location.origin + '/api/open/v1/posts';
  const example = JSON.stringify(
    {
      type: 'experience',
      title: '这周的 AI 实践记录',
      body: '## 实践过程\n\n把实际操作、发现和结果写在这里。',
      categoryId: taxonomy.data?.categories?.[0]?.id || '分类 ID',
    },
    null,
    2,
  );
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制');
    } catch {
      toast('复制失败，请选中文字手动复制', true);
    }
  }
  return (
    <div className="api-access settings-stack">
      <section className="panel">
        <h2>AI 接入</h2>
        <p>
          把接口地址和个人密钥配置到 AI 工具中，即可用自己的账号投稿。
          {user.moderation_exempt ? '你的账号已开启免审，投稿后直接发布。' : '内容通过审核后公开。'}
        </p>
        <form
          className="api-key-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const key = await send('/auth/api-keys', { name, expiresInDays: days });
              setCreated(key);
              setName('');
              keys.reload();
            } catch (e: any) {
              toast(e.message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="密钥名称">
            <input
              value={name}
              maxLength={60}
              required
              placeholder="例如：我的写作工作流"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="有效期">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={30}>30 天</option>
              <option value={90}>90 天</option>
              <option value={365}>1 年</option>
            </select>
          </Field>
          <button className="button" disabled={busy || !!created}>
            {busy ? '正在创建…' : '创建密钥'}
          </button>
        </form>
        {created && (
          <div className="api-secret-box" role="status">
            <strong>请保存这把密钥，关闭后不再显示。</strong>
            <input
              aria-label="新接口密钥"
              value={created.token}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="api-key-actions">
              <button className="button secondary small-button" onClick={() => copy(created.token)}>
                复制密钥
              </button>
              <button className="text-button" onClick={() => setCreated(null)}>
                已保存，关闭
              </button>
            </div>
            <p className="form-tip">放在 AI 工具的服务端凭据配置中，不要写进帖子或公开分享。</p>
          </div>
        )}
        {keys.loading ? (
          <Loading />
        ) : keys.error ? (
          <ErrorState message={keys.error} retry={keys.reload} />
        ) : (
          <div className="api-key-list">
            {!keys.data?.items.length && <p className="muted">还没有接口密钥。</p>}
            {keys.data?.items.map((key: any) => {
              const revoked = !!key.revoked_at,
                expired = new Date(key.expires_at).getTime() <= Date.now();
              return (
                <article className="api-key-row" key={key.id}>
                  <div>
                    <strong>{key.name}</strong>
                    <code>{key.prefix}…</code>
                    <small>
                      {revoked ? '已撤销' : expired ? '已过期' : `有效至 ${date(key.expires_at)}`}
                      {!revoked && key.last_used_at ? ` · 最近使用 ${date(key.last_used_at)}` : ''}
                    </small>
                  </div>
                  {!revoked && !expired && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `撤销“${key.name}”后，使用它的工具将无法继续投稿。确定撤销？`,
                          )
                        )
                          return;
                        setBusy(true);
                        try {
                          await api('/auth/api-keys/' + key.id, { method: 'DELETE' });
                          if (created?.id === key.id) setCreated(null);
                          keys.reload();
                          toast('密钥已撤销');
                        } catch (e: any) {
                          toast(e.message, true);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      撤销
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className="panel api-quickstart">
        <h2>连接你的工具</h2>
        <div className="api-endpoint">
          <code>POST {endpoint}</code>
          <button className="text-button" onClick={() => copy(endpoint)}>
            复制地址
          </button>
        </div>
        <p>
          认证选择 Bearer Token，填入个人密钥。请求体使用 JSON，正文支持
          Markdown；每篇新内容使用一个新的 <code>Idempotency-Key</code>，失败重试时保持不变。
        </p>
        <pre>{example}</pre>
        <div className="api-key-actions">
          <button className="button secondary small-button" onClick={() => copy(example)}>
            复制请求示例
          </button>
          <a
            className="text-button"
            href="/integrations/openapi.json"
            target="_blank"
            rel="noreferrer"
          >
            OpenAPI 接口说明
          </a>
        </div>
        <p className="form-tip">
          支持经验、项目、提示词和论坛话题。图片、附件可在网站中补充；投稿状态可在个人中心查看。
        </p>
      </section>
    </div>
  );
}
