'use client';
import { useRef, useState } from 'react';
import { api } from '../../lib/api';

// The strict template upload (fixed columns), kept as a fallback next to the smart import
export default function TemplateImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ imported: number } | null>(null);
  const [error, setError] = useState('');

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Select a file first'); return; }
    setUploading(true); setError(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setResult(await api.upload<{ imported: number }>('/listings/import', fd));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function downloadTemplate() {
    api.download('/listings/import/template', 'tyreterra-import-template.xlsx')
      .catch(e => setError((e as Error).message));
  }

  return (
    <div>
      <p className="form-hint" style={{ marginBottom: '.75rem' }}>
        Fill in our template without changing its column headers, then upload it. Columns: segment, brand, size,
        Alt size (several separated by ;), qty, condition, location_country; optional sku, type, pattern, load_index,
        origin_country, year, region.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {result && (
        <div className="alert alert-success">
          {result.imported} listing{result.imported !== 1 ? 's' : ''} imported.
        </div>
      )}
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={downloadTemplate}>Download template (.xlsx)</button>
        <input ref={fileRef} type="file" accept=".xlsx" className="form-control" style={{ maxWidth: 260 }} />
        <button className="btn btn-secondary btn-sm" onClick={handleUpload} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload template'}
        </button>
      </div>
    </div>
  );
}
