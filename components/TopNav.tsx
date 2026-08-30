import Link from 'next/link';
import { getDb } from '@/lib/db';
import { Carrier, QuickLink } from '@/lib/types';
import { SessionUser } from '@/lib/currentUser';
import QuickAccessMenu from './QuickAccessMenu';
import LogoutButton from './LogoutButton';
import Logo from './Logo';
import NavLinks from './NavLinks';

export default function TopNav({ user }: { user: SessionUser | null }) {
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
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-1 px-4 py-2.5 md:px-6">
        <Link href="/" className="mr-3 flex items-center gap-2 text-[15px] font-bold text-ink transition-transform duration-150 ease-out hover:scale-105">
          <Logo size={28} />
          Solace
        </Link>
        <NavLinks />
        <span className="mr-1 hidden text-sm text-slate-500 sm:inline">{user.name}</span>
        <Link href="/quick-links" className="btn-secondary hidden sm:inline-flex">👥 Team</Link>
        <QuickAccessMenu carriers={carriers} quickLinks={quickLinks} />
        <LogoutButton />
      </div>
    </header>
  );
}
