'use client';

import { useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';

// Owner login. No signup flow exists: the single owner user is created
// by the owner in the Supabase dashboard (Auth -> Add user).
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const supabase = getBrowserSupabase();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setMessage('Setup mode: Supabase env is not configured yet.');
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setMessage('Login failed: ' + error.message);
    } else {
      window.location.href = '/';
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-slate-100">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h1 className="mb-4 text-xl font-semibold">Preston OS - Owner Login</h1>
        {!supabase && (
          <p className="mb-4 rounded bg-amber-900 p-2 text-xs">
            SETUP MODE: login activates once the owner configures the
            Supabase environment values.
          </p>
        )}
        <label className="mb-2 block text-sm">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2"
            autoComplete="username"
            required
          />
        </label>
        <label className="mb-4 block text-sm">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 p-2"
            autoComplete="current-password"
            required
          />
        </label>
        <button
          type="submit"
          className="w-full rounded bg-emerald-800 p-2 font-medium hover:bg-emerald-700"
        >
          Sign in
        </button>
        {message && <p className="mt-3 text-sm text-amber-400">{message}</p>}
      </form>
    </main>
  );
}
