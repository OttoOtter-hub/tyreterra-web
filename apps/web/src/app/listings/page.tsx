'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import { api } from '../../lib/api';
import { countryByCode } from '../../lib/countries';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const SEGMENTS = ['TBR', 'PCR', 'OTR', 'AGRI', 'MH'];
const CONDITIONS = ['new', 'used', 'retreaded'];
const STATUSES = ['active', 'inactive', 'expired'];

interface Listing {
  id: string;
  segment: string;
  tire_type: string | null;
  size_raw: string;
  brand: string;
  pattern: string | null;
  sku: string | null;
  qty: number;
  condition: string;
  status: string;
  location_country: string;
  expires_at: string;
  created_at: string;
  price?: number | null;
  price_currency?: string | null;
  currency?: string | null;
}

export default function MyListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState(false);

  // Filters
  const [fSegment, setFSegment] = useState('');
  const [fCondition, setFCondition] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fSearch, setFSearch] = useState('');

  useEffect(() => {
    api.get<Listing[]>('/listings/mine')
      .then(setListings).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = fSearch.toLowerCase();
    return listings.filter(l =>
      (!fSegment || l.segment === fSegment) &&
      (!fCondition || l.condition === fCondition) &&
      (!fStatus || l.status === fStatus) &&
      (!q || l.brand.toLowerCase().includes(q) || l.size_raw.toLowerCase().includes(q) ||
        (l.sku?.toLowerCase().includes(q)) || (l.pattern?.toLowerCase().includes(q)))
    );
  }, [listings, fSegment, fCondition, fStatus, fSearch]);

  // Selection helpers
  const allSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id));
  const someSelected = selected.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(l => n.delete(l.id)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(l => n.add(l.id)); return n; });
    }
  }

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function toggleStatus(id: string, current: string) {
    if (current === 'active') {
      await api.post(`/listings/${id}/deactivate`, {});
      setListings(prev => prev.map(l => l.id === id ? { ...l, status: 'inactive' } : l));
    } else {
      await api.post(`/listings/${id}/activate`, {});
      setListings(prev => prev.map(l => l.id === id ? { ...l, status: 'active' } : l));
    }
  }

  async function deleteOne(id: string) {
    if (!confirm('Delete this listing permanently?')) return;
    await api.delete(`/listings/${id}`);
    setListings(prev => prev.filter(l => l.id !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
  }

  async function bulkAction(action: 'deactivate' | 'activate' | 'delete') {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === 'delete' && !confirm(`Delete ${ids.length} listing(s) permanently?`)) return;
    setActing(true);
    try {
      const { affected } = await api.post<{ affected: number }>('/listings/bulk-action', { ids, action });
      if (action === 'delete') {
        setListings(prev => prev.filter(l => !ids.includes(l.id)));
      } else {
        const newStatus = action === 'activate' ? 'active' : 'inactive';
        setListings(prev => prev.map(l => ids.includes(l.id) ? { ...l, status: newStatus } : l));
      }
      setSelected(new Set());
    } finally {
      setActing(false);
    }
  }

  function exportExcel() {
    const token = localStorage.getItem('tt_token');
    fetch(`${API_BASE}/listings/export`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob()).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'my-listings.xlsx'; a.click();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <>
      <Navbar />
      <div className="container page">

        <div className="page-header">
          <h1>My Listings</h1>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={exportExcel}>⬇ Export</button>
            <Link href="/listings/import" className="btn btn-secondary">⬆ Import</Link>
            <Link href="/listings/new" className="btn btn-primary">+ New listing</Link>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, minWidth: 160 }}>
            <input className="form-control" placeholder="Search brand, size, SKU…"
              value={fSearch} onChange={e => setFSearch(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <select className="form-control" value={fSegment} onChange={e => setFSegment(e.target.value)}>
              <option value="">All segments</option>
              {SEGMENTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <select className="form-control" value={fCondition} onChange={e => setFCondition(e.target.value)}>
              <option value="">All conditions</option>
              {CONDITIONS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <select className="form-control" value={fStatus} onChange={e => setFStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          {(fSegment || fCondition || fStatus || fSearch) && (
            <button className="btn btn-secondary btn-sm" onClick={() => { setFSegment(''); setFCondition(''); setFStatus(''); setFSearch(''); }}>
              Clear filters
            </button>
          )}
          <span style={{ fontSize: '.85rem', color: '#6b7280', marginLeft: 'auto' }}>
            {filtered.length} / {listings.length} listings
          </span>
        </div>

        {/* Bulk action bar */}
        {someSelected && (
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap',
            padding: '.6rem 1rem', background: '#eff6ff', border: '1px solid #bfdbfe',
            borderRadius: 8, marginBottom: '1rem' }}>
            <strong style={{ fontSize: '.9rem' }}>{selected.size} selected</strong>
            <button className="btn btn-secondary btn-sm" disabled={acting}
              onClick={() => bulkAction('activate')}>Activate</button>
            <button className="btn btn-secondary btn-sm" disabled={acting}
              onClick={() => bulkAction('deactivate')}>Deactivate</button>
            <button className="btn btn-sm" disabled={acting}
              style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' }}
              onClick={() => bulkAction('delete')}>Delete</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Cancel</button>
          </div>
        )}

        {loading && <div className="loading">Loading…</div>}

        {!loading && listings.length === 0 && (
          <div className="empty">
            <h3>No listings yet</h3>
            <p style={{ marginBottom: '1rem' }}>Create your first listing to start receiving requests.</p>
            <Link href="/listings/new" className="btn btn-primary">Create listing</Link>
          </div>
        )}

        {!loading && listings.length > 0 && filtered.length === 0 && (
          <div className="empty"><h3>No results</h3><p>Try adjusting filters.</p></div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  </th>
                  <th>Size</th>
                  <th>Brand / Pattern</th>
                  <th>Segment / Type</th>
                  <th>SKU</th>
                  <th>My price</th>
                  <th>Qty</th>
                  <th>Cond.</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => (
                  <tr key={l.id} style={{ background: selected.has(l.id) ? '#eff6ff' : undefined }}>
                    <td>
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                    </td>
                    <td><strong>{l.size_raw}</strong></td>
                    <td>
                      {l.brand}
                      {l.pattern && <span style={{ color: '#6b7280', fontSize: '.8rem' }}> · {l.pattern}</span>}
                    </td>
                    <td>
                      <span className={`badge badge-${l.segment.toLowerCase()}`}>{l.segment}</span>
                      {l.tire_type && (
                        <span style={{ marginLeft: '.3rem', fontSize: '.75rem', color: '#0369a1' }}>
                          {l.tire_type.replace(/_/g, ' ')}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '.8rem', color: '#6b7280', fontFamily: 'monospace' }}>
                      {l.sku ?? '—'}
                    </td>
                    <td style={{ fontSize: '.85rem', fontWeight: 500 }}>
                      {l.price != null
                        ? `${l.price.toLocaleString()} ${l.currency ?? l.price_currency ?? 'EUR'}`
                        : <span style={{ color: '#d1d5db' }}>—</span>}
                    </td>
                    <td>{l.qty}</td>
                    <td>{l.condition}</td>
                    <td style={{ fontSize: '.8rem' }}>{countryByCode[l.location_country] ?? l.location_country}</td>
                    <td><span className={`badge badge-${l.status}`}>{l.status}</span></td>
                    <td style={{ fontSize: '.8rem', color: '#6b7280' }}>
                      {new Date(l.expires_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '.3rem' }}>
                        <Link href={`/listings/${l.id}/edit`} className="btn btn-secondary btn-sm">Edit</Link>
                        {(l.status === 'active' || l.status === 'inactive') && (
                          <button className="btn btn-secondary btn-sm"
                            onClick={() => toggleStatus(l.id, l.status)}>
                            {l.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                        <button className="btn btn-sm"
                          style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' }}
                          onClick={() => deleteOne(l.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
