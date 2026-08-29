'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Carrier, QuickLink } from '@/lib/types';

export default function QuickAccessMenu({
  carriers,
  quickLinks
}: {
  carriers: Carrier[];
  quickLinks: QuickLink[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const quoterLinks = quickLinks.filter((l) => l.category === 'quoter');
  const resourceLinks = quickLinks.filter((l) => l.category === 'resource');
  const generalLinks = quickLinks.filter((l) => l.category === 'general');

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn-primary whitespace-nowrap"
        type="button"
      >
        ⚡ Quick Access <span className={`transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-line bg-white shadow-2xl">
          <div className="max-h-[75vh] overflow-y-auto p-2">
            {quoterLinks.length > 0 && (
              <div className="mb-1">
                {quoterLinks.map((l) => (
                  <a
                    key={l.id}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink hover:bg-brand-50"
                  >
                    🧮 {l.label}
                    <span className="ml-auto text-xs text-slate-400">↗</span>
                  </a>
                ))}
              </div>
            )}

            <div className="my-1 border-t border-line" />
            <div className="px-3 pt-2 pb-1 label">🏢 Carrier Logins</div>
            <div className="max-h-64 overflow-y-auto">
              {carriers.map((c) => (
                <div key={c.id} className="flex items-center gap-1 rounded-lg px-3 py-1.5 hover:bg-slate-50">
                  <span className="flex-1 truncate text-sm text-ink">{c.name}</span>
                  {c.agent_portal_url && (
                    <a
                      href={c.agent_portal_url}
                      target="_blank"
                      rel="noreferrer"
                      title="Agent Login"
                      className="rounded-md px-1.5 py-0.5 text-xs text-brand-600 hover:bg-brand-100"
                    >
                      🔑 Login
                    </a>
                  )}
                  {c.application_url && (
                    <a
                      href={c.application_url}
                      target="_blank"
                      rel="noreferrer"
                      title="eApp"
                      className="rounded-md px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
                    >
                      📝
                    </a>
                  )}
                  {c.claims_url && (
                    <a
                      href={c.claims_url}
                      target="_blank"
                      rel="noreferrer"
                      title="Claims / Service"
                      className="rounded-md px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
                    >
                      🩹
                    </a>
                  )}
                  {c.support_phone && (
                    <a
                      href={`tel:${c.support_phone.replace(/[^\d+]/g, '')}`}
                      title={`Support: ${c.support_phone}`}
                      className="rounded-md px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
                    >
                      ☎
                    </a>
                  )}
                </div>
              ))}
              {carriers.length === 0 && (
                <div className="px-3 py-2 text-sm text-slate-400">No carriers added yet.</div>
              )}
            </div>

            {(resourceLinks.length > 0 || generalLinks.length > 0) && (
              <>
                <div className="my-1 border-t border-line" />
                <div className="px-3 pt-2 pb-1 label">🔗 Resources</div>
                {[...resourceLinks, ...generalLinks].map((l) => (
                  <a
                    key={l.id}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-ink hover:bg-slate-50"
                  >
                    {l.label}
                    <span className="ml-auto text-xs text-slate-400">↗</span>
                  </a>
                ))}
              </>
            )}

            <div className="my-1 border-t border-line" />
            <Link
              href="/quick-links"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
            >
              ⚙️ Manage Quick Links
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
