'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSuccess(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="auth-wrap">
        <div className="auth-box">
          <div className="card">
            <div className="alert alert-success" style={{ marginBottom: 0 }}>
              If an account exists for that email, a password reset link has been sent.
            </div>
            <p style={{ marginTop: '1rem', textAlign: 'center' }}>
              <Link href="/login">Back to login</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-box">
        <div className="card">
          <h1 className="auth-title">Reset your password</h1>
          <p className="auth-sub">Enter your email and we&apos;ll send you a reset link</p>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Email</label>
              <input className="form-control" type="email" value={email}
                onChange={e => setEmail(e.target.value)} required autoFocus />
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>

          <p style={{ marginTop: '1rem', fontSize: '.9rem', textAlign: 'center', color: '#6b7280' }}>
            <Link href="/login">Back to login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
