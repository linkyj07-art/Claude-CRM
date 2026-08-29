import Database from 'better-sqlite3';

// Every child table (calls, notes, quotes, appointments, commissions...)
// hangs off customers.id, so ownership only needs to be checked once at the
// customer level rather than adding an owner_id column to every table.
export function ownsCustomer(db: Database.Database, customerId: string, ownerId: string): boolean {
  const row = db.prepare('SELECT owner_id FROM customers WHERE id = ?').get(customerId) as { owner_id: string | null } | undefined;
  return !!row && row.owner_id === ownerId;
}
