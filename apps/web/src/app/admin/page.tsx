'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';

interface Kpi { activeListings: number; pendingUsers: number; requestsToday: number; dealsThisWeek: number; newSignupsToday: number; }

function KpiCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '2rem', fontWeight: 700, color: accent ? '#e02424' : '#1a56db' }}>{value}</div>
      <div style={{ fontSize: '.8rem', color: '#6b7280', marginTop: '.25rem' }}>{label}</div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [kpi, setKpi] = useState<Kpi | null>(null);

  useEffect(() => {
    if (!authLoading && user?.role !== 'admin') router.replace('/catalogue');
  }, [user, authLoading, router]);

  useEffect(() => {
    api.get<Kpi>('/admin/dashboard').then(setKpi).catch(() => {});
  }, []);

  return (
    <>
      <Navbar />
      <div className="container page">
        <div className="page-header">
          <h1>Admin Dashboard</h1>
          <Link href="/admin/users" className="btn btn-secondary">User queue</Link>
        </div>

        {kpi && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <KpiCard label="Active listings" value={kpi.activeListings} />
            <KpiCard label="Pending approvals" value={kpi.pendingUsers} accent={kpi.pendingUsers > 0} />
            <KpiCard label="Requests today" value={kpi.requestsToday} />
            <KpiCard label="Deals this week" value={kpi.dealsThisWeek} />
            <KpiCard label="New signups today" value={kpi.newSignupsToday} />
          </div>
        )}

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link href="/admin/users" className="btn btn-primary">User approval queue</Link>
          <Link href="/admin/audit" className="btn btn-secondary">Audit log</Link>
        </div>
      </div>
    </>
  );
}
