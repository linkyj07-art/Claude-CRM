'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '🏠' },
  { href: '/leads', label: 'Leads', icon: '📋' },
  { href: '/calls', label: 'Calls', icon: '📞' },
  { href: '/calendar', label: 'Calendar', icon: '📅' },
  { href: '/policies', label: 'Policies', icon: '📄' },
  { href: '/commissions', label: 'Commissions', icon: '💰' },
  { href: '/disputes', label: 'Disputes', icon: '⚠️' },
  { href: '/analytics', label: 'Analytics', icon: '📈' }
];

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
      {NAV_ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? 'bg-brand-500/15 text-brand-400' : 'text-slate-500 hover:bg-slate-100 hover:text-ink'
            }`}
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
      <div className="my-2 border-t border-line" />
      <Link
        href="/quick-links"
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          pathname.startsWith('/quick-links') ? 'bg-brand-500/15 text-brand-400' : 'text-slate-500 hover:bg-slate-100 hover:text-ink'
        }`}
      >
        <span className="text-base leading-none">👥</span>
        Team &amp; Settings
      </Link>
    </nav>
  );
}
