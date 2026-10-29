'use client';
import { PartialSize } from '../lib/tire-size';

interface Props {
  parsed: PartialSize;
  /** Called with a candidate's label when the user picks another reading */
  onPick?: (label: string) => void;
}

const CONSTRUCTION: Record<string, string> = { R: 'Radial (R)', '-': 'Diagonal (–)' };

// Live read-out of what a size query was understood as: one chip per
// component, plus the other readings when the input is ambiguous.
export default function SizeChips({ parsed, onPick }: Props) {
  if (!parsed.candidates.length) return null;
  const [best, ...others] = parsed.candidates;

  const chips: [string, string][] = [
    ['Width', String(best.width)],
    ['Profile', best.aspect !== undefined ? String(best.aspect) : '—'],
    ['Construction', best.construction ? CONSTRUCTION[best.construction] : 'any'],
    ['Rim', best.rim !== undefined ? `${best.rim}"` : '—'],
  ];

  return (
    <div className="size-chips" aria-live="polite">
      {chips.map(([label, value]) => (
        <span key={label} className={`size-chip${value === '—' || value === 'any' ? ' size-chip-open' : ''}`}>
          <span className="size-chip-label">{label}</span> {value}
        </span>
      ))}
      {others.length > 0 && (
        <div className="size-alternatives">
          <span>Also could be:</span>
          {others.map((c) => (
            onPick
              ? <button key={c.label} type="button" className="size-alt" onClick={() => onPick(c.label.replace('…', ''))}>
                  {c.label} <small>{Math.round(c.confidence * 100)}%</small>
                </button>
              : <span key={c.label} className="size-alt">{c.label} <small>{Math.round(c.confidence * 100)}%</small></span>
          ))}
        </div>
      )}
    </div>
  );
}
