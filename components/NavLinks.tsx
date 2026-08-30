'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/leads', label: 'Leads' },
  { href: '/calls', label: 'Calls' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/policies', label: 'Policies' },
  { href: '/commissions', label: 'Commissions' },
  { href: '/disputes', label: 'Disputes' },
  { href: '/analytics', label: 'Analytics' }
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
      {NAV_ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? 'text-ink' : 'text-slate-500 hover:bg-slate-100 hover:text-ink'
            }`}
          >
            {item.label}
            {active && (
              <span className="absolute inset-x-2 -bottom-[11px] h-0.5 rounded-full bg-gradient-to-r from-brand-400 to-brand-600" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
