'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import CountrySelect from '../../components/CountrySelect';
import { api } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: '', password: '',
    company_name: '', country: '', vat_number: '',
    gdpr_consent: false, tos_accepted: false,
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);
    try {
      const res = await api.post<{ message: string }>('/auth/register', {
        ...form,
        role: 'dealer',
        vat_number: form.vat_number || undefined,
      });
      setSuccess(res.message);
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
            <div className="alert alert-success" style={{ marginBottom: 0 }}>{success}</div>
            <p style={{ marginTop: '1rem', textAlign: 'center' }}>
              <Link href="/login">Back to login</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap" style={{ padding: '2rem 0' }}>
      <div className="auth-box" style={{ maxWidth: 520 }}>
        <div className="card">
          <h1 className="auth-title">Register your company</h1>
          <p className="auth-sub">B2B platform — dealers and distributors only</p>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Email *</label>
              <input className="form-control" type="email" value={form.email} onChange={set('email')} required />
            </div>
            <div className="form-group">
              <label>Password *</label>
              <input className="form-control" type="password" value={form.password} onChange={set('password')} required />
              <p className="form-hint">Min 12 characters, 1 uppercase, 1 number</p>
            </div>
            <div className="form-group">
              <label>Company name *</label>
              <input className="form-control" value={form.company_name} onChange={set('company_name')} required />
            </div>
            <div className="form-group">
              <label>Country *</label>
              <CountrySelect
                value={form.country}
                onChange={v => setForm(f => ({ ...f, country: v }))}
                placeholder="Search country…"
                required
              />
            </div>
            <div className="form-group">
              <label>VAT number (optional for non-EU)</label>
              <input className="form-control" value={form.vat_number} onChange={set('vat_number')}
                placeholder="DE123456789" />
              <p className="form-hint">Validated via EU VIES</p>
            </div>

            <div className="form-group">
              <label className="checkbox-group">
                <input type="checkbox" checked={form.gdpr_consent} onChange={set('gdpr_consent')} required />
                <span>I consent to the processing of my personal data per the <a href="/privacy">Privacy Policy</a> *</span>
              </label>
            </div>
            <div className="form-group">
              <label className="checkbox-group">
                <input type="checkbox" checked={form.tos_accepted} onChange={set('tos_accepted')} required />
                <span>I accept the <a href="/terms">Terms of Service</a> *</span>
              </label>
            </div>

            <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
              {loading ? 'Submitting…' : 'Register'}
            </button>
          </form>

          <p style={{ marginTop: '1rem', fontSize: '.9rem', textAlign: 'center', color: '#6b7280' }}>
            Already registered? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
