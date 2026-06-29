'use client';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h2 style={{ color: '#dc2626' }}>Page Error</h2>
      <p><strong>{error.message}</strong></p>
      <pre style={{ background: '#f3f4f6', padding: '1rem', overflowX: 'auto', fontSize: '.8rem' }}>
        {error.stack}
      </pre>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
