'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import Navbar from '../../../components/Navbar';
import CountrySelect from '../../../components/CountrySelect';
import PreviewTable from '../../../components/import/PreviewTable';
import TemplateImport from '../../../components/import/TemplateImport';
import { api, ApiError } from '../../../lib/api';
import { SEGMENTS, TIRE_TYPES, Segment } from '../../../lib/tire-size';
import {
  AnalyzeResult, CommitResult, FIELD_LABELS, FieldType, MULTI_COLUMN, PreviewResult, PreviewRow, RowData,
} from '../../../lib/import-types';

type Step = 1 | 2 | 3 | 4;
const STEP_TITLES = ['File', 'Columns', 'Check rows', 'Import'];
const CONDITIONS = ['new', 'used', 'retreaded'];

// Smart import: upload any price list, map its columns, fix rows, import.
// Nothing is written until "Import" in step 4.
export default function ImportListingsPage() {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [segment, setSegment] = useState<Segment>('TBR');
  const [file, setFile] = useState<File | null>(null);
  const [defaults, setDefaults] = useState({ condition: 'new', location_country: '', location_region: '', tire_type: '' });
  const [updateMode, setUpdateMode] = useState<'update' | 'skip_existing'>('update');

  // Step 2
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [mapping, setMapping] = useState<Record<number, FieldType>>({});

  // Step 3
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [hints, setHints] = useState<string[]>([]);
  const [skippedEmpty, setSkippedEmpty] = useState(0);

  // Step 4
  const [check, setCheck] = useState<CommitResult | null>(null);
  const [deactivate, setDeactivate] = useState(false);
  const [report, setReport] = useState<CommitResult | null>(null);
  const [undone, setUndone] = useState(false);

  const counters = useMemo(() => countRows(rows), [rows]);
  const edited = rows.some((r) => r.edited);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Step 1 → 2 ───────────────────────────────────────────────────────────
  const analyze = (sheet?: string, headerRow?: number) => run(async () => {
    if (!file) throw new Error('Choose a file first');
    const fd = new FormData();
    fd.append('segment', segment);
    if (sheet) fd.append('sheet', sheet);
    if (headerRow !== undefined) fd.append('header_row', String(headerRow));
    fd.append('file', file);
    const a = await api.upload<AnalyzeResult>('/listings/import/analyze', fd);
    setAnalysis(a);
    setMapping(Object.fromEntries(a.columns.map((c) => [c.index, c.type])));
    setStep(2);
  });

  // ── Step 2 → 3 ───────────────────────────────────────────────────────────
  const mappingProblem = useMemo(() => {
    const used = Object.values(mapping);
    if (!used.includes('size')) return 'Choose the column with the tyre size.';
    const twice = used.find((t, i) => !MULTI_COLUMN.includes(t) && used.indexOf(t) !== i);
    if (twice) return `"${FIELD_LABELS[twice]}" is chosen for two columns.`;
    if (!used.includes('condition') && !defaults.condition) return 'Set a default condition in step 1 or map a condition column.';
    if (!used.includes('country') && !defaults.location_country) return 'Set a default stock country in step 1 or map a country column.';
    return '';
  }, [mapping, defaults]);

  const preview = () => run(async () => {
    if (!file || !analysis) return;
    const fd = new FormData();
    fd.append('options', JSON.stringify({
      segment,
      sheet: analysis.sheet,
      header_row: analysis.header_row,
      mapping,
      defaults: cleanDefaults(defaults),
      update_mode: updateMode,
    }));
    fd.append('file', file);
    const p = await api.upload<PreviewResult>('/listings/import/preview', fd);
    setRows(p.rows);
    setHints(p.hints);
    setSkippedEmpty(p.skipped_empty);
    setStep(3);
  });

  // ── Step 3: edits ────────────────────────────────────────────────────────
  function editRow(rowNumber: number, patch: Partial<RowData>, extra: Partial<PreviewRow> = {}) {
    setRows((all) => all.map((r) => (r.row === rowNumber ? { ...r, ...extra, data: { ...r.data, ...patch }, edited: true } : r)));
  }

  function bulk(field: 'condition' | 'location_country' | 'location_region' | 'tire_type', value: string, only: number[] | null) {
    const v = field === 'location_country' ? value.toUpperCase() : value;
    const set = only ? new Set(only) : null;
    setRows((all) => all.map((r) => (!set || set.has(r.row) ? { ...r, data: { ...r.data, [field]: v }, edited: true } : r)));
  }

  async function commitRequest(dryRun: boolean): Promise<CommitResult> {
    return api.post<CommitResult>('/listings/import/commit', {
      segment,
      update_mode: updateMode,
      dry_run: dryRun,
      rows: rows.map((r) => ({ row: r.row, data: outgoing(r.data), unrecognized: r.unrecognized })),
      ...(deactivate && !dryRun
        ? { deactivate_missing: true, expected_deactivate: check?.summary.missing ?? 0 }
        : {}),
      ...(dryRun || !analysis?.header_row
        ? {}
        : { header_signature: analysis.header_signature, mapping, header_row: analysis.header_row }),
    });
  }

  // Server re-check of all rows (the same checks as the import itself)
  const recheck = (then?: () => void) => run(async () => {
    const c = await commitRequest(true);
    const byRow = new Map((c.rows ?? []).map((r) => [r.row, r]));
    setRows((all) => all.map((r) => {
      const fresh = byRow.get(r.row);
      if (!fresh) return r;
      // Rows not touched keep the notes from reading the file (brand typos etc.)
      const messages = r.edited ? fresh.messages : dedupe([...r.messages, ...fresh.messages]);
      const status = messages.some((m) => m.level === 'error') ? 'error' : messages.length ? 'warning' : 'ok';
      return { ...r, messages, status, action: fresh.action, edited: false };
    }));
    setCheck(c);
    then?.();
  });

  // ── Step 4 ───────────────────────────────────────────────────────────────
  const doImport = () => run(async () => {
    setReport(await commitRequest(false));
  });

  const undo = () => run(async () => {
    if (!report?.batch_id) return;
    if (!confirm('Undo this import? New listings are removed and updated ones get their previous values back.')) return;
    await api.post(`/listings/import/batches/${report.batch_id}/undo`);
    setUndone(true);
  });

  function downloadErrors() {
    if (!report?.errors_csv) return;
    const url = URL.createObjectURL(new Blob([report.errors_csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-errors.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function restart() {
    setStep(1); setFile(null); setAnalysis(null); setRows([]); setCheck(null); setReport(null); setUndone(false); setDeactivate(false); setError('');
  }

  const types = TIRE_TYPES[segment] ?? [];
  const toImport = check ? check.summary.new + check.summary.update : 0;

  return (
    <>
      <Navbar />
      <div className="container page">
        <div className="page-header">
          <h1>Import listings</h1>
          <Link href="/listings" className="btn btn-secondary btn-sm">← My listings</Link>
        </div>

        <ol className="import-steps">
          {STEP_TITLES.map((t, i) => (
            <li key={t} className={step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}>{i + 1}. {t}</li>
          ))}
        </ol>

        {error && <div className="alert alert-error">{error}</div>}

        {step === 1 && (
          <div className="card">
            <div className="import-grid">
              <div className="form-group">
                <label>Segment of this file</label>
                <select className="form-control" value={segment}
                  onChange={(e) => { setSegment(e.target.value as Segment); setDefaults((d) => ({ ...d, tire_type: '' })); }}>
                  {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="form-hint">Every row gets this segment. A file with several segments: upload it once per segment.</div>
              </div>
              <div className="form-group">
                <label>Tyre type (when the file has no type column)</label>
                <select className="form-control" value={defaults.tire_type} disabled={!types.length}
                  onChange={(e) => setDefaults((d) => ({ ...d, tire_type: e.target.value }))}>
                  <option value="">{types.length ? 'Not set' : 'Not used for this segment'}</option>
                  {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Condition (when not in the file)</label>
                <select className="form-control" value={defaults.condition}
                  onChange={(e) => setDefaults((d) => ({ ...d, condition: e.target.value }))}>
                  <option value="">Not set</option>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Stock country (when not in the file)</label>
                <CountrySelect value={defaults.location_country}
                  onChange={(code) => setDefaults((d) => ({ ...d, location_country: code }))} />
              </div>
              <div className="form-group">
                <label>Stock region (optional)</label>
                <input className="form-control" value={defaults.location_region} maxLength={100}
                  onChange={(e) => setDefaults((d) => ({ ...d, location_region: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Listings you already have</label>
                <select className="form-control" value={updateMode}
                  onChange={(e) => setUpdateMode(e.target.value as 'update' | 'skip_existing')}>
                  <option value="update">Update them from the file</option>
                  <option value="skip_existing">Leave them as they are</option>
                </select>
                <div className="form-hint">Matched by your SKU, otherwise by brand + pattern + size + year.</div>
              </div>
            </div>
            <div className="form-group">
              <label>File (.xlsx or .csv, up to 5 MB and 5000 rows)</label>
              <input type="file" className="form-control" accept=".xlsx,.csv,.txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <div className="form-hint">
                Any layout: we find the header row and the columns, and read sizes written together with brand, load index or quantity.
              </div>
            </div>
            <button className="btn btn-primary" disabled={!file || busy} onClick={() => analyze()}>
              {busy ? 'Reading…' : 'Next: columns →'}
            </button>

            <details className="import-fallback">
              <summary>Use the fixed template instead</summary>
              <TemplateImport />
            </details>
          </div>
        )}

        {step === 2 && analysis && (
          <div className="card">
            {analysis.saved_mapping && <div className="alert alert-info">Using your saved mapping for files with these headers.</div>}
            <div className="import-grid">
              {analysis.sheets.length > 1 && (
                <div className="form-group">
                  <label>Sheet</label>
                  <select className="form-control" value={analysis.sheet} disabled={busy}
                    onChange={(e) => analyze(e.target.value)}>
                    {analysis.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rows} rows)</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Header row</label>
                <input type="number" min={0} className="form-control" defaultValue={analysis.header_row} key={analysis.header_row}
                  disabled={busy}
                  onBlur={(e) => {
                    const n = Math.max(0, parseInt(e.target.value || '0', 10));
                    if (n !== analysis.header_row) analyze(analysis.sheet, n);
                  }} />
                <div className="form-hint">0 = the file has no header row. {analysis.data_rows} rows below it.</div>
              </div>
            </div>

            <div className="import-table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Column</th><th>Sample values</th><th>Read as</th><th>Confidence</th></tr>
                </thead>
                <tbody>
                  {analysis.columns.map((c) => (
                    <tr key={c.index}>
                      <td><strong>{c.header || `Column ${c.index + 1}`}</strong></td>
                      <td className="import-samples">
                        {c.samples.map((s, i) => <code key={i}>{s}</code>)}
                        {c.glued && mapping[c.index] === 'size' && (
                          <div className="form-hint">Brand, load index, quantity and more are also read out of these cells.</div>
                        )}
                      </td>
                      <td>
                        <select className="form-control" style={{ minWidth: 170 }} value={mapping[c.index] ?? 'ignore'}
                          onChange={(e) => setMapping((m) => ({ ...m, [c.index]: e.target.value as FieldType }))}>
                          {(Object.keys(FIELD_LABELS) as FieldType[]).map((t) => <option key={t} value={t}>{FIELD_LABELS[t]}</option>)}
                        </select>
                      </td>
                      <td>
                        <span className={`import-confidence ${c.confidence >= 0.75 ? 'high' : c.confidence >= 0.45 ? 'mid' : 'low'}`}>
                          {Math.round(c.confidence * 100)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mappingProblem && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{mappingProblem}</div>}
            <div className="import-actions">
              <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button className="btn btn-primary" disabled={!!mappingProblem || busy} onClick={preview}>
                {busy ? 'Reading rows…' : 'Next: check rows →'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="card">
            {hints.map((h) => <div key={h} className="alert alert-info">{h}</div>)}
            <div className="import-counters">
              <span className="import-status import-status-ok">{counters.ok} ok</span>
              <span className="import-status import-status-warning">{counters.warning} with warnings</span>
              <span className="import-status import-status-error">{counters.error} with errors</span>
              <span>
                · {counters.new} new · {counters.update} updates · {counters.unchanged} unchanged
                {counters.skip ? ` · ${counters.skip} existing, left alone` : ''}
              </span>
              {skippedEmpty > 0 && <span className="form-hint">· {skippedEmpty} empty rows skipped</span>}
              {edited && <span className="form-hint">· edited rows are checked again before the import</span>}
            </div>
            <PreviewTable rows={rows} segment={segment} onEdit={editRow} onBulk={bulk} />
            <div className="import-actions">
              <button className="btn btn-secondary" onClick={() => setStep(2)}>← Back</button>
              {edited && <button className="btn btn-secondary" disabled={busy} onClick={() => recheck()}>Check edited rows</button>}
              <button className="btn btn-primary" disabled={busy} onClick={() => recheck(() => setStep(4))}>
                {busy ? 'Checking…' : 'Next: summary →'}
              </button>
            </div>
          </div>
        )}

        {step === 4 && check && !report && (
          <div className="card">
            <h3>Ready to import</h3>
            <p className="import-summary">
              <strong>{check.summary.new}</strong> new, <strong>{check.summary.update}</strong> updated,{' '}
              <strong>{check.summary.unchanged + check.summary.skip}</strong> unchanged,{' '}
              <strong>{check.summary.errors}</strong> with errors skipped.
            </p>
            {check.summary.missing > 0 && (
              <label className="import-check">
                <input type="checkbox" checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} />
                Also deactivate my {check.summary.missing} active {segment} listing{check.summary.missing !== 1 ? 's' : ''} that
                this file does not mention
              </label>
            )}
            <div className="import-actions">
              <button className="btn btn-secondary" onClick={() => setStep(3)}>← Back to rows</button>
              <button className="btn btn-primary" disabled={busy || (toImport === 0 && !deactivate)} onClick={doImport}>
                {busy ? 'Importing…' : `Import ${toImport} rows`}
              </button>
            </div>
          </div>
        )}

        {step === 4 && report && (
          <div className="card">
            <h3>{undone ? 'Import undone' : 'Import finished'}</h3>
            {undone ? (
              <p>Your listings are back to how they were before this import.</p>
            ) : (
              <p className="import-summary">
                <strong>{report.counts.created}</strong> created, <strong>{report.counts.updated}</strong> updated,{' '}
                <strong>{report.counts.unchanged}</strong> unchanged
                {report.counts.deactivated ? <>, <strong>{report.counts.deactivated}</strong> deactivated</> : null},{' '}
                <strong>{report.counts.skipped}</strong> rows with errors not imported.
              </p>
            )}
            <div className="import-actions">
              {report.errors_csv && <button className="btn btn-secondary" onClick={downloadErrors}>Download errors (.csv)</button>}
              {!undone && report.batch_id && (
                <button className="btn btn-danger" disabled={busy} onClick={undo}>Undo import</button>
              )}
              <Link href="/listings" className="btn btn-primary">Go to my listings</Link>
              <button className="btn btn-secondary" onClick={restart}>Import another file</button>
            </div>
            {!undone && <div className="form-hint">An import can be undone within 24 hours.</div>}
          </div>
        )}
      </div>
    </>
  );
}

function cleanDefaults(d: Record<string, string>) {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v));
}

// Values typed in the table, in the types the API expects
function outgoing(d: RowData): RowData {
  const out: RowData = { ...d };
  for (const k of Object.keys(out) as (keyof RowData)[]) {
    if (out[k] === '' || out[k] === undefined) delete out[k];
  }
  if (typeof out.price === 'string') {
    const n = Number(String(out.price).replace(',', '.'));
    if (!Number.isNaN(n)) out.price = n;
  }
  if (out.additional_sizes && !out.additional_sizes.length) delete out.additional_sizes;
  return out;
}

function countRows(rows: PreviewRow[]): Record<string, number> {
  const c: Record<string, number> = { ok: 0, warning: 0, error: 0, new: 0, update: 0, unchanged: 0, skip: 0 };
  for (const r of rows) {
    c[r.status]++;
    if (r.action && r.status !== 'error') c[r.action]++;
  }
  return c;
}

function dedupe<T extends { level: string; text: string }>(messages: T[]): T[] {
  const seen = new Set<string>();
  return messages.filter((m) => (seen.has(m.level + m.text) ? false : (seen.add(m.level + m.text), true)));
}
