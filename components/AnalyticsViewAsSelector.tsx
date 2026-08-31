'use client';

import { useRouter } from 'next/navigation';

// Admin-only control on the Analytics page: swaps the ?asUser= query param
// so the server component re-renders every metric for the picked
// teammate's own leads instead — nothing client-side computed, just a nav.
export default function AnalyticsViewAsSelector({
  users, currentUserId, selectedId
}: {
  users: { id: string; name: string }[];
  currentUserId: string;
  selectedId: string;
}) {
  const router = useRouter();

  return (
    <form className="flex items-center gap-2 text-sm text-slate-500">
      Viewing as:
      <select
        defaultValue={selectedId}
        className="rounded border border-line bg-panel px-2 py-1"
        onChange={(e) => {
          const id = e.target.value;
          router.push(id === currentUserId ? '/analytics' : `/analytics?asUser=${id}`);
        }}
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.id === currentUserId ? `${u.name} (you)` : u.name}</option>
        ))}
      </select>
    </form>
  );
}
