'use client';
import { ReactElement, useMemo, useState } from 'react';
import { TIRE_TYPES, Segment } from '../../lib/tire-size';
import { PreviewRow, RowData } from '../../lib/import-types';

const PAGE_SIZE = 100;
const CONDITIONS = ['new', 'used', 'retreaded'];

type BulkField = 'condition' | 'location_country' | 'location_region' | 'tire_type';
const BULK_LABELS: Record<BulkField, string> = {
  condition: 'Condition',
  location_country: 'Stock country (2 letters)',
  location_region: 'Stock region',
  tire_type: 'Tyre type',
};

interface Props {
  rows: PreviewRow[];
  segment: Segment;
  onEdit: (rowNumber: number, patch: Partial<RowData>, extra?: Partial<PreviewRow>) => void;
  onBulk: (field: BulkField, value: string, onlyRows: number[] | null) => void;
}

// The rows in our model, editable in place. Paged (100 per page) so a
// 5000-row file stays fast; "only problematic" shows warnings and errors.
export default function PreviewTable({ rows, segment, onEdit, onBulk }: Props) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [page, setPage] = useState(0);
  const [bulkField, setBulkField] = useState<BulkField>('condition');
  const [bulkValue, setBulkValue] = useState('');

  const shown = useMemo(
    () => (onlyProblems ? rows.filter((r) => r.status !== 'ok') : rows),
    [rows, onlyProblems],
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const pageRows = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const types = TIRE_TYPES[segment] ?? [];

  const text = (r: PreviewRow, field: keyof RowData, width = 90) => (
    <input
      className={`cell-input${fieldHasError(r, field) ? ' error' : ''}`}
      style={{ width }}
      value={(r.data[field] as string | number | undefined) ?? ''}
      onChange={(e) => onEdit(r.row, { [field]: e.target.value || undefined } as Partial<RowData>)}
    />
  );

  return (
    <div>
      <div className="import-toolbar">
        <label className="import-check">
          <input type="checkbox" checked={onlyProblems} onChange={(e) => { setOnlyProblems(e.target.checked); setPage(0); }} />
          Only problematic rows
        </label>
        <div className="import-bulk">
          <span>Set</span>
          <select className="form-control" value={bulkField} onChange={(e) => { setBulkField(e.target.value as BulkField); setBulkValue(''); }}>
            {(Object.keys(BULK_LABELS) as BulkField[])
              .filter((f) => f !== 'tire_type' || types.length)
              .map((f) => <option key={f} value={f}>{BULK_LABELS[f]}</option>)}
          </select>
          {bulkField === 'condition' ? (
            <select className="form-control" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
              <option value="">—</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : bulkField === 'tire_type' ? (
            <select className="form-control" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
              <option value="">—</option>
              {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          ) : (
            <input className="form-control" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
              maxLength={bulkField === 'location_country' ? 2 : 100} />
          )}
          <button className="btn btn-secondary btn-sm" disabled={!bulkValue} onClick={() => onBulk(bulkField, bulkValue, null)}>
            for all rows
          </button>
          {onlyProblems && (
            <button className="btn btn-secondary btn-sm" disabled={!bulkValue}
              onClick={() => onBulk(bulkField, bulkValue, shown.map((r) => r.row))}>
              for shown rows
            </button>
          )}
        </div>
      </div>

      <div className="import-table-wrap">
        <table className="table import-table">
          <thead>
            <tr>
              <th>Row</th><th>Status</th><th>Size</th><th>Other sizes</th><th>Brand</th><th>Pattern</th><th>Qty</th>
              <th>Year</th><th>Condition</th><th>Country</th><th>Region</th><th>Type</th><th>Load index</th>
              <th>Price</th><th>Cur.</th><th>SKU</th><th>Comment</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <RowView key={r.row} r={r} text={text} types={types} onEdit={onEdit} />
            ))}
            {!pageRows.length && (
              <tr><td colSpan={17} className="form-hint">No rows to show.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="import-pager">
          <button className="btn btn-secondary btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>‹ Prev</button>
          <span>Page {current + 1} of {pages} ({shown.length} rows)</span>
          <button className="btn btn-secondary btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}

function RowView({ r, text, types, onEdit }: {
  r: PreviewRow;
  text: (r: PreviewRow, f: keyof RowData, w?: number) => ReactElement;
  types: { value: string; label: string }[];
  onEdit: Props['onEdit'];
}) {
  const extra = r.data.additional_sizes ?? [];
  const hasDetails = r.messages.length > 0 || !!r.unrecognized || (r.alternatives?.length ?? 0) > 0;
  const moveRest = (to: 'pattern' | 'comment') => {
    const current = r.data[to];
    onEdit(r.row, { [to]: current ? `${current} ${r.unrecognized}` : r.unrecognized ?? undefined }, { unrecognized: null });
  };
  return (
    <>
      <tr className={`import-row import-row-${r.status}`}>
        <td>{r.row}</td>
        <td>
          <span className={`import-status import-status-${r.status}`}>{r.edited ? 'edited' : r.status}</span>
          {r.action && <div className="form-hint">{r.action}</div>}
        </td>
        <td>{text(r, 'size', 110)}</td>
        <td>
          <input
            className="cell-input"
            style={{ width: 130 }}
            value={extra.join('; ')}
            placeholder="none"
            onChange={(e) => onEdit(r.row, {
              additional_sizes: e.target.value.split(';').map((s) => s.trim()).filter(Boolean),
            })}
          />
        </td>
        <td>{text(r, 'brand', 100)}</td>
        <td>{text(r, 'pattern', 110)}</td>
        <td>
          <input className={`cell-input${fieldHasError(r, 'qty') ? ' error' : ''}`} style={{ width: 55 }} inputMode="numeric"
            value={r.data.qty ?? ''}
            onChange={(e) => onEdit(r.row, { qty: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </td>
        <td>{text(r, 'dot_code', 55)}</td>
        <td>
          <select className="cell-input" value={r.data.condition ?? ''} onChange={(e) => onEdit(r.row, { condition: e.target.value || undefined })}>
            <option value="">—</option>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </td>
        <td>{text(r, 'location_country', 40)}</td>
        <td>{text(r, 'location_region', 90)}</td>
        <td>
          {types.length ? (
            <select className="cell-input" value={r.data.tire_type ?? ''} onChange={(e) => onEdit(r.row, { tire_type: e.target.value || undefined })}>
              <option value="">—</option>
              {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          ) : text(r, 'tire_type', 80)}
        </td>
        <td>{text(r, 'load_index', 90)}</td>
        <td>
          <input className={`cell-input${fieldHasError(r, 'price') ? ' error' : ''}`} style={{ width: 70 }} inputMode="decimal"
            value={r.data.price ?? ''}
            onChange={(e) => {
              // kept as typed ("12." while typing 12.5); turned into a number when sent
              const v = e.target.value.replace(',', '.');
              onEdit(r.row, { price: v === '' ? undefined : (v as unknown as number) });
            }} />
        </td>
        <td>{text(r, 'currency', 45)}</td>
        <td>{text(r, 'sku', 80)}</td>
        <td>{text(r, 'comment', 140)}</td>
      </tr>
      {hasDetails && (
        <tr className={`import-details import-row-${r.status}`}>
          <td />
          <td colSpan={16}>
            {r.messages.map((m, i) => (
              <div key={i} className={m.level === 'error' ? 'import-msg-error' : 'import-msg-warning'}>
                {m.level === 'error' ? '✕' : '!'} {m.text}
              </div>
            ))}
            {r.unrecognized && (
              <div className="import-rest">
                Unrecognized text: <code>{r.unrecognized}</code>
                <button className="btn btn-secondary btn-sm" onClick={() => moveRest('pattern')}>→ pattern</button>
                <button className="btn btn-secondary btn-sm" onClick={() => moveRest('comment')}>→ comment</button>
                <button className="btn btn-secondary btn-sm" onClick={() => onEdit(r.row, {}, { unrecognized: null })}>ignore</button>
              </div>
            )}
            {(r.alternatives ?? []).map((a) => (
              <button key={`${a.field}-${a.value}`} className="btn btn-secondary btn-sm import-alt"
                onClick={() => onEdit(r.row, a.field === 'size' ? { size: a.value } : { price: Number(a.value) }, {
                  alternatives: (r.alternatives ?? []).filter((x) => x !== a),
                })}>
                Use {a.field} {a.label}
              </button>
            ))}
            {extra.map((s) => (
              <button key={s} className="btn btn-secondary btn-sm import-alt"
                onClick={() => onEdit(r.row, {
                  size: s,
                  additional_sizes: [r.data.size, ...extra.filter((x) => x !== s)].filter(Boolean) as string[],
                })}>
                Make {s} the main size
              </button>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function fieldHasError(r: PreviewRow, field: string): boolean {
  return r.messages.some((m) => m.level === 'error' && m.field === field);
}
