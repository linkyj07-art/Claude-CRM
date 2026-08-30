'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[client-error]', error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-24 text-center">
      <div className="text-4xl">⚠️</div>
      <h1 className="text-lg font-bold text-ink">Something went wrong</h1>
      <p className="text-sm text-slate-500">
        This page hit an unexpected error. It&apos;s usually fixed by trying again — if that doesn&apos;t work, the site may have
        just updated under you, and a full reload will pick up the new version.
      </p>
      {error.message && (
        <pre className="max-w-full overflow-x-auto rounded-lg border border-line bg-panel2/60 p-3 text-left text-xs text-slate-500">
          {error.message}
        </pre>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" onClick={() => reset()}>Try Again</button>
        <a className="btn-secondary" href="/">Go to Dashboard</a>
        <button className="btn-secondary" onClick={() => window.location.reload()}>Reload Page</button>
      </div>
    </div>
  );
}
