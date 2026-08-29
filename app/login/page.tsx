'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Logo from '@/components/Logo';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        // Server sent something that wasn't JSON (e.g. a 500 error page) —
        // still surface a visible error instead of silently doing nothing.
      }
      if (!res.ok) {
        setError(data.error || `Login failed (server said: ${res.status}). Try again in a moment.`);
        setBusy(false);
        return;
      }
      // Full navigation (not client-side router.push) so the freshly-set
      // session cookie is guaranteed to be picked up by middleware on the
      // very next request, instead of relying on the client router's cache.
      window.location.href = params.get('next') || '/';
    } catch (err) {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-3">
          <Logo size={56} />
          <div className="text-center">
            <div className="text-lg font-bold">Solace</div>
            <div className="text-xs text-slate-500">Sign in to your account</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label mb-1 block">Username</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          </div>
          <div>
            <label className="label mb-1 block">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button type="submit" disabled={busy || !username || !password} className="btn-primary w-full">
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
