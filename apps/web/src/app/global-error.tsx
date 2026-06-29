'use client';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'monospace', padding: '2rem', background: '#fff' }}>
        <h2 style={{ color: '#dc2626' }}>Runtime Error</h2>
        <p><strong>{error.message}</strong></p>
        <pre style={{ background: '#f3f4f6', padding: '1rem', overflowX: 'auto', fontSize: '.8rem' }}>
          {error.stack}
        </pre>
        {error.digest && <p style={{ color: '#6b7280' }}>Digest: {error.digest}</p>}
        <button onClick={() => window.location.reload()}>Reload</button>
      </body>
    </html>
  );
}
