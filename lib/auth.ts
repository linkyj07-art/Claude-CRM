import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

// scrypt via Node's built-in crypto module — deliberately not bcrypt, which
// would add another native addon to a project that already had one painful
// native-module saga (better-sqlite3 on Railway). No extra dependency, no
// separate Node-version/build concerns.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
