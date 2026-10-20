'use client';

// Replaces the root layout, so no app CSS is loaded here — inline styles only.
// Never render error.message / error.stack; the digest links to the server log entry.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', background: '#fff', color: '#111827' }}>
        <h2 style={{ marginBottom: '.75rem' }}>Something went wrong</h2>
        <p style={{ marginBottom: '1rem' }}>
          An unexpected error occurred. Please reload the page; if it keeps happening, contact support.
        </p>
        {error.digest && (
          <p style={{ color: '#6b7280', fontSize: '.85rem', marginBottom: '1rem' }}>Error reference: {error.digest}</p>
        )}
        <button onClick={() => window.location.reload()}>Reload</button>
      </body>
    </html>
  );
}
