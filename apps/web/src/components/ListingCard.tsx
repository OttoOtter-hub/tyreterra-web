'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { countryByCode } from '../lib/countries';

interface Listing {
  id: string;
  company_id?: string;
  segment: string;
  tire_type: string | null;
  size_raw: string;
  brand: string;
  pattern: string | null;
  sku: string | null;
  load_index: string | null;
  origin_country: string | null;
  dot_code: string | null;
  qty: number;
  condition: string;
  location_country: string;
  location_region: string | null;
  seller_country: string | null;
  seller_rating: number | null | undefined;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function Stars({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="stars-muted">New member</span>;
  const full = Math.floor(score);
  const half = score % 1 >= 0.5;
  return (
    <span className="stars" title={`${score} / 5`}>
      {'★'.repeat(full)}{half ? '½' : ''}{'☆'.repeat(5 - full - (half ? 1 : 0))}
      <span style={{ fontSize: '.75rem', marginLeft: '.25rem', color: '#6b7280' }}>{score.toFixed(1)}</span>
    </span>
  );
}

function Pill({ children, color = '#f3f4f6', textColor = '#374151' }: { children: React.ReactNode; color?: string; textColor?: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '.15rem .5rem', borderRadius: 999,
      background: color, color: textColor, fontSize: '.75rem', fontWeight: 500,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

export default function ListingCard({ listing, myCompanyId }: { listing: Listing; myCompanyId?: string | null }) {
  const router = useRouter();
  const seg = listing.segment.toLowerCase();
  const isOwn = !!myCompanyId && listing.company_id === myCompanyId;
  const countryName = countryByCode[listing.location_country] ?? listing.location_country;
  const originName = listing.origin_country
    ? (countryByCode[listing.origin_country] ?? listing.origin_country)
    : null;

  return (
    <div className="card" style={{
      display: 'flex', flexDirection: 'column', gap: '.55rem',
      ...(isOwn ? { background: '#f3f4f6', border: '1px solid #d1d5db' } : {}),
    }}>

      {/* Top row: segment + qty */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className={`badge badge-${seg}`}>{listing.segment}</span>
          {isOwn && (
            <span style={{ fontSize: '.7rem', color: '#6b7280', fontStyle: 'italic' }}>your listing</span>
          )}
          {listing.tire_type && (
            <Pill color="#e0f2fe" textColor="#0369a1">
              {listing.tire_type.replace(/_/g, ' ')}
            </Pill>
          )}
        </div>
        <Pill>{listing.qty} pcs</Pill>
      </div>

      {/* Size + brand */}
      <div>
        <div style={{ fontSize: '1.2rem', fontWeight: 700, lineHeight: 1.2 }}>{listing.size_raw}</div>
        <div style={{ color: '#374151', fontSize: '.9rem', marginTop: '.1rem' }}>
          {listing.brand}{listing.pattern ? <span style={{ color: '#6b7280' }}> · {listing.pattern}</span> : ''}
        </div>
      </div>

      {/* Specs grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.2rem .5rem', fontSize: '.78rem' }}>
        <Spec label="Condition" value={listing.condition} />
        {listing.load_index && <Spec label="Load index" value={listing.load_index} />}
        {listing.dot_code    && <Spec label="Year" value={listing.dot_code} />}
        {originName          && <Spec label="Origin" value={originName} />}
        <Spec label="Location" value={listing.location_region ? `${countryName} / ${listing.location_region}` : countryName} />
        {listing.sku && <Spec label="SKU" value={listing.sku} mono />}
      </div>

      {/* Footer: rating + age */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 'auto', paddingTop: '.5rem', borderTop: '1px solid #f3f4f6',
      }}>
        <Stars score={listing.seller_rating} />
        <span style={{ fontSize: '.73rem', color: '#9ca3af' }}>{timeAgo(listing.created_at)}</span>
      </div>

      {isOwn
        ? <Link href={`/listings/${listing.id}/edit`} className="btn btn-secondary btn-full">Edit listing</Link>
        : <button className="btn btn-primary btn-full" onClick={() => router.push(`/catalogue/${listing.id}`)}>Request Offer</button>
      }
    </div>
  );
}

function Spec({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.05rem' }}>
      <span style={{ color: '#9ca3af', fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</span>
      <span style={{ color: '#111827', fontFamily: mono ? 'monospace' : 'inherit', fontSize: '.8rem', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
