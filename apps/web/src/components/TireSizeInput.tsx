'use client';
import { useState, useCallback } from 'react';
import {
  parseTireSize,
  parsePartialSize,
  ParsedTireSize,
  PartialSize,
  FORMAT_LABELS,
} from '../lib/tire-size';
import SizeChips from './SizeChips';

interface Props {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

// Listing form size field. Validation is strict (the same parseTireSize the
// API stores with); while the size is incomplete or written loosely, the
// partial parser shows what was understood and offers the strict spelling.
export default function TireSizeInput({ value, onChange, error }: Props) {
  const [parsed, setParsed] = useState<ParsedTireSize | null>(null);
  const [partial, setPartial] = useState<PartialSize | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  // The strict parser also accepts glued input with absurd values ("31580R225" →
  // width 31580, rim 225"); validation stays strict, but suggest the likely size
  const [didYouMean, setDidYouMean] = useState<string | null>(null);

  const evaluate = useCallback((v: string) => {
    setDidYouMean(null);
    if (!v.trim()) { setParsed(null); setPartial(null); setParseError(null); return; }
    try {
      const strict = parseTireSize(v);
      setParsed(strict);
      setPartial(null);
      setParseError(null);
      const best = parsePartialSize(v).candidates[0];
      if (best?.complete && (best.width !== strict.size_width || best.rim !== strict.size_rim)) {
        try { parseTireSize(best.label); setDidYouMean(best.label); } catch { /* not a strict spelling */ }
      }
    } catch (err) {
      setParsed(null);
      const p = parsePartialSize(v);
      setPartial(p);
      // Only an error when nothing in the input reads as a size
      setParseError(p.candidates.length ? null : (err as Error).message);
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    evaluate(e.target.value);
  }, [onChange, evaluate]);

  const use = (v: string) => { onChange(v); evaluate(v); };

  // A complete loose reading that the strict parser accepts, e.g. "31580R225" → "315/80R22.5"
  const strictSpelling = partial?.candidates
    .filter((c) => c.complete)
    .map((c) => c.label)
    .find((label) => { try { parseTireSize(label); return true; } catch { return false; } });

  return (
    <div>
      <input
        type="text"
        className={`form-control${error || parseError ? ' error' : ''}`}
        value={value}
        onChange={handleChange}
        placeholder="e.g. 315/80R22.5 or 10.00-20"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-invalid={!!(error || parseError)}
      />
      {(error || parseError) && (
        <p className="form-error">{error ?? parseError}</p>
      )}
      {parsed && !parseError && (
        <div className="size-preview">
          <div className="size-preview-row">
            <div className="size-preview-field">
              <span className="size-preview-label">Format</span>
              <span className="size-preview-value">{FORMAT_LABELS[parsed.format]}</span>
            </div>
            <div className="size-preview-field">
              <span className="size-preview-label">Width</span>
              <span className="size-preview-value">{parsed.size_width}</span>
            </div>
            {parsed.size_aspect_ratio !== null && (
              <div className="size-preview-field">
                <span className="size-preview-label">Aspect ratio</span>
                <span className="size-preview-value">{parsed.size_aspect_ratio}</span>
              </div>
            )}
            <div className="size-preview-field">
              <span className="size-preview-label">Construction</span>
              <span className="size-preview-value">{parsed.size_construction === 'R' ? 'Radial (R)' : 'Diagonal (–)'}</span>
            </div>
            <div className="size-preview-field">
              <span className="size-preview-label">Rim</span>
              <span className="size-preview-value">{parsed.size_rim}"</span>
            </div>
          </div>
          {didYouMean && (
            <p className="form-hint">
              Did you mean{' '}
              <button type="button" className="size-alt" onClick={() => use(didYouMean)}>{didYouMean}</button>?
            </p>
          )}
        </div>
      )}
      {!parsed && partial && partial.candidates.length > 0 && (
        <>
          <SizeChips parsed={partial} />
          {strictSpelling
            ? (
              <p className="form-hint">
                Write it as{' '}
                <button type="button" className="size-alt" onClick={() => use(strictSpelling)}>{strictSpelling}</button>
              </p>
            )
            : partial.candidates[0].complete
              ? <p className="form-hint">Add R (radial) or – (diagonal) before the rim, e.g. 315/80R22.5</p>
              : <p className="form-hint">Keep typing — e.g. 315/80R22.5</p>}
        </>
      )}
      <p className="form-hint">Format auto-detected. Spaces are normalised automatically.</p>
    </div>
  );
}
