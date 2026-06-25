'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import { api } from '../../lib/api';

interface Deal {
  id: string; accepted_at: string;
  offer?: { request?: { listing?: { size_raw: string; brand: string } } };
}

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Deal[]>('/deals').then(setDeals).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <div className="container page">
        <div className="page-header"><h1>My Deals</h1></div>

        {loading && <div className="loading">Loading…</div>}

        {!loading && deals.length === 0 && (
          <div className="empty"><h3>No deals yet</h3><p>Accepted offers appear here.</p></div>
        )}

        {!loading && deals.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr><th>Tire</th><th>Accepted</th><th></th></tr>
              </thead>
              <tbody>
                {deals.map(d => {
                  const listing = d.offer?.request?.listing;
                  return (
                    <tr key={d.id}>
                      <td><strong>{listing?.size_raw ?? '—'}</strong> {listing?.brand ?? ''}</td>
                      <td style={{ fontSize: '.85rem', color: '#6b7280' }}>
                        {new Date(d.accepted_at).toLocaleDateString()}
                      </td>
                      <td>
                        <Link href={`/deals/${d.id}`} className="btn btn-secondary btn-sm">
                          Open chat →
                        </Link>
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
