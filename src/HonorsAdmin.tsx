import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, send } from './api';
import { useApp } from './context';
import { Empty, ErrorState, Loading, Pagination, Field } from './components';
import { HonorDialog, HonorRules, categoryName, honorDate as date } from './Honors';
export function HonorsAdmin() {
  const { user, toast } = useApp(),
    [tab, setTab] = useState('contributions'),
    [page, setPage] = useState(1),
    [status, setStatus] = useState('pending'),
    [search, setSearch] = useState(''),
    [trace, setTrace] = useState(''),
    [modal, setModal] = useState<any>(null),
    [reason, setReason] = useState(''),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false),
    [memberQuery, setMemberQuery] = useState(''),
    [member, setMember] = useState(''),
    [evidence, setEvidence] = useState<string[]>([]);
  const data = useApi(
    tab === 'rules'
      ? null
      : tab === 'contributions'
        ? '/admin/honors/contributions?status=' +
          status +
          '&q=' +
          encodeURIComponent(search) +
          '&page=' +
          page
        : tab === 'ledger'
          ? '/admin/honors/ledger?q=' +
            encodeURIComponent(search) +
            '&page=' +
            page +
            (trace ? '&contributionId=' + trace : '')
          : '/admin/honors/badges?page=' + page,
  );
  const members = useApi(
      modal?.action === 'grant'
        ? '/admin/honors/members?q=' + encodeURIComponent(memberQuery)
        : null,
    ),
    sources = useApi(
      modal?.action === 'grant' && member ? '/admin/honors/evidence?userId=' + member : null,
    );
  function open(action: string, item: any = {}) {
    setModal({ action, item });
    setReason('');
    setVerified(false);
    setMember('');
    setMemberQuery('');
    setEvidence([]);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (modal.action === 'grant')
        await send('/admin/honors/badges', { userId: member, reason, evidence });
      else if (['retain', 'revoke'].includes(modal.action))
        await send('/admin/honors/badges/' + modal.item.id + '/review', {
          action: modal.action,
          reason,
        });
      else
        await send('/admin/honors/contributions/' + modal.item.id + '/assess', {
          decision: modal.action,
          reason,
          verified,
          revisionId: modal.item.revision_id,
        });
      toast('已保存，积分与荣誉已同步更新');
      setModal(null);
      data.reload();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  const labels: any = {
    confirmed: '确认贡献资格',
    rejected: '撤回贡献资格',
    grant: '授予优质贡献者',
    retain: '复核保留勋章',
    revoke: '撤销人工勋章',
  };
  return (
    <div className="honor-admin">
      <div className="honor-tabs" role="tablist" aria-label="积分与荣誉管理">
        {[
          ['contributions', '贡献确认'],
          ['rules', '规则'],
          ...(user.role === 'admin'
            ? [
                ['ledger', '积分追溯'],
                ['badges', '人工勋章'],
              ]
            : []),
        ].map(([key, name]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => {
              setTab(key);
              setPage(1);
              setSearch('');
              setTrace('');
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === 'rules' ? (
        <HonorRules />
      ) : (
        <>
          <div className="honor-filters">
            {['contributions', 'ledger'].includes(tab) && (
              <input
                aria-label="搜索贡献成员"
                placeholder="搜索姓名或账号"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            )}
            {tab === 'contributions' && (
              <select
                aria-label="贡献资格状态"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="pending">等待确认</option>
                <option value="confirmed">已确认</option>
                <option value="rejected">已撤回</option>
                <option value="all">全部</option>
              </select>
            )}
            {tab === 'badges' && (
              <button className="button" onClick={() => open('grant')}>
                授予勋章
              </button>
            )}
            <button className="text-button" onClick={data.reload}>
              刷新
            </button>
            {trace && (
              <button
                className="text-button"
                onClick={() => {
                  setTrace('');
                  setPage(1);
                }}
              >
                查看全部流水
              </button>
            )}
          </div>
          {data.loading ? (
            <Loading />
          ) : data.error ? (
            <ErrorState message={data.error} retry={data.reload} />
          ) : !data.data?.items.length ? (
            <Empty
              title={
                tab === 'contributions'
                  ? '暂无符合条件的贡献记录'
                  : tab === 'ledger'
                    ? '暂无积分流水'
                    : '尚未授予人工勋章'
              }
            />
          ) : tab === 'contributions' ? (
            <div className="honor-admin-list">
              {data.data.items.map((r: any) => (
                <article className="panel honor-admin-item" key={r.id}>
                  <span className="honor-tag">{categoryName(r.category)}</span>
                  <h3>{r.title || '回答贡献'}</h3>
                  <p className="honor-admin-note">
                    {r.name} · {r.username} · {r.points} 分{r.week ? ' · ' + r.week + ' 当周' : ''}
                  </p>
                  <p>
                    {r.valid ? (r.points ? '有效贡献' : '有效贡献，本周该类已达上限') : r.reason}
                  </p>
                  <div className="actions">
                    <Link
                      className="text-button"
                      to={
                        '/content/' +
                        r.content_id +
                        (r.revision_id ? '?revision=' + r.revision_id : '')
                      }
                    >
                      查看内容 ↗
                    </Link>
                    <button
                      className="button secondary small-button"
                      onClick={() => open('confirmed', r)}
                    >
                      确认并计分
                    </button>
                    <button className="text-button danger" onClick={() => open('rejected', r)}>
                      撤回资格
                    </button>
                    {user.role === 'admin' && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setTab('ledger');
                          setTrace(r.id);
                          setSearch('');
                          setPage(1);
                        }}
                      >
                        追溯积分
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : tab === 'ledger' ? (
            <div className="panel honor-records">
              {data.data.items.map((r: any) => (
                <article key={r.id}>
                  <div>
                    <b>{r.name}</b> <span className="honor-tag">{categoryName(r.category)}</span>
                    <p>{r.reason}</p>
                    <small>
                      {date(r.created_at)} · 归属 {r.week} 当周 · {r.actor || '自动记分'}
                    </small>
                    <div className="honor-trace">
                      流水 {r.id}
                      {r.reverses_id ? ' · 撤回原流水 ' + r.reverses_id : ''}
                    </div>
                    <button
                      className="text-button"
                      onClick={() => {
                        setTrace(r.contribution_id);
                        setPage(1);
                      }}
                    >
                      查看同一贡献全部流水
                    </button>
                  </div>
                  <strong className={r.delta < 0 ? 'honor-negative' : 'honor-score'}>
                    {r.delta > 0 ? '+' : ''}
                    {r.delta}
                  </strong>
                </article>
              ))}
            </div>
          ) : (
            <div className="honor-admin-list">
              {data.data.items.map((r: any) => (
                <article className="panel honor-admin-item" key={r.id}>
                  <div className="honor-progress-head">
                    <div>
                      <h3>
                        {r.name} · {r.badge_name}
                      </h3>
                      <span className="honor-tag">人工授予</span>
                    </div>
                    <img src={r.image} alt="" width="64" height="64" loading="lazy" />
                  </div>
                  <p>{r.reason}</p>
                  <small>
                    {r.issuer} · {date(r.awarded_at)}
                  </small>
                  {r.revoked_at ? (
                    <p>已撤销：{r.revoke_reason}</p>
                  ) : (
                    <div className="actions">
                      {r.needs_review && (
                        <>
                          <span className="honor-tag">依据失效，待复核</span>
                          <button
                            className="button secondary small-button"
                            onClick={() => open('retain', r)}
                          >
                            复核保留
                          </button>
                        </>
                      )}
                      <button className="text-button danger" onClick={() => open('revoke', r)}>
                        撤销勋章
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          <Pagination total={data.data?.total || 0} page={page} onChange={setPage} />
        </>
      )}
      {modal && (
        <HonorDialog
          title={labels[modal.action]}
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <form className="honor-form" onSubmit={submit}>
            {modal.action === 'grant' ? (
              <>
                <Field label="查找成员">
                  <input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="姓名或账号"
                  />
                </Field>
                <Field label="授予成员">
                  <select
                    required
                    value={member}
                    onChange={(e) => {
                      setMember(e.target.value);
                      setEvidence([]);
                    }}
                  >
                    <option value="">请选择成员</option>
                    {members.data?.items.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.name}（{u.username}）
                      </option>
                    ))}
                  </select>
                </Field>
                {sources.data?.items.length > 0 && (
                  <div>
                    <p>关联贡献（可选）</p>
                    <div className="honor-evidence">
                      {sources.data.items.map((g: any) => (
                        <label className="checkbox" key={g.id}>
                          <input
                            type="checkbox"
                            checked={evidence.includes(g.id)}
                            onChange={(e) =>
                              setEvidence((v) =>
                                e.target.checked ? [...v, g.id] : v.filter((k) => k !== g.id),
                              )
                            }
                          />
                          {g.title || categoryName(g.category) + '贡献'}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p>{modal.item.title || modal.item.name}</p>
            )}
            {modal.action === 'confirmed' && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  required
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                />
                {modal.item.category === 'case'
                  ? '已确认案例原创实用，包含问题、做法和实际结果'
                  : modal.item.category === 'resource'
                    ? '已确认说明完整，链接或文件可以使用且内容匹配'
                    : '已检查回答内容有效且满足答疑奖励条件'}
              </label>
            )}
            <Field
              label={
                modal.action === 'grant' || modal.action === 'retain'
                  ? '授予理由（公开展示）'
                  : '处理原因'
              }
            >
              <textarea
                required
                minLength={5}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {modal.action === 'rejected' && (
              <p className="honor-admin-note">
                将撤回对应积分，原周名额及关联勋章会重新计算，保留全部流水。
              </p>
            )}
            <div className="actions">
              <button className="button" disabled={busy}>
                {busy ? '正在保存…' : '确认保存'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                取消
              </button>
            </div>
          </form>
        </HonorDialog>
      )}
    </div>
  );
}
