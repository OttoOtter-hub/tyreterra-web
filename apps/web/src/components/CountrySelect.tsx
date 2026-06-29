'use client';
import { useState, useRef, useEffect } from 'react';
import { COUNTRIES, countryByCode } from '../lib/countries';

interface Props {
  value: string;          // ISO alpha-2 code stored in form state
  onChange: (code: string) => void;
  placeholder?: string;
  required?: boolean;
}

export default function CountrySelect({ value, onChange, placeholder = 'Search country…', required }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Sync display when value changes externally
  const displayName = value ? (countryByCode[value.toUpperCase()] ?? value) : '';

  const filtered = query.length > 0
    ? COUNTRIES.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.code.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 40)
    : COUNTRIES.slice(0, 40);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function select(code: string) {
    onChange(code);
    setOpen(false);
    setQuery('');
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className="form-control"
        value={open ? query : displayName}
        placeholder={placeholder}
        required={required}
        readOnly={!open}
        onClick={() => { setOpen(true); setQuery(''); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        style={{ cursor: open ? 'text' : 'pointer', background: 'white' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,.1)', maxHeight: 220, overflowY: 'auto',
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: '.5rem 1rem', color: '#9ca3af', fontSize: '.9rem' }}>No results</div>
          )}
          {filtered.map(c => (
            <div
              key={c.code}
              onMouseDown={() => select(c.code)}
              style={{
                padding: '.45rem 1rem', cursor: 'pointer', fontSize: '.9rem',
                background: c.code === value ? '#eff6ff' : 'transparent',
                fontWeight: c.code === value ? 600 : 400,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
              onMouseLeave={e => (e.currentTarget.style.background = c.code === value ? '#eff6ff' : 'transparent')}
            >
              {c.name} <span style={{ color: '#9ca3af', fontSize: '.8rem' }}>{c.code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
