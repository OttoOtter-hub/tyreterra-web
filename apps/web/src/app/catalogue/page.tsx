'use client';
import { useState, useEffect, useCallback } from 'react';
import Navbar from '../../components/Navbar';
import ListingCard from '../../components/ListingCard';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';

const SEGMENTS = ['', 'TBR', 'PCR', 'OTR', 'AGRI', 'MH'];
const CONDITIONS = ['', 'new', 'used', 'retreaded'];

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

interface SearchResult {
  data: Parameters<typeof ListingCard>[0]['listing'][];
  total: number;
}

export default function CataloguePage() {
  const { user } = useAuth();
  const [results, setResults] = useState<SearchResult>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    segment: '', tire_type: '', brand: '', size_raw: '', location_country: '',
    condition: '', qty_min: '', page: 1,
  });

  const search = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v !== 1) params.set(k, String(v)); });
      const data = await api.get<SearchResult>(`/listings?${params}`);
      setResults(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { search(); }, [search]);

  const setF = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setFilters(f => {
      const next = { ...f, [field]: value, page: 1 };
      if (field === 'segment') next.tire_type = '';
      return next;
    });
  };

  const tireTypeOptions = TIRE_TYPES[filters.segment] ?? [];

  return (
    <>
      <Navbar />
      <div className="container page">
        <div className="page-header">
          <h1>Catalogue</h1>
          {!loading && <span style={{ color: '#6b7280', fontSize: '.9rem' }}>{results.total} listings</span>}
        </div>

        <div className="filters">
          <div className="form-group">
            <label>Segment</label>
            <select className="form-control" value={filters.segment} onChange={setF('segment')}>
              {SEGMENTS.map(s => <option key={s} value={s}>{s || 'All'}</option>)}
            </select>
          </div>

          {tireTypeOptions.length > 0 && (
            <div className="form-group">
              <label>Type</label>
              <select className="form-control" value={filters.tire_type} onChange={setF('tire_type')}>
                <option value="">All</option>
                {tireTypeOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label>Brand</label>
            <input className="form-control" value={filters.brand} onChange={setF('brand')} placeholder="Any brand" />
          </div>
          <div className="form-group">
            <label>Size</label>
            <input className="form-control" value={filters.size_raw} onChange={setF('size_raw')} placeholder="e.g. 315/80R22.5" />
          </div>
          <div className="form-group">
            <label>Country</label>
            <input className="form-control" value={filters.location_country} onChange={setF('location_country')} placeholder="DE, PL…" maxLength={2} style={{ width: 80 }} />
          </div>
          <div className="form-group">
            <label>Condition</label>
            <select className="form-control" value={filters.condition} onChange={setF('condition')}>
              {CONDITIONS.map(c => <option key={c} value={c}>{c || 'All'}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Min qty</label>
            <input className="form-control" type="number" min={1} value={filters.qty_min} onChange={setF('qty_min')} style={{ width: 80 }} />
          </div>
          <button className="btn btn-primary" onClick={search}>Search</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {loading && <div className="loading">Loading listings…</div>}

        {!loading && results.data.length === 0 && (
          <div className="empty"><h3>No listings found</h3><p>Try adjusting your filters</p></div>
        )}

        {!loading && results.data.length > 0 && (
          <div className="listing-grid">
            {results.data.map(l => <ListingCard key={l.id} listing={l} myCompanyId={user?.company_id} />)}
          </div>
        )}
      </div>
    </>
  );
}
