import { getDb } from '@/lib/db';
import { Carrier, CarrierRule, QuickLink } from '@/lib/types';
import SettingsManager from '@/components/SettingsManager';
import { getCurrentUser } from '@/lib/currentUser';

export const dynamic = 'force-dynamic';

export default async function QuickLinksPage() {
  const db = getDb();
  const user = await getCurrentUser();
  const carriers = db.prepare('SELECT * FROM carriers ORDER BY sort_order, name').all() as Carrier[];
  const rules = db.prepare('SELECT * FROM carrier_underwriting_rules ORDER BY created_at').all() as CarrierRule[];
  const quickLinks = db.prepare('SELECT * FROM quick_links ORDER BY category, sort_order').all() as QuickLink[];
  const settingsRow = db.prepare(`SELECT value FROM app_settings WHERE key = 'licensed_states'`).get() as { value: string } | undefined;
  const licensedStates: string[] = settingsRow ? JSON.parse(settingsRow.value) : [];
  const users = db.prepare('SELECT id, username, name, created_at FROM users ORDER BY created_at ASC').all() as { id: string; username: string; name: string; created_at: string }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">⚙️ Manage Quick Links &amp; Carriers</h1>
        <p className="text-sm text-slate-500">
          These carrier logins, quoter/resource links, health-keyword rules, and licensed states power the ⚡ Quick Access
          menu, the Suggested Carrier Order, and the Review Queue on every lead. Add, edit, or remove your own — no code changes needed.
        </p>
      </div>
      <SettingsManager carriers={carriers} rules={rules} quickLinks={quickLinks} licensedStates={licensedStates} users={users} currentUserId={user?.id || ''} />
    </div>
  );
}
