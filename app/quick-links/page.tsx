import { getDb } from '@/lib/db';
import { Carrier, CarrierRule, QuickLink } from '@/lib/types';
import SettingsManager from '@/components/SettingsManager';

export const dynamic = 'force-dynamic';

export default function QuickLinksPage() {
  const db = getDb();
  const carriers = db.prepare('SELECT * FROM carriers ORDER BY sort_order, name').all() as Carrier[];
  const rules = db.prepare('SELECT * FROM carrier_underwriting_rules ORDER BY created_at').all() as CarrierRule[];
  const quickLinks = db.prepare('SELECT * FROM quick_links ORDER BY category, sort_order').all() as QuickLink[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">⚙️ Manage Quick Links &amp; Carriers</h1>
        <p className="text-sm text-slate-500">
          These carrier logins, quoter/resource links, and health-keyword rules power the ⚡ Quick Access menu and the
          Suggested Carrier Order on every lead. Add, edit, or remove your own — no code changes needed.
        </p>
      </div>
      <SettingsManager carriers={carriers} rules={rules} quickLinks={quickLinks} />
    </div>
  );
}
