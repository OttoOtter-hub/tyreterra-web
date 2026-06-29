'use client';
import { useRouter } from 'next/navigation';

interface Listing {
  id: string;
  segment: string;
  tire_type: string | null;
  size_raw: string;
  brand: string;
  pattern: string | null;
  qty: number;
  condition: string;
  location_country: string;
  location_region: string | null;
  seller_country: string | null;
  seller_rating: number | null;
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

export default function ListingCard({ listing }: { listing: Listing }) {
  const router = useRouter();
  const seg = listing.segment.toLowerCase();

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span className={`badge badge-${seg}`}>{listing.segment}</span>
        <span className="badge" style={{ background: '#f3f4f6', color: '#374151' }}>
          {listing.qty} pcs
        </span>
      </div>

      <div>
        <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{listing.size_raw}</div>
        <div style={{ color: '#6b7280', fontSize: '.9rem' }}>
          {listing.brand}{listing.pattern ? ` · ${listing.pattern}` : ''}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`badge badge-${listing.condition}`}>{listing.condition}</span>
        {listing.tire_type && (
          <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', textTransform: 'capitalize' }}>
            {listing.tire_type.replace(/_/g, ' ')}
          </span>
        )}
        <span style={{ color: '#6b7280', fontSize: '.8rem' }}>
          {listing.seller_country ?? listing.location_country}
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '.5rem', borderTop: '1px solid #f3f4f6' }}>
        <Stars score={listing.seller_rating} />
        <span style={{ fontSize: '.75rem', color: '#9ca3af' }}>{timeAgo(listing.created_at)}</span>
      </div>

      <button
        className="btn btn-primary btn-full"
        onClick={() => router.push(`/catalogue/${listing.id}`)}
      >
        Request Offer
      </button>
    </div>
  );
}
