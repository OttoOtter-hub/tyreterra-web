'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import { api } from '../../lib/api';

interface TireRequest {
  id: string; qty_requested: number; status: string; created_at: string;
  listing?: { size_raw: string; brand: string; segment: string };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'badge-pending', offered: 'badge-active',
    accepted: 'badge-new', rejected: 'badge-blocked', cancelled: 'badge-blocked',
  };
  return <span className={`badge ${map[status] ?? ''}`}>{status}</span>;
}

export default function RequestsPage() {
  const [incoming, setIncoming] = useState<TireRequest[]>([]);
  const [outgoing, setOutgoing] = useState<TireRequest[]>([]);
  const [tab, setTab] = useState<'incoming' | 'outgoing'>('incoming');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<TireRequest[]>('/requests/incoming'),
      api.get<TireRequest[]>('/requests/outgoing'),
    ]).then(([inc, out]) => { setIncoming(inc); setOutgoing(out); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  const rows = tab === 'incoming' ? incoming : outgoing;

  return (
    <>
      <Navbar />
      <div className="container page">
        <div className="page-header"><h1>Requests</h1></div>

        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.25rem' }}>
          {(['incoming', 'outgoing'] as const).map(t => (
            <button key={t} className={`btn ${tab === t ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'incoming' && incoming.length > 0 && (
                <span style={{ background: '#fff', color: '#1a56db', borderRadius: 999, padding: '0 5px', fontSize: '.75rem', marginLeft: '.25rem' }}>
                  {incoming.filter(r => r.status === 'pending').length}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading && <div className="loading">Loading…</div>}

        {!loading && rows.length === 0 && (
          <div className="empty"><h3>No {tab} requests</h3></div>
        )}

        {!loading && rows.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr><th>Listing</th><th>Qty</th><th>Status</th><th>Date</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.listing?.size_raw ?? '—'}</strong>
                      {r.listing && <span style={{ color: '#6b7280', marginLeft: '.5rem', fontSize: '.85rem' }}>{r.listing.brand}</span>}
                    </td>
                    <td>{r.qty_requested}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td style={{ fontSize: '.8rem', color: '#6b7280' }}>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td>
                      <Link href={`/requests/${r.id}`} className="btn btn-secondary btn-sm">View</Link>
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
