'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import { parsePartialSize, PartialSize } from '../lib/tire-size';
import SizeChips from './SizeChips';

export interface SizeSuggestion {
  size: string;
  width: number;
  aspect: number | null;
  construction: string;
  rim: number;
  count: number;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Run the search for this query (Enter, a suggestion, an alternative reading) */
  onCommit: (value: string) => void;
}

const DEBOUNCE_MS = 150;
const EMPTY: PartialSize = { format: 'unknown', confidence: 0, candidates: [] };

// Size search box (WAI-ARIA combobox): live read-out of the parsed size under
// the field and a list of sizes actually on offer, navigable with the arrow
// keys and Enter.
export default function SizeSearchBox({ value, onChange, onCommit }: Props) {
  const listId = useId();
  const [parsed, setParsed] = useState<PartialSize>(EMPTY);
  const [suggestions, setSuggestions] = useState<SizeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const requestNo = useRef(0);

  // Debounced: parse locally, then ask the API which sizes exist
  useEffect(() => {
    const q = value.trim();
    const timer = setTimeout(() => {
      setParsed(q ? parsePartialSize(q) : EMPTY);
      setActive(-1);
      if (!q) { setSuggestions([]); setLoading(false); return; }
      const no = ++requestNo.current;
      setLoading(true);
      api.get<SizeSuggestion[]>(`/listings/size-suggest?q=${encodeURIComponent(q)}`)
        .then((rows) => { if (no === requestNo.current) setSuggestions(rows); })
        .catch(() => { if (no === requestNo.current) setSuggestions([]); })
        .finally(() => { if (no === requestNo.current) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const commit = (q: string) => {
    onChange(q);
    onCommit(q);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (suggestions.length) setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length) setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(open && active >= 0 && suggestions[active] ? suggestions[active].size : value.trim());
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const showList = open && value.trim() !== '' && (loading || suggestions.length > 0 || parsed.candidates.length === 0);
  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className="size-search">
      <div className="size-search-field">
        <input
          type="text"
          className="form-control"
          role="combobox"
          aria-label="Tire size"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          aria-busy={loading}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="e.g. 315/80R22.5, 315 80 22,5, 31580R225"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {value && (
          <button type="button" className="size-search-clear" aria-label="Clear size" onClick={() => commit('')}>
            ×
          </button>
        )}
      </div>

      {showList && (
        <ul id={listId} role="listbox" aria-label="Matching sizes" className="size-suggest-list">
          {loading && suggestions.length === 0 && <li className="size-suggest-note" aria-disabled="true">Searching…</li>}
          {!loading && suggestions.length === 0 && (
            <li className="size-suggest-note" aria-disabled="true">
              {parsed.candidates.length ? 'No listings in this size yet' : 'Not a size we can read — try 315/80R22.5'}
            </li>
          )}
          {suggestions.map((s, i) => (
            <li
              key={s.size}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={`size-suggest-option${i === active ? ' active' : ''}`}
              // mousedown, not click: keeps focus so the list is not closed by blur first
              onMouseDown={(e) => { e.preventDefault(); commit(s.size); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="size-suggest-size">{s.size}</span>
              <span className="size-suggest-count">{s.count} {s.count === 1 ? 'listing' : 'listings'}</span>
            </li>
          ))}
        </ul>
      )}

      <SizeChips parsed={parsed} onPick={commit} />
    </div>
  );
}
