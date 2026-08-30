import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/currentUser';

// Every table's columns get written as-is (headers pulled from whatever the
// query actually returns) rather than hand-listing them per table — keeps
// this in sync with the schema automatically instead of silently dropping a
// column someone adds later.
function addSheet(workbook: ExcelJS.Workbook, name: string, rows: Record<string, unknown>[]) {
  const sheet = workbook.addWorksheet(name.slice(0, 31)); // Excel's own sheet-name length limit
  if (rows.length === 0) {
    sheet.addRow(['No data']);
    return;
  }
  const headers = Object.keys(rows[0]);
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(headers.map((h) => (row[h] === null || row[h] === undefined ? '' : String(row[h]))));
  sheet.columns.forEach((col) => { col.width = 20; });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = getDb();
  const ownedSub = `(SELECT id FROM customers WHERE owner_id = ?)`;

  const workbook = new ExcelJS.Workbook();
  addSheet(workbook, 'Leads', db.prepare('SELECT * FROM customers WHERE owner_id = ? ORDER BY purchased_at DESC').all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Notes', db.prepare(`SELECT * FROM note_versions WHERE customer_id IN ${ownedSub} ORDER BY created_at DESC`).all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Calls', db.prepare(`SELECT * FROM calls WHERE customer_id IN ${ownedSub} ORDER BY occurred_at DESC`).all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Quotes', db.prepare(`SELECT * FROM quotes WHERE customer_id IN ${ownedSub} ORDER BY created_at DESC`).all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Appointments', db.prepare(`SELECT * FROM appointments WHERE customer_id IN ${ownedSub} ORDER BY scheduled_at DESC`).all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Applications', db.prepare(`SELECT * FROM applications WHERE customer_id IN ${ownedSub} ORDER BY submitted_at DESC`).all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Policies', db.prepare(`SELECT * FROM policies WHERE customer_id IN ${ownedSub} ORDER BY created_at DESC`).all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Commissions', db.prepare(`SELECT * FROM commissions WHERE customer_id IN ${ownedSub} ORDER BY created_at DESC`).all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Payments', db.prepare(`SELECT * FROM payments WHERE customer_id IN ${ownedSub} ORDER BY paid_at DESC`).all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Disputes', db.prepare(`SELECT * FROM disputes WHERE customer_id IN ${ownedSub} ORDER BY created_at DESC`).all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Referrals', db.prepare(`SELECT * FROM referrals WHERE referrer_customer_id IN ${ownedSub} ORDER BY created_at DESC`).all(user.id) as Record<string, unknown>[]);
  addSheet(workbook, 'Audit History', db.prepare(`SELECT * FROM audit_history WHERE customer_id IN ${ownedSub} ORDER BY occurred_at DESC`).all(user.id) as Record<string, unknown>[]);
  // Company-wide, not owner-scoped — see schema.sql's note on dnc_numbers.
  addSheet(workbook, 'DNC List', db.prepare('SELECT * FROM dnc_numbers ORDER BY created_at DESC').all() as Record<string, unknown>[]);

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `solace-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}
