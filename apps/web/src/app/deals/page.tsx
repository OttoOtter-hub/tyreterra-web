'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import TireInfo, { TireListing } from '../../components/TireInfo';
import { api } from '../../lib/api';

interface Deal {
  id: string;
  accepted_at: string;
  offer?: {
    price?: number;
    currency?: string;
    request?: {
      qty_requested?: number;
      listing?: TireListing;
    };
  };
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {deals.map(d => {
              const listing = d.offer?.request?.listing;
              const qty = d.offer?.request?.qty_requested;
              return (
                <div key={d.id} className="card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    {listing
                      ? <TireInfo listing={listing} qty={qty} />
                      : <span style={{ color: '#6b7280' }}>—</span>}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                    gap: '.5rem', flexShrink: 0, minWidth: 130 }}>
                    {d.offer?.price != null && (
                      <span style={{ fontWeight: 600, color: '#059669', fontSize: '.9rem' }}>
                        {d.offer.price.toLocaleString()} {d.offer.currency ?? 'EUR'}
                      </span>
                    )}
                    <span style={{ fontSize: '.78rem', color: '#9ca3af' }}>
                      {new Date(d.accepted_at).toLocaleDateString()}
                    </span>
                    <Link href={`/deals/${d.id}`} className="btn btn-secondary btn-sm">
                      Open chat →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
