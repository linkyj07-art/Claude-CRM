'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DismissDuplicateButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function dismiss() {
    setBusy(true);
    try {
      const res = await fetch(`/api/duplicate-leads/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        alert('Could not dismiss that — please try again.');
        return;
      }
      router.refresh();
    } finally { setBusy(false); }
  }
  return <button className="btn-secondary text-xs" disabled={busy} onClick={dismiss}>Dismiss</button>;
}

export function AddAnywayButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function addAnyway() {
    setBusy(true);
    try {
      const res = await fetch(`/api/duplicate-leads/${id}/add`, { method: 'POST' });
      if (!res.ok) {
        alert('Could not add this lead — please try again.');
        return;
      }
      router.refresh();
    } finally { setBusy(false); }
  }
  return <button className="btn-primary text-xs" disabled={busy} onClick={addAnyway}>Not a duplicate — Add</button>;
}

export function ArchiveLeadButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function archive() {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived', archived: 1 })
      });
      if (!res.ok) {
        alert('Could not archive this lead — please try again.');
        return;
      }
      router.refresh();
    } finally { setBusy(false); }
  }
  return <button className="btn-secondary text-xs" disabled={busy} onClick={archive}>Archive</button>;
}
