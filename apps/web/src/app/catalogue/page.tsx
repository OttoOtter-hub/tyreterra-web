'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navbar from '../../components/Navbar';
import TireInfo, { TireListing } from '../../components/TireInfo';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { countryByCode } from '../../lib/countries';

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

interface CatalogueRow extends TireListing {
  id: string;
  company_id: string;
  size_raw: string;
  brand: string;
  segment: string;
  qty: number;
  condition: string;
  location_country: string;
  seller_rating: number | null | undefined;
  created_at: string;
}

interface SearchResult {
  data: CatalogueRow[];
  total: number;
}

function Stars({ score }: { score: number | null | undefined }) {
  if (score == null) return <span style={{ color: '#9ca3af', fontSize: '.75rem' }}>New</span>;
  const full = Math.floor(score);
  return <span style={{ fontSize: '.8rem' }} title={`${score}/5`}>{'★'.repeat(full)}{'☆'.repeat(5 - full)} {score.toFixed(1)}</span>;
}

export default function CataloguePage() {
  const { user } = useAuth();
  const router = useRouter();
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
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Tire</th>
                  <th>Type / Cond.</th>
                  <th>Specs</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th>Location</th>
                  <th>Seller</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {results.data.map(l => {
                  const isOwn = !!user?.company_id && l.company_id === user.company_id;
                  return (
                    <tr key={l.id} style={isOwn ? { background: '#f9fafb' } : undefined}>
                      {/* Tire */}
                      <td style={{ minWidth: 200 }}>
                        <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{l.size_raw}</div>
                        <div style={{ color: '#374151', fontSize: '.85rem' }}>
                          {l.brand}{l.pattern ? <span style={{ color: '#9ca3af' }}> · {l.pattern}</span> : ''}
                        </div>
                        {isOwn && <span style={{ fontSize: '.7rem', color: '#9ca3af', fontStyle: 'italic' }}>your listing</span>}
                      </td>

                      {/* Segment + type + condition */}
                      <td>
                        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                          <span className={`badge badge-${l.segment.toLowerCase()}`}>{l.segment}</span>
                          {l.tire_type && (
                            <span style={{ display:'inline-block', padding:'.1rem .4rem', borderRadius:999,
                              background:'#e0f2fe', color:'#0369a1', fontSize:'.72rem', fontWeight:500 }}>
                              {l.tire_type.replace(/_/g,' ')}
                            </span>
                          )}
                        </div>
                        <div style={{ marginTop: '.25rem' }}>
                          <span className={`badge badge-${l.condition}`}>{l.condition}</span>
                        </div>
                      </td>

                      {/* Load index + year + origin */}
                      <td style={{ fontSize: '.78rem', color: '#6b7280' }}>
                        {l.load_index && <div><b style={{ color: '#374151' }}>LI:</b> {l.load_index}</div>}
                        {l.dot_code    && <div><b style={{ color: '#374151' }}>Year:</b> {l.dot_code}</div>}
                        {l.origin_country && <div><b style={{ color: '#374151' }}>Origin:</b> {countryByCode[l.origin_country] ?? l.origin_country}</div>}
                      </td>

                      {/* Qty */}
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.qty}</td>

                      {/* Location */}
                      <td style={{ fontSize: '.82rem' }}>
                        {countryByCode[l.location_country] ?? l.location_country}
                        {l.location_region && <div style={{ color: '#9ca3af', fontSize: '.75rem' }}>{l.location_region}</div>}
                      </td>

                      {/* Seller rating */}
                      <td><Stars score={l.seller_rating} /></td>

                      {/* Action */}
                      <td>
                        {isOwn
                          ? <Link href={`/listings/${l.id}/edit`} className="btn btn-secondary btn-sm">Edit</Link>
                          : <button className="btn btn-primary btn-sm"
                              onClick={() => router.push(`/catalogue/${l.id}`)}>
                              Request
                            </button>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
