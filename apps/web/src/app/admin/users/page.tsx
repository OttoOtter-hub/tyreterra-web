'use client';
import { useState, useEffect } from 'react';
import Navbar from '../../../components/Navbar';
import { api } from '../../../lib/api';

interface PendingUser {
  id: string; email: string; role: string; created_at: string;
  company?: { name: string; country: string; vat_number: string | null };
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get<PendingUser[]>('/admin/users/pending')
      .then(setUsers).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const approve = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/admin/users/${id}/approve`, { action: 'approve' });
      setUsers(u => u.filter(x => x.id !== id));
    } finally { setActing(null); }
  };

  const reject = async (id: string) => {
    const reason = rejectReason[id];
    if (!reason?.trim()) { alert('Please enter a rejection reason'); return; }
    setActing(id);
    try {
      await api.post(`/admin/users/${id}/approve`, { action: 'reject', reason });
      setUsers(u => u.filter(x => x.id !== id));
    } finally { setActing(null); }
  };

  return (
    <>
      <Navbar />
      <div className="container page">
        <div className="page-header">
          <h1>Pending Approvals</h1>
          <span style={{ color: '#6b7280', fontSize: '.9rem' }}>{users.length} pending</span>
        </div>

        {loading && <div className="loading">Loading…</div>}
        {!loading && users.length === 0 && <div className="empty"><h3>No pending users</h3></div>}

        {users.map(u => (
          <div key={u.id} className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '.75rem' }}>
              <div>
                <strong>{u.email}</strong>
                <span className="badge badge-pending" style={{ marginLeft: '.5rem' }}>{u.role}</span>
                <div style={{ fontSize: '.85rem', color: '#6b7280', marginTop: '.25rem' }}>
                  {u.company?.name} · {u.company?.country}
                  {u.company?.vat_number && <> · VAT: {u.company.vat_number}</>}
                </div>
                <div style={{ fontSize: '.75rem', color: '#9ca3af', marginTop: '.2rem' }}>
                  Registered {new Date(u.created_at).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  className="form-control"
                  style={{ width: 220, fontSize: '.85rem' }}
                  placeholder="Rejection reason (required to reject)"
                  value={rejectReason[u.id] ?? ''}
                  onChange={e => setRejectReason(r => ({ ...r, [u.id]: e.target.value }))}
                />
                <button className="btn btn-primary btn-sm" disabled={acting === u.id} onClick={() => approve(u.id)}>
                  Approve
                </button>
                <button className="btn btn-danger btn-sm" disabled={acting === u.id} onClick={() => reject(u.id)}>
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
