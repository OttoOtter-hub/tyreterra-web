'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '../../../components/Navbar';
import { api } from '../../../lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function ImportListingsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: { row: number; message: string }[] } | null>(null);
  const [error, setError] = useState('');

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Select a file first'); return; }
    setUploading(true); setError(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload<{ imported: number; errors: { row: number; message: string }[] }>(
        '/listings/import', fd,
      );
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function downloadTemplate() {
    const token = localStorage.getItem('tt_token');
    const a = document.createElement('a');
    a.href = `${API_BASE}/listings/import/template`;
    if (token) {
      // Fetch with auth header and trigger download
      fetch(a.href, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.blob())
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'tyreterra-import-template.xlsx';
          link.click();
          URL.revokeObjectURL(url);
        });
    }
  }

  return (
    <>
      <Navbar />
      <div className="container page" style={{ maxWidth: 600 }}>
        <div className="page-header">
          <h1>Import Listings</h1>
        </div>

        <div className="card" style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ marginBottom: '.75rem' }}>Step 1 — Download template</h3>
          <p style={{ color: '#6b7280', fontSize: '.9rem', marginBottom: '1rem' }}>
            Fill in the template and upload it. Do not change the column headers.
          </p>
          <button className="btn btn-secondary" onClick={downloadTemplate}>
            ⬇ Download template (.xlsx)
          </button>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '.75rem' }}>Step 2 — Upload filled file</h3>
          {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
          {result && (
            <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
              ✅ {result.imported} listing{result.imported !== 1 ? 's' : ''} imported successfully.
            </div>
          )}
          <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls"
              style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '.4rem .6rem', fontSize: '.9rem' }} />
            <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>
              {uploading ? 'Uploading…' : '⬆ Upload'}
            </button>
          </div>

          <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#f9fafb', borderRadius: 8, fontSize: '.85rem', color: '#6b7280' }}>
            <strong style={{ color: '#374151' }}>Required columns:</strong>
            <ul style={{ marginTop: '.4rem', paddingLeft: '1.2rem', lineHeight: 1.7 }}>
              <li><strong>segment</strong> — TBR / PCR / OTR / AGRI / MH</li>
              <li><strong>brand</strong> — e.g. Michelin</li>
              <li><strong>size</strong> — e.g. 315/80R22.5</li>
              <li><strong>qty</strong> — integer ≥ 1</li>
              <li><strong>condition</strong> — new / used / retreaded</li>
              <li><strong>location_country</strong> — 2-letter ISO code (DE, PL…)</li>
            </ul>
            <strong style={{ color: '#374151' }}>Optional:</strong> sku, type, pattern, load_index, origin_country, year, region
          </div>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => router.push('/listings')}>
            ← Back to My Listings
          </button>
        </div>
      </div>
    </>
  );
}
