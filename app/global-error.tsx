'use client';

// Catches errors thrown from the root layout itself (TopNav, IncomingCallPopup,
// etc.) — app/error.tsx alone can't, since it renders inside that layout.
// Next.js requires this file to render its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#0b0d12', color: '#e6e8ee' }}>
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '96px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: '12px 0 8px' }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#9aa0ad', marginBottom: 16 }}>
            The app hit an unexpected error loading this page. Try again, or reload if the site just updated.
          </p>
          {error.message && (
            <pre style={{ fontSize: 12, color: '#9aa0ad', background: '#161922', padding: 12, borderRadius: 8, overflowX: 'auto', textAlign: 'left', marginBottom: 16 }}>
              {error.message}
            </pre>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => reset()} style={{ background: '#7c5cff', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>
              Try Again
            </button>
            <button onClick={() => window.location.reload()} style={{ background: '#1d2130', color: '#e6e8ee', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>
              Reload Page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
