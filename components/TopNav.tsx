import Link from 'next/link';
import { getDb } from '@/lib/db';
import { Carrier, QuickLink } from '@/lib/types';
import QuickAccessMenu from './QuickAccessMenu';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/leads', label: 'Leads' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/policies', label: 'Policies' },
  { href: '/commissions', label: 'Commissions' },
  { href: '/analytics', label: 'Analytics' }
];

export default function TopNav() {
  const db = getDb();
  const carriers = db.prepare('SELECT * FROM carriers ORDER BY sort_order, name').all() as Carrier[];
  const quickLinks = db.prepare('SELECT * FROM quick_links ORDER BY category, sort_order').all() as QuickLink[];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-1 px-4 py-2.5 md:px-6">
        <Link href="/" className="mr-3 flex items-center gap-2 text-[15px] font-bold text-ink">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-white">📋</span>
          FEX CRM
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <QuickAccessMenu carriers={carriers} quickLinks={quickLinks} />
      </div>
    </header>
  );
}
