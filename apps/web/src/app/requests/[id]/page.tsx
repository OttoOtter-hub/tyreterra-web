'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../contexts/AuthContext';
import { api } from '../../../lib/api';

interface RequestDetail {
  id: string; qty_requested: number; comment: string | null; status: string;
  buyer_company_id: string;
  listing: { id: string; size_raw: string; brand: string; segment: string; company_id: string };
  offer?: { price: number; currency: string; terms_text: string | null; status: string } | null;
}

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [req, setReq] = useState<RequestDetail | null>(null);
  const [offerData, setOfferData] = useState<{ price: number; currency: string; terms_text: string | null } | null>(null);
  const [form, setForm] = useState({ price: '', currency: 'EUR', terms_text: '' });
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [dealResult, setDealResult] = useState<{ deal_id: string; seller: { company_name: string; email: string | null }; buyer: { company_name: string; email: string | null } } | null>(null);

  useEffect(() => {
    api.get<RequestDetail>(`/requests/${id}`)
      .then(async (r) => {
        setReq(r);
        if (r.status === 'offered' && r.buyer_company_id === user?.company_id) {
          const o = await api.get<{ price: number; currency: string; terms_text: string | null }>(`/requests/${id}/offer`);
          setOfferData(o);
        }
      })
      .catch(() => setError('Request not found'))
      .finally(() => setLoading(false));
  }, [id, user]);

  const act = async (fn: () => Promise<unknown>, onDone?: (res: unknown) => void) => {
    setActing(true); setError('');
    try { const r = await fn(); onDone?.(r); }
    catch (e) { setError((e as Error).message); }
    finally { setActing(false); }
  };

  if (loading) return <><Navbar /><div className="container page loading">Loading…</div></>;
  if (!req) return <><Navbar /><div className="container page"><div className="alert alert-error">{error || 'Not found'}</div></div></>;

  const isSeller = req.listing.company_id === user?.company_id;
  const isBuyer = req.buyer_company_id === user?.company_id;

  return (
    <>
      <Navbar />
      <div className="container page" style={{ maxWidth: 640 }}>
        <div className="page-header">
          <h1>Request — {req.listing.size_raw}</h1>
          <span className={`badge badge-${req.status === 'accepted' ? 'new' : req.status === 'pending' ? 'pending' : 'blocked'}`}>{req.status}</span>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {dealResult && (
          <div className="alert alert-success">
            Deal accepted! <strong>{dealResult.seller.company_name}</strong> (seller) ↔ <strong>{dealResult.buyer.company_name}</strong> (buyer)
            {dealResult.seller.email && <><br />Seller email: {dealResult.seller.email}</>}
            {dealResult.buyer.email && <><br />Buyer email: {dealResult.buyer.email}</>}
            <br /><a href={`/deals/${dealResult.deal_id}`}>Go to deal chat →</a>
          </div>
        )}

        <div className="card" style={{ marginBottom: '1rem' }}>
          <p><strong>Listing:</strong> {req.listing.brand} {req.listing.size_raw} [{req.listing.segment}]</p>
          <p><strong>Quantity requested:</strong> {req.qty_requested}</p>
          {req.comment && <p><strong>Comment:</strong> {req.comment}</p>}
        </div>

        {/* Seller: pending → send offer or decline */}
        {isSeller && req.status === 'pending' && (
          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>Respond to request</h3>
            <div className="form-group">
              <label>Price *</label>
              <input className="form-control" type="number" min={0.01} step={0.01}
                value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Currency</label>
              <select className="form-control" value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                <option>EUR</option><option>USD</option><option>GBP</option>
              </select>
            </div>
            <div className="form-group">
              <label>Terms / Notes</label>
              <input className="form-control" value={form.terms_text}
                onChange={e => setForm(f => ({ ...f, terms_text: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', gap: '.75rem' }}>
              <button className="btn btn-primary" disabled={acting || !form.price}
                onClick={() => act(() => api.post(`/requests/${id}/offer`, { price: parseFloat(form.price), currency: form.currency, terms_text: form.terms_text || undefined }), () => router.refresh())}>
                Send offer
              </button>
              <button className="btn btn-danger" disabled={acting}
                onClick={() => act(() => api.post(`/requests/${id}/decline`), () => router.refresh())}>
                Decline
              </button>
            </div>
          </div>
        )}

        {/* Buyer: offered → view price and accept/reject */}
        {isBuyer && req.status === 'offered' && offerData && (
          <div className="card">
            <h3 style={{ marginBottom: '1rem' }}>Offer received</h3>
            <p><strong>Price:</strong> {offerData.price.toLocaleString()} {offerData.currency}</p>
            {offerData.terms_text && <p><strong>Terms:</strong> {offerData.terms_text}</p>}
            <div style={{ display: 'flex', gap: '.75rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" disabled={acting}
                onClick={() => act(() => api.post(`/requests/${id}/offer/accept`), (res) => setDealResult(res as typeof dealResult))}>
                Accept offer
              </button>
              <button className="btn btn-danger" disabled={acting}
                onClick={() => act(() => api.post(`/requests/${id}/offer/reject`), () => router.refresh())}>
                Reject offer
              </button>
            </div>
          </div>
        )}

        {/* Cancel button for buyer */}
        {isBuyer && ['pending', 'offered'].includes(req.status) && (
          <div style={{ marginTop: '1rem' }}>
            <button className="btn btn-secondary btn-sm" disabled={acting}
              onClick={() => act(() => api.delete(`/requests/${id}`), () => router.push('/requests'))}>
              Cancel request
            </button>
          </div>
        )}
      </div>
    </>
  );
}
