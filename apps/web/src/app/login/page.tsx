'use client';
import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../contexts/AuthContext';
import { safeNext } from '../../lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).get('reason') === 'expired');
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push(safeNext(new URLSearchParams(window.location.search).get('next')));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-box">
        <div className="card">
          <h1 className="auth-title">Tyre Terra</h1>
          <p className="auth-sub">Sign in to your B2B account</p>

          {expired && !error && <div className="alert alert-info">Session expired</div>}
          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Email</label>
              <input className="form-control" type="email" value={email}
                onChange={e => setEmail(e.target.value)} required autoFocus />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="form-control" type="password" value={password}
                onChange={e => setPassword(e.target.value)} required />
              <p style={{ marginTop: '.4rem', fontSize: '.85rem', textAlign: 'right' }}>
                <Link href="/forgot-password">Forgot password?</Link>
              </p>
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p style={{ marginTop: '1rem', fontSize: '.9rem', textAlign: 'center', color: '#6b7280' }}>
            No account? <Link href="/register">Register your company</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
