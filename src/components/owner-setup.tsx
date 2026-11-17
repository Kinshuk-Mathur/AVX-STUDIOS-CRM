'use client';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { send } from './ui';

export function OwnerSetup() {
  const [token, setToken] = useState<string | null>(null);
  const loaded = useRef(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('kinshuk@avxstudios');
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const secret = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    setToken(secret);
    // Fragments are not sent to the server. Remove the secret from browser history immediately.
    if (secret) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirm')) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await send('auth/owner-setup', {
        token,
        username,
        name: data.get('name'),
        password: data.get('password'),
      });
      setDone(true);
      setToken('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <div className="auth-top">
        <Link href="/login" className="brand-word">
          AVX<span>OS</span>
          <i />
        </Link>
      </div>
      <section className="auth-story">
        <span className="eyebrow">
          <i /> YOUR PRIVATE WORKSPACE
        </span>
        <h1>
          Your studio.
          <br />
          Your account.
          <br />
          <span>Your credentials.</span>
        </h1>
        <p>Set up your owner access and get back to your work.</p>
      </section>
      <section className="auth-card">
        <div className="auth-symbol">
          <KeyRound size={23} />
        </div>
        {token === null ? (
          <LoaderCircle className="spin" />
        ) : done ? (
          <>
            <CheckCircle2 size={35} />
            <h2>Your owner account is ready.</h2>
            <p>
              Sign in with <strong>{username}</strong> and the password you just chose.
            </p>
            <Link className="button primary full" href="/login">
              Go to owner sign in <ArrowRight size={16} />
            </Link>
          </>
        ) : !token ? (
          <>
            <h2>Open your private setup link.</h2>
            <p>
              To create or reset your owner credentials, stop the local app and run this from your
              project terminal:
            </p>
            <pre className="setup-command">
              npm run owner:setup
              <br />
              npm run dev
            </pre>
            <p>Open the one-use link printed by the first command.</p>
            <Link className="button" href="/login">
              Back to owner sign in
            </Link>
          </>
        ) : (
          <>
            <span className="eyebrow">OWNER SETUP & RECOVERY</span>
            <h2>Choose your credentials.</h2>
            <p>Set a username and password for your single owner account.</p>
            <form onSubmit={submit}>
              <label>
                Owner name
                <input
                  name="name"
                  defaultValue="Kinshuk"
                  autoComplete="name"
                  required
                  maxLength={160}
                />
              </label>
              <label>
                Owner username
                <input
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  minLength={3}
                  maxLength={100}
                  pattern="[a-zA-Z0-9@._\-]+"
                  required
                />
              </label>
              <label>
                New password
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  placeholder="At least 12 characters"
                  required
                />
              </label>
              <label>
                Confirm password
                <input
                  name="confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}{' '}
                {showPassword ? 'Hide passwords' : 'Show passwords'}
              </button>
              {error && (
                <div role="alert" className="error-message">
                  {error}
                </div>
              )}
              <button className="button primary full" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{' '}
                {busy ? 'Saving securely…' : 'Save owner credentials'}
              </button>
            </form>
            <p className="notice">
              Existing business records stay in place. Saving signs out previous owner and viewer
              sessions.
            </p>
          </>
        )}
        <div className="secure-foot">
          <ShieldCheck size={14} />
          One-use setup link · Private owner access
        </div>
      </section>
    </main>
  );
}
