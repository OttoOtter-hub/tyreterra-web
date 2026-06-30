'use client';
import { useState, FormEvent, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../lib/api';

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, new_password: password });
      setSuccess(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="auth-box">
          <div className="card">
            <div className="alert alert-error" style={{ marginBottom: 0 }}>
              Missing reset token. Use the link from your email.
            </div>
            <p style={{ marginTop: '1rem', textAlign: 'center' }}>
              <Link href="/forgot-password">Request a new link</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="auth-wrap">
        <div className="auth-box">
          <div className="card">
            <div className="alert alert-success" style={{ marginBottom: 0 }}>
              Password reset! Redirecting to login…
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-box">
        <div className="card">
          <h1 className="auth-title">Set a new password</h1>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>New password</label>
              <input className="form-control" type="password" value={password}
                onChange={e => setPassword(e.target.value)} required autoFocus />
              <p className="form-hint">Min 12 characters, 1 uppercase, 1 number</p>
            </div>
            <div className="form-group">
              <label>Confirm password</label>
              <input className="form-control" type="password" value={confirm}
                onChange={e => setConfirm(e.target.value)} required />
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
              {loading ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="auth-wrap"><div className="loading">Loading…</div></div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
