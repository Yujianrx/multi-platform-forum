import { BrandIdentity } from '../BrandIdentity';
import { brandAssets } from '../brand-assets';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, ArrowRight, LockKeyhole, Lightbulb, Code2, Quote } from '../icons';
import { api, send } from '../api';
import { Field } from '../components';
import {
  PASSWORD_HINT,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '../../server/account-policy';
export function Login({ site, onLogin }: { site: any; onLogin: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [captcha, setCaptcha] = useState<{ id: string; image: string } | null>(null),
    [captchaCode, setCaptchaCode] = useState(''),
    [captchaBusy, setCaptchaBusy] = useState(false),
    [captchaError, setCaptchaError] = useState('');
  const captchaRequest = useRef<AbortController | null>(null);
  const refreshCaptcha = useCallback(async () => {
    captchaRequest.current?.abort();
    const controller = new AbortController();
    captchaRequest.current = controller;
    setCaptcha(null);
    setCaptchaCode('');
    setCaptchaBusy(true);
    setCaptchaError('');
    try {
      const result = await api('/auth/captcha', { signal: controller.signal });
      if (!controller.signal.aborted) setCaptcha(result);
    } catch (e: any) {
      if (!controller.signal.aborted) setCaptchaError(e.message);
    } finally {
      if (!controller.signal.aborted) setCaptchaBusy(false);
    }
  }, []);
  useEffect(() => {
    if (mode === 'login') void refreshCaptcha();
    return () => captchaRequest.current?.abort();
  }, [mode, refreshCaptcha]);
  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    confirmPassword: '',
    invite: '',
    token: '',
  });
  const change = (key: string, value: string) => setForm({ ...form, [key]: value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'register' && form.password !== form.confirmPassword)
        throw new Error('两次密码不一致，请重新确认');
      const body =
        mode === 'login'
          ? {
              username: form.username,
              password: form.password,
              captchaId: captcha?.id,
              captchaCode,
            }
          : mode === 'reset'
            ? { token: form.token, password: form.password }
            : {
                username: form.username,
                password: form.password,
                name: form.name,
                confirmPassword: form.confirmPassword,
                invite: form.invite,
              };
      await send('/auth/' + mode, body);
      await onLogin();
    } catch (e: any) {
      setError(e.message);
      if (mode === 'login') await refreshCaptcha();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="brand site-brand">
          <BrandIdentity site={site} publicView />
        </div>
        <div className="login-story-copy">
          <span className="eyebrow">SHARE IDEAS. BUILD TOGETHER.</span>
          <h1>
            一个人的发现，
            <br />
            一群人的<span>新可能。</span>
          </h1>
          <p>
            {site.description || '把 AI 用进工作，把经验分享给彼此。'}
            <br />
            在这里，找到灵感、伙伴与下一次突破。
          </p>
          <img
            className="login-mascot"
            src={brandAssets.mascot}
            width={768}
            height={768}
            decoding="async"
            alt="小鱼号共创伙伴"
          />
        </div>
        <small className="login-bottom">专属内部空间 · 让知识在团队中流动</small>
        <span className="login-orbit" />
      </section>
      <section className="login-form-side">
        <div className="login-form-wrap">
          <span className="login-welcome">
            <Sparkles size={20} />
            欢迎来到共创空间
          </span>
          <h2>
            {mode === 'login'
              ? '很高兴，与你在这里相遇'
              : mode === 'register'
                ? '让我们认识一下'
                : '重新设置你的密码'}
          </h2>
          <p className="muted">
            {mode === 'login'
              ? '登录后，发现同事们的 AI 新实践。'
              : mode === 'register'
                ? '使用管理员提供的邀请码，加入公司内部社区。'
                : '输入管理员提供的一次性凭证，有效期 30 分钟。'}
          </p>
          {mode !== 'reset' && (
            <div className="segmented login-tabs">
              <button
                className={mode === 'login' ? 'selected' : ''}
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
              >
                账号登录
              </button>
              <button
                className={mode === 'register' ? 'selected' : ''}
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
              >
                邀请注册
              </button>
            </div>
          )}
          <form onSubmit={submit}>
            {mode === 'register' && (
              <Field
                label="姓名"
                hint="显示在帖子和评论中，请填写同事熟悉的姓名；之后可在个人资料修改。"
              >
                <input
                  required
                  maxLength={50}
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => change('name', e.target.value)}
                  placeholder="例如：张三"
                />
              </Field>
            )}
            {mode !== 'reset' && (
              <Field
                label="账号"
                hint={
                  mode === 'register'
                    ? '登录用，3–40 位英文字母、数字或 . _ -，不区分大小写；注册后不能修改。'
                    : undefined
                }
              >
                <input
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  minLength={3}
                  maxLength={40}
                  pattern={mode === 'register' ? '[A-Za-z0-9._\\-]{3,40}' : undefined}
                  value={form.username}
                  onChange={(e) => change('username', e.target.value)}
                  placeholder={mode === 'register' ? '例如：zhang.san' : '输入账号'}
                />
              </Field>
            )}
            {mode === 'reset' && (
              <Field
                label="一次性重置凭证"
                hint="向管理员领取后完整粘贴；凭证 30 分钟内有效，只能使用一次。"
              >
                <input
                  required
                  autoComplete="off"
                  placeholder="粘贴管理员提供的重置凭证"
                  value={form.token}
                  onChange={(e) => change('token', e.target.value)}
                />
              </Field>
            )}
            <Field
              label={mode === 'login' ? '密码' : '设置新密码'}
              hint={mode === 'login' ? undefined : PASSWORD_HINT}
            >
              <input
                required
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'login' ? 1 : PASSWORD_MIN_LENGTH}
                maxLength={mode === 'login' ? 128 : PASSWORD_MAX_LENGTH}
                value={form.password}
                onChange={(e) => change('password', e.target.value)}
                placeholder={mode === 'login' ? '输入密码' : '设置 6–20 位密码'}
              />
            </Field>
            {mode === 'login' && (
              <div className="field">
                <label htmlFor="login-captcha">验证码</label>
                <div className="captcha-row">
                  <input
                    id="login-captcha"
                    required
                    maxLength={4}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={captchaCode}
                    onChange={(e) => setCaptchaCode(e.target.value)}
                    placeholder="输入图片中的字符"
                    aria-describedby="captcha-hint"
                  />
                  <button
                    type="button"
                    className="captcha-image"
                    aria-label="更换验证码"
                    disabled={busy || captchaBusy}
                    onClick={() => void refreshCaptcha()}
                  >
                    {captcha ? (
                      <img src={captcha.image} alt="登录图片验证码" />
                    ) : (
                      <span>{captchaBusy ? '加载中…' : '点击重试'}</span>
                    )}
                  </button>
                </div>
                <small id="captcha-hint">不区分大小写，2 分钟内有效；点击图片可换一张。</small>
                {captchaError && (
                  <p className="inline-error" role="alert">
                    {captchaError}
                  </p>
                )}
              </div>
            )}
            {mode === 'register' && (
              <>
                <Field label="确认密码" hint="再次输入上面的密码，两次需保持一致。">
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    maxLength={PASSWORD_MAX_LENGTH}
                    placeholder="再次输入新密码"
                    value={form.confirmPassword}
                    onChange={(e) => change('confirmPassword', e.target.value)}
                  />
                </Field>
                <Field
                  label="邀请码"
                  hint="向管理员领取，完整粘贴即可。所属部门由邀请码分配；过期或名额用完请联系管理员重新获取。"
                >
                  <input
                    required
                    autoComplete="off"
                    maxLength={200}
                    value={form.invite}
                    onChange={(e) => change('invite', e.target.value)}
                    placeholder="粘贴你的专属邀请码"
                  />
                </Field>
              </>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <button
              className="button full"
              disabled={busy || (mode === 'login' && (!captcha || captchaBusy))}
            >
              {busy
                ? '正在处理…'
                : mode === 'login'
                  ? '进入社区'
                  : mode === 'register'
                    ? '加入共创社区'
                    : '设置密码并登录'}
              <ArrowRight size={18} />
            </button>
          </form>
          <button
            className="text-button reset-link"
            onClick={() => {
              setMode(mode === 'reset' ? 'login' : 'reset');
              setError('');
            }}
          >
            {mode === 'reset' ? '返回登录' : '忘记密码？使用管理员重置凭证'}
          </button>
          <p className="login-security">
            <LockKeyhole size={15} />
            仅限公司成员，内容按部门安全共享
          </p>
          {site.development && (
            <p className="dev-note">本地开发环境 · 初始账号见生成的本地访问说明</p>
          )}
        </div>
      </section>
    </div>
  );
}
