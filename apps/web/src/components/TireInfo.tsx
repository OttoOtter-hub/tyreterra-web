'use client';
import { countryByCode } from '../lib/countries';

export interface TireListing {
  size_raw: string;
  brand: string;
  segment: string;
  tire_type?: string | null;
  pattern?: string | null;
  load_index?: string | null;
  origin_country?: string | null;
  dot_code?: string | null;
  condition?: string;
  qty?: number;
  location_country?: string;
  location_region?: string | null;
}

export default function TireInfo({ listing, qty }: { listing: TireListing; qty?: number }) {
  const seg = listing.segment?.toLowerCase();
  const originName = listing.origin_country
    ? (countryByCode[listing.origin_country] ?? listing.origin_country)
    : null;
  const locationName = listing.location_country
    ? (countryByCode[listing.location_country] ?? listing.location_country)
    : null;
  const displayQty = qty ?? listing.qty;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
      {/* Main line: size + brand */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{listing.size_raw}</span>
        <span style={{ color: '#374151', fontWeight: 500 }}>{listing.brand}</span>
        {listing.pattern && <span style={{ color: '#6b7280', fontSize: '.85rem' }}>· {listing.pattern}</span>}
      </div>

      {/* Badges row */}
      <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {listing.segment && (
          <span className={`badge badge-${seg}`}>{listing.segment}</span>
        )}
        {listing.tire_type && (
          <span style={{ display: 'inline-block', padding: '.1rem .45rem', borderRadius: 999,
            background: '#e0f2fe', color: '#0369a1', fontSize: '.73rem', fontWeight: 500 }}>
            {listing.tire_type.replace(/_/g, ' ')}
          </span>
        )}
        {listing.condition && (
          <span className={`badge badge-${listing.condition}`}>{listing.condition}</span>
        )}
        {displayQty != null && (
          <span style={{ fontSize: '.78rem', color: '#6b7280' }}>{displayQty} pcs</span>
        )}
      </div>

      {/* Details row */}
      {(listing.load_index || originName || listing.dot_code || locationName) && (
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', fontSize: '.78rem', color: '#6b7280' }}>
          {listing.load_index && <span><b style={{ color: '#374151' }}>LI:</b> {listing.load_index}</span>}
          {listing.dot_code   && <span><b style={{ color: '#374151' }}>Year:</b> {listing.dot_code}</span>}
          {originName         && <span><b style={{ color: '#374151' }}>Origin:</b> {originName}</span>}
          {locationName       && (
            <span><b style={{ color: '#374151' }}>Location:</b> {locationName}{listing.location_region ? ` / ${listing.location_region}` : ''}</span>
          )}
        </div>
      )}
    </div>
  );
}
