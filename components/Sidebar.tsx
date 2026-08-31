import Link from 'next/link';
import { getDb } from '@/lib/db';
import { Carrier, QuickLink } from '@/lib/types';
import { SessionUser } from '@/lib/currentUser';
import QuickAccessMenu from './QuickAccessMenu';
import LogoutButton from './LogoutButton';
import Logo from './Logo';
import SidebarNav from './SidebarNav';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export default function Sidebar({ user }: { user: SessionUser | null }) {
  if (!user) {
    return (
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 py-2.5 md:px-6">
          <Logo size={28} />
          <span className="text-[15px] font-bold text-ink">Solace</span>
        </div>
      </header>
    );
  }

  const db = getDb();
  const carriers = db.prepare('SELECT * FROM carriers ORDER BY sort_order, name').all() as Carrier[];
  const quickLinks = db.prepare('SELECT * FROM quick_links ORDER BY category, sort_order').all() as QuickLink[];

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-panel">
      <Link href="/" className="flex items-center gap-2 px-4 py-4 text-[15px] font-bold text-ink transition-transform duration-150 ease-out hover:scale-[1.02]">
        <Logo size={30} />
        Solace
      </Link>

      <div className="px-3 pb-3">
        <QuickAccessMenu carriers={carriers} quickLinks={quickLinks} align="left" />
      </div>

      <SidebarNav isAdmin={user.role === 'admin'} />

      <div className="mt-auto border-t border-line p-3">
        <div className="flex items-center gap-2 rounded-lg px-1 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white">
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{user.name}</div>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
