// Session tokens are signed with the Web Crypto API (globalThis.crypto),
// not Node's `crypto` module — this file is imported from middleware.ts,
// which runs on the Edge runtime and has no access to Node built-ins or
// native addons, only Web Crypto. Node 22 also exposes the same Web Crypto
// API globally, so the same code works unmodified from route handlers.

export const SESSION_COOKIE = 'crm_session';
const SESSION_DAYS = 30;

function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.BASIC_AUTH_PASSWORD || 'dev-insecure-secret-change-me';
}

async function getKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey('raw', encoder.encode(getSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function bytesToBase64url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function createSessionToken(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payloadB64 = bytesToBase64url(encoder.encode(JSON.stringify({ uid: userId, exp })));
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  return `${payloadB64}.${bytesToBase64url(new Uint8Array(sig))}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  try {
    const encoder = new TextEncoder();
    const key = await getKey();
    const valid = await crypto.subtle.verify('HMAC', key, base64urlToBytes(sigB64) as BufferSource, encoder.encode(payloadB64));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(payloadB64))) as { uid?: string; exp?: number };
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    return typeof payload.uid === 'string' ? payload.uid : null;
  } catch {
    return null;
  }
}
