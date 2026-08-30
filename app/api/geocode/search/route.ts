import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/currentUser';
import { normalizeState } from '@/lib/util';

// Free, no-API-key address lookup via OpenStreetMap's Nominatim, proxied
// through our own server (not called directly from the browser) so we can
// send the User-Agent it requires and keep well under its 1 req/sec usage
// policy without exposing any of that to the client.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const q = new URL(req.url).searchParams.get('q')?.trim() || '';
  if (q.length < 3) return NextResponse.json([]);

  const url = `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&limit=5&countrycodes=us&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Solace-CRM (solo final-expense agent tool, contact via app owner)' }
    });
    if (!res.ok) return NextResponse.json([]);
    const results = (await res.json()) as any[];
    const simplified = results.map((r) => {
      const a = r.address || {};
      const streetNumber = a.house_number || '';
      const street = a.road || '';
      return {
        displayName: r.display_name as string,
        address: [streetNumber, street].filter(Boolean).join(' '),
        city: a.city || a.town || a.village || a.hamlet || '',
        state: normalizeState(a.state) || '',
        postalCode: a.postcode || ''
      };
    });
    return NextResponse.json(simplified);
  } catch {
    return NextResponse.json([]);
  }
}
