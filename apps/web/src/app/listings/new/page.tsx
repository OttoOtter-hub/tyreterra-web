'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '../../../components/Navbar';
import TireSizeInput from '../../../components/TireSizeInput';
import CountrySelect from '../../../components/CountrySelect';
import { api } from '../../../lib/api';

const SEGMENTS = ['TBR', 'PCR', 'OTR', 'AGRI', 'MH'];
const CONDITIONS = ['new', 'used', 'retreaded'];

const TIRE_TYPES: Record<string, { label: string; value: string }[]> = {
  TBR: [
    { label: 'Steer', value: 'steer' },
    { label: 'Drive', value: 'drive' },
    { label: 'Trailer', value: 'trailer' },
    { label: 'All Position', value: 'all_position' },
  ],
  PCR: [
    { label: 'Summer', value: 'summer' },
    { label: 'Winter Friction', value: 'winter_friction' },
    { label: 'Winter Stud', value: 'winter_stud' },
    { label: 'All Season', value: 'all_season' },
  ],
  MH: [
    { label: 'Pneumatic', value: 'pneumatic' },
    { label: 'Solid', value: 'solid' },
  ],
};

export default function NewListingPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    segment: 'TBR', tire_type: '', brand: '', size: '', pattern: '', sku: '',
    qty: '', production_year: '', load_index: '', origin_country: '',
    location_country: '', location_region: '', price: '', currency: 'EUR',
    condition: 'new', exclude_own_region: false,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm(f => {
      const next = { ...f, [field]: value };
      // reset tire_type when segment changes
      if (field === 'segment') next.tire_type = '';
      return next;
    });
  };

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
        tire_type: form.tire_type || undefined,
        pattern: form.pattern || undefined,
        sku: form.sku || undefined,
        price: form.price ? parseFloat(form.price) : undefined,
        currency: form.price ? form.currency : undefined,
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

  const tireTypeOptions = TIRE_TYPES[form.segment] ?? [];

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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Segment *</label>
                  <select className="form-control" value={form.segment} onChange={set('segment')}>
                    {SEGMENTS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>

                {tireTypeOptions.length > 0 && (
                  <div className="form-group">
                    <label>Type *</label>
                    <select className="form-control" value={form.tire_type} onChange={set('tire_type')} required>
                      <option value="">— select —</option>
                      {tireTypeOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )}
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
                <input className="form-control" value={form.pattern} onChange={set('pattern')} placeholder="Optional" />
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
                <label>SKU</label>
                <input className="form-control" value={form.sku} onChange={set('sku')}
                  placeholder="Your article number" maxLength={100} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>My price <span style={{ color: '#6b7280', fontWeight: 400, fontSize: '.8rem' }}>(private — only you see this)</span></label>
                  <input className="form-control" type="number" min={0} step={0.01}
                    value={form.price} onChange={set('price')} placeholder="0.00" />
                </div>
                <div className="form-group">
                  <label>Currency</label>
                  <select className="form-control" value={form.currency} onChange={set('currency')}>
                    <option>EUR</option><option>USD</option><option>GBP</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Country of origin</label>
                <CountrySelect value={form.origin_country}
                  onChange={v => setForm(f => ({ ...f, origin_country: v }))} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Quantity *</label>
                  <input className="form-control" type="number" min={1} value={form.qty}
                    onChange={set('qty')} required />
                </div>
                <div className="form-group">
                  <label>Condition *</label>
                  <select className="form-control" value={form.condition} onChange={set('condition')}>
                    {CONDITIONS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Location country *</label>
                <CountrySelect value={form.location_country}
                  onChange={v => setForm(f => ({ ...f, location_country: v }))} required />
              </div>
              <div className="form-group">
                <label>Region</label>
                <input className="form-control" value={form.location_region} onChange={set('location_region')} />
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
