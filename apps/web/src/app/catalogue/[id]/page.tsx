'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navbar from '../../../components/Navbar';
import { api } from '../../../lib/api';

interface ListingDetail {
  id: string;
  segment: string;
  size_raw: string;
  brand: string;
  pattern: string | null;
  qty: number;
  condition: string;
  location_country: string;
  location_region: string | null;
  load_index: string | null;
  origin_country: string | null;
  dot_code: string | null;
  seller_country: string | null;
  seller_rating: number | null;
  created_at: string;
  expires_at: string;
}

function Stars({ score }: { score: number | null | undefined }) {
  if (score == null) return <span style={{ color: '#9ca3af' }}>New member</span>;
  const full = Math.floor(score);
  const half = score % 1 >= 0.5;
  return (
    <span title={`${score} / 5`}>
      {'★'.repeat(full)}{half ? '½' : ''}{'☆'.repeat(5 - full - (half ? 1 : 0))}
      <span style={{ fontSize: '.8rem', color: '#6b7280', marginLeft: '.25rem' }}>{score.toFixed(1)}</span>
    </span>
  );
}

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<ListingDetail>(`/listings/${id}`)
      .then(setListing)
      .catch(() => setError('Listing not found'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const qtyNum = parseInt(qty, 10);
    if (!qtyNum || qtyNum < 1) { setError('Enter quantity'); return; }
    if (listing && qtyNum > listing.qty) { setError(`Max available: ${listing.qty}`); return; }
    setSubmitting(true); setError('');
    try {
      const req = await api.post<{ id: string }>('/requests', {
        listing_id: id,
        qty_requested: qtyNum,
        comment: comment.trim() || undefined,
      });
      router.push(`/requests/${req.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  if (loading) return <><Navbar /><div className="container page loading">Loading…</div></>;
  if (!listing) return <><Navbar /><div className="container page"><div className="alert alert-error">{error || 'Not found'}</div></div></>;

  return (
    <>
      <Navbar />
      <div className="container page" style={{ maxWidth: 680 }}>
        <button className="btn btn-secondary btn-sm" style={{ marginBottom: '1rem' }}
          onClick={() => router.back()}>← Back</button>

        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{listing.size_raw}</div>
              <div style={{ color: '#6b7280', marginTop: '.2rem' }}>
                {listing.brand}{listing.pattern ? ` · ${listing.pattern}` : ''}
              </div>
            </div>
            <span className={`badge badge-${listing.segment.toLowerCase()}`}>{listing.segment}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem .75rem', fontSize: '.9rem' }}>
            <div><span style={{ color: '#6b7280' }}>Condition:</span> <strong>{listing.condition}</strong></div>
            <div><span style={{ color: '#6b7280' }}>Available:</span> <strong>{listing.qty} pcs</strong></div>
            <div><span style={{ color: '#6b7280' }}>Location:</span> <strong>{listing.location_country}{listing.location_region ? ` / ${listing.location_region}` : ''}</strong></div>
            {listing.origin_country && (
              <div><span style={{ color: '#6b7280' }}>Origin:</span> <strong>{listing.origin_country}</strong></div>
            )}
            {listing.load_index && (
              <div><span style={{ color: '#6b7280' }}>Load index:</span> <strong>{listing.load_index}</strong></div>
            )}
            {listing.dot_code && (
              <div><span style={{ color: '#6b7280' }}>Year:</span> <strong>{listing.dot_code}</strong></div>
            )}
            <div><span style={{ color: '#6b7280' }}>Seller:</span> <Stars score={listing.seller_rating} /></div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1rem' }}>Send Request</h3>
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleRequest}>
            <div className="form-group">
              <label>Quantity *</label>
              <input className="form-control" type="number" min={1} max={listing.qty}
                value={qty} onChange={e => setQty(e.target.value)}
                placeholder={`1 – ${listing.qty}`} required style={{ maxWidth: 160 }} />
            </div>
            <div className="form-group">
              <label>Comment</label>
              <input className="form-control" value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Delivery terms, region, etc. (optional)" maxLength={500} />
            </div>
            <div style={{ display: 'flex', gap: '.75rem', marginTop: '.5rem' }}>
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send Request'}
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => router.back()}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
