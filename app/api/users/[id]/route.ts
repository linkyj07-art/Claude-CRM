import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { getCurrentUser } from '@/lib/currentUser';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }
  const db = getDb();
  const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), params.id);
  if (result.changes === 0) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const me = await getCurrentUser();
  if (me?.id === params.id) {
    return NextResponse.json({ error: "You can't delete your own account while logged in as it." }, { status: 400 });
  }
  const count = (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
  if (count <= 1) {
    return NextResponse.json({ error: 'At least one account has to exist.' }, { status: 400 });
  }
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(params.id);
  } catch (err) {
    if (err instanceof Error && /FOREIGN KEY constraint failed/i.test(err.message)) {
      return NextResponse.json({ error: 'This account still owns leads — delete or reassign their leads first.' }, { status: 409 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}
