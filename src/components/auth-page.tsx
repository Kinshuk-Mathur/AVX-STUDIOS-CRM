'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ShieldCheck,
  ArrowRight,
  LockKeyhole,
  LoaderCircle,
  Check,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api, send } from './ui';
import type { Principal } from '@/lib/domain';
export function AuthPage({ viewer }: { viewer: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState('signed-out');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    api<{ status: string; principal?: Principal }>('auth/state')
      .then((s) => {
        if (s.status === 'approved')
          router.replace('/' + (s.principal?.permissions[0] || 'overview'));
        else if (s.status === 'pending') setStatus('pending');
      })
      .catch(() => {});
  }, [router]);
  useEffect(() => {
    if (status !== 'pending') return;
    const stream = new EventSource('/api/events');
    stream.onmessage = (e) => {
      setOffline(false);
      const value = JSON.parse(e.data) as { status: string };
      setStatus(value.status);
      if (value.status === 'approved')
        api<{ principal: Principal }>('auth/state').then((s) =>
          router.replace('/' + (s.principal.permissions[0] || 'overview')),
        );
    };
    stream.onerror = () => setOffline(true);
    return () => stream.close();
  }, [status, router]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(e.currentTarget);
    try {
      const result = await send<{ status: string }>('auth/login', {
        username: data.get('username'),
        password: data.get('password'),
        viewer,
      });
      setStatus(result.status);
      if (result.status === 'approved') router.replace('/overview');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const waiting = ['pending', 'approved', 'rejected', 'revoked', 'expired'].includes(status);
  return (
    <main className="auth-screen">
      <div className="auth-top">
        <Link href="/login" className="brand-word">
          AVX<span>OS</span>
          <i />
        </Link>
        <a href="https://avxstudios.netlify.app" target="_blank" rel="noreferrer">
          Visit AVX Studios <ArrowUpRight size={15} />
        </a>
      </div>
      <section className="auth-story">
        <span className="eyebrow">
          <i /> THE STUDIO, IN SYNC
        </span>
        <h1>
          Your work.
          <br />
          Your business.
          <br />
          <span>One workspace.</span>
        </h1>
        <p>
          The private operating system for everything
          <br />
          you create at AVX Studios.
        </p>
        <div className="auth-wordmark">
          ART <b>·</b> VISUAL <b>·</b> EXPERIENCE
        </div>
      </section>
      <section className="auth-card">
        <div className="auth-symbol">
          <LockKeyhole size={23} />
        </div>
        {waiting ? (
          <>
            <div className="waiting-icon">
              {status === 'pending' ? (
                <LoaderCircle className="spin" size={30} />
              ) : status === 'approved' ? (
                <Check size={30} />
              ) : (
                <X size={30} />
              )}
            </div>
            <h2>
              {status === 'pending'
                ? 'Waiting for Approval'
                : status === 'approved'
                  ? 'Access Approved'
                  : status === 'rejected'
                    ? 'Access Denied'
                    : status === 'expired'
                      ? 'Request Expired'
                      : 'Session Ended'}
            </h2>
            <p>
              {status === 'pending'
                ? 'Your request has been sent to the owner. This page will open your workspace when approved.'
                : status === 'rejected'
                  ? 'Your request was not approved.'
                  : status === 'approved'
                    ? 'Opening your read-only workspace…'
                    : 'Your access to AVX OS has ended.'}
            </p>
            {offline && (
              <div className="notice">
                Reconnecting securely. Access stays locked until approval is confirmed.
              </div>
            )}
            {status !== 'approved' && (
              <button
                className="button"
                onClick={async () => {
                  await send('auth/logout', {});
                  setStatus('signed-out');
                }}
              >
                Return to sign in
              </button>
            )}
          </>
        ) : (
          <>
            <span className="eyebrow">PRIVATE STUDIO WORKSPACE</span>
            <div className="login-mode">
              <Link className={!viewer ? 'selected' : ''} href="/login">
                Owner sign in
              </Link>
              <Link className={viewer ? 'selected' : ''} href="/viewer-login">
                Viewer sign in
              </Link>
            </div>
            <h2>{viewer ? 'A window into the studio.' : 'Welcome back.'}</h2>
            <p>
              {viewer
                ? 'Sign in to request read-only access.'
                : 'Sign in to your AVX OS workspace.'}
            </p>
            <form onSubmit={submit}>
              <label>
                Username
                <input
                  name="username"
                  autoComplete="username"
                  placeholder={viewer ? 'Your assigned username' : 'Owner username'}
                  required
                  maxLength={160}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                  maxLength={128}
                />
              </label>
              {error && (
                <div role="alert" className="error-message">
                  {error}
                </div>
              )}
              <button disabled={busy} className="button primary full">
                {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{' '}
                {busy ? 'Signing in…' : viewer ? 'Request Access' : 'Enter workspace'}
              </button>
            </form>
            <div className="auth-switch">
              {viewer ? 'Access is restricted to authorized viewers.' : 'Have a viewer account?'}{' '}
              {!viewer && (
                <Link href="/viewer-login">
                  Request access <ArrowUpRight size={13} />
                </Link>
              )}
              {viewer && <Link href="/login">Owner sign in</Link>}
            </div>
            {!viewer && (
              <details className="setup-help">
                <summary>Create or reset owner credentials</summary>
                <p>
                  Stop the local app. Run <code>npm run owner:setup</code> in your project folder,
                  then <code>npm run dev</code>. Open the private link to choose your owner username
                  and password.
                </p>
              </details>
            )}
          </>
        )}
        <div className="secure-foot">
          <ShieldCheck size={14} /> Private by design. Owner controlled.
        </div>
      </section>
      <footer className="auth-bottom">
        © {new Date().getFullYear()} AVX Studios <span>BUILT FOR THE WORK BEHIND THE WORK.</span>
      </footer>
    </main>
  );
}
