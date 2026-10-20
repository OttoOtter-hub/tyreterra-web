'use client';

// Never render error.message / error.stack: they can leak internals to the user.
// Server-side errors are logged by Next.js (pm2 logs tyreterra-web) under the same
// digest shown here, so a user's report can be matched to the log entry.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container page">
      <div className="card">
        <h2 style={{ marginBottom: '.75rem' }}>Something went wrong</h2>
        <p style={{ marginBottom: '1rem' }}>
          An unexpected error occurred. Please try again; if it keeps happening, contact support.
        </p>
        {error.digest && (
          <p style={{ color: '#6b7280', fontSize: '.85rem', marginBottom: '1rem' }}>Error reference: {error.digest}</p>
        )}
        <button className="btn btn-primary" onClick={reset}>Try again</button>
      </div>
    </div>
  );
}
