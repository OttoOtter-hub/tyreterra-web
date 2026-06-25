'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import { api } from '../../lib/api';

interface Listing {
  id: string; segment: string; size_raw: string; brand: string;
  qty: number; condition: string; status: string; expires_at: string; created_at: string;
}

export default function MyListingsPage() {
  const [listings, setListings] = useState<{ data: Listing[] }>({ data: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: Listing[] }>('/listings?limit=100')
      .then(setListings).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const deactivate = async (id: string) => {
    await api.delete(`/listings/${id}`);
    setListings(prev => ({ data: prev.data.filter(l => l.id !== id) }));
  };

  return (
    <>
      <Navbar />
      <div className="container page">
        <div className="page-header">
          <h1>My Listings</h1>
          <Link href="/listings/new" className="btn btn-primary">+ New listing</Link>
        </div>

        {loading && <div className="loading">Loading…</div>}

        {!loading && listings.data.length === 0 && (
          <div className="empty">
            <h3>No active listings</h3>
            <p style={{ marginBottom: '1rem' }}>Create your first listing to start receiving requests.</p>
            <Link href="/listings/new" className="btn btn-primary">Create listing</Link>
          </div>
        )}

        {!loading && listings.data.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Size</th><th>Brand</th><th>Segment</th>
                  <th>Qty</th><th>Condition</th><th>Status</th><th>Expires</th><th></th>
                </tr>
              </thead>
              <tbody>
                {listings.data.map(l => (
                  <tr key={l.id}>
                    <td><strong>{l.size_raw}</strong></td>
                    <td>{l.brand}</td>
                    <td><span className={`badge badge-${l.segment.toLowerCase()}`}>{l.segment}</span></td>
                    <td>{l.qty}</td>
                    <td>{l.condition}</td>
                    <td><span className={`badge badge-${l.status}`}>{l.status}</span></td>
                    <td style={{ fontSize: '.8rem', color: '#6b7280' }}>{new Date(l.expires_at).toLocaleDateString()}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => deactivate(l.id)}>
                        Deactivate
                      </button>
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
