'use client';
import { useState, useCallback } from 'react';
import { parseTireSize, ParsedTireSize, FORMAT_LABELS } from '../lib/tire-size';

interface Props {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export default function TireSizeInput({ value, onChange, error }: Props) {
  const [parsed, setParsed] = useState<ParsedTireSize | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    if (!v.trim()) { setParsed(null); setParseError(null); return; }
    try {
      setParsed(parseTireSize(v));
      setParseError(null);
    } catch (err) {
      setParsed(null);
      setParseError((err as Error).message);
    }
  }, [onChange]);

  return (
    <div>
      <input
        type="text"
        className={`form-control${error || parseError ? ' error' : ''}`}
        value={value}
        onChange={handleChange}
        placeholder="e.g. 315/80R22.5 or 10.00-20"
        autoComplete="off"
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
        </div>
      )}
      <p className="form-hint">Format auto-detected. Spaces are normalised automatically.</p>
    </div>
  );
}
