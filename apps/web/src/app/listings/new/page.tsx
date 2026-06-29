'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '../../../components/Navbar';
import TireSizeInput from '../../../components/TireSizeInput';
import { api } from '../../../lib/api';

const SEGMENTS = ['TBR', 'OTR', 'AGRI'];
const CONDITIONS = ['new', 'used', 'retreaded'];

export default function NewListingPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    segment: 'TBR', brand: '', size: '', pattern: '',
    qty: '', production_year: '', load_index: '', origin_country: '',
    location_country: '', location_region: '',
    condition: 'new', exclude_own_region: false,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.size.trim()) { setError('Size is required'); return; }
    setLoading(true);
    try {
      await api.post('/listings', {
        segment: form.segment,
        brand: form.brand,
        size: form.size,
        qty: parseInt(form.qty, 10),
        condition: form.condition,
        location_country: form.location_country.toUpperCase(),
        pattern: form.pattern || undefined,
        load_index: form.load_index || undefined,
        origin_country: form.origin_country || undefined,
        dot_code: form.production_year || undefined,
        location_region: form.location_region || undefined,
        exclude_own_region: form.exclude_own_region,
      });
      router.push('/listings');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Navbar />
      <div className="container page">
        <div className="page-header">
          <h1>Create Listing</h1>
        </div>

        <div style={{ maxWidth: 560 }}>
          <div className="card">
            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Segment *</label>
                <select className="form-control" value={form.segment} onChange={set('segment')}>
                  {SEGMENTS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Brand *</label>
                <input className="form-control" value={form.brand} onChange={set('brand')}
                  placeholder="Michelin, Bridgestone…" required />
              </div>

              <div className="form-group">
                <label>Tire size *</label>
                <TireSizeInput
                  value={form.size}
                  onChange={v => setForm(f => ({ ...f, size: v }))}
                />
              </div>

              <div className="form-group">
                <label>Pattern</label>
                <input className="form-control" value={form.pattern} onChange={set('pattern')} placeholder="Необязательно" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Load index</label>
                  <input className="form-control" value={form.load_index} onChange={set('load_index')}
                    placeholder="12PR, 173D, 173D/178A8" maxLength={30} />
                </div>
                <div className="form-group">
                  <label>Year of production</label>
                  <input className="form-control" type="number" min={2000} max={2030}
                    value={form.production_year} onChange={set('production_year')}
                    placeholder="2023" />
                </div>
              </div>

              <div className="form-group">
                <label>Country of origin</label>
                <input className="form-control" value={form.origin_country} onChange={set('origin_country')}
                  placeholder="India, Serbia, Japan…" maxLength={100} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Quantity *</label>
                  <input className="form-control" type="number" min={1} value={form.qty}
                    onChange={set('qty')} required />
                </div>
              </div>

              <div className="form-group">
                <label>Condition *</label>
                <select className="form-control" value={form.condition} onChange={set('condition')}>
                  {CONDITIONS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Country *</label>
                  <input className="form-control" value={form.location_country} onChange={set('location_country')}
                    placeholder="DE" maxLength={2} required />
                </div>
                <div className="form-group">
                  <label>Region</label>
                  <input className="form-control" value={form.location_region} onChange={set('location_region')} />
                </div>
              </div>

              <div className="form-group">
                <label className="checkbox-group">
                  <input type="checkbox" checked={form.exclude_own_region}
                    onChange={set('exclude_own_region')} />
                  <span>Hide from companies in my country</span>
                </label>
              </div>

              <div style={{ display: 'flex', gap: '.75rem', marginTop: '.5rem' }}>
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? 'Creating…' : 'Create listing'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => router.back()}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
