'use client';

import { useState } from 'react';

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <button onClick={logout} disabled={busy} className="btn-secondary text-sm">
      {busy ? 'Logging out…' : 'Log out'}
    </button>
  );
}
