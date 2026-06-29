'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import TireInfo, { TireListing } from '../../components/TireInfo';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';

interface Company { id: string; name: string; country: string; }

interface Deal {
  id: string;
  accepted_at: string;
  status: 'pending_pickup' | 'completed';
  completed_at?: string | null;
  offer?: {
    price?: number;
    currency?: string;
    request?: {
      qty_requested?: number;
      buyer_company_id?: string;
      buyer_company?: Company;
      listing?: TireListing & { company_id?: string; company?: Company };
    };
  };
}

export default function DealsPage() {
  const { user } = useAuth();
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
              const request = d.offer?.request;
              const listing = request?.listing;
              const qty = request?.qty_requested;
              const sellerCompany = listing?.company;
              const buyerCompany = request?.buyer_company;
              const isSeller = user?.company_id === listing?.company_id;

              return (
                <div key={d.id} className="card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                    {listing
                      ? <TireInfo listing={listing} qty={qty} />
                      : <span style={{ color: '#6b7280' }}>—</span>}

                    {/* Participants */}
                    {(sellerCompany || buyerCompany) && (
                      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '.8rem', flexWrap: 'wrap',
                        paddingTop: '.5rem', borderTop: '1px solid #f3f4f6' }}>
                        {sellerCompany && (
                          <div>
                            <span style={{ color: '#9ca3af', marginRight: '.3rem' }}>Seller:</span>
                            <strong>{sellerCompany.name}</strong>
                            {isSeller && <span style={{ marginLeft: '.3rem', color: '#1a56db', fontSize: '.75rem' }}>(you)</span>}
                          </div>
                        )}
                        {buyerCompany && (
                          <div>
                            <span style={{ color: '#9ca3af', marginRight: '.3rem' }}>Buyer:</span>
                            <strong>{buyerCompany.name}</strong>
                            {!isSeller && <span style={{ marginLeft: '.3rem', color: '#1a56db', fontSize: '.75rem' }}>(you)</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                    gap: '.5rem', flexShrink: 0, minWidth: 140 }}>
                    {d.offer?.price != null && (
                      <span style={{ fontWeight: 600, color: '#059669', fontSize: '.9rem' }}>
                        {d.offer.price.toLocaleString()} {d.offer.currency ?? 'EUR'}
                      </span>
                    )}
                    {/* Status badge */}
                    {d.status === 'completed'
                      ? <span className="badge badge-new">✓ Received</span>
                      : <span className="badge badge-pending">Awaiting pickup</span>}
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
