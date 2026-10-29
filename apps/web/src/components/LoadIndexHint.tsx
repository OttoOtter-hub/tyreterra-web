'use client';
import { parseLoadIndex } from '../lib/tire-size';

// How the load index field will be read (same parser as the API and the import)
export default function LoadIndexHint({ value }: { value: string }) {
  if (!value.trim()) return null;
  const p = parseLoadIndex(value);
  const parts: string[] = [];
  if (p.load_index_single !== null) parts.push(`single ${p.load_index_single}${p.speed_single ?? ''}`);
  if (p.load_index_dual !== null) parts.push(`dual ${p.load_index_dual}${p.speed_dual ?? ''}`);
  if (p.ply_rating !== null) parts.push(`${p.ply_rating} PR`);
  if (!parts.length) return <p className="form-hint">Not recognised — kept as written, but not used in load / ply filters.</p>;
  return (
    <p className="form-hint">
      Read as: {parts.join(', ')}
      {!p.complete && <> · not understood: <code>{p.rest}</code></>}
    </p>
  );
}
