// Token-card codes for delivery confirmation that work OFFLINE.
//
// - The server derives each household's code with HMAC(secret, householdId)
//   and prints it on the family's card. The secret never leaves the server.
// - Volunteer devices only receive a slow PBKDF2 hash of the code (salted with
//   the household id), so a stolen phone cannot simply reveal codes.
// - The browser verifies with WebCrypto PBKDF2 using the same parameters
//   (implemented in the offline module on Day 2).
import { createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { CODE_HASH_ITERATIONS, normalizeCardCode } from './cardcode';

export { CODE_HASH_ITERATIONS, normalizeCardCode };

// Crockford base32: no I, L, O, U -> fewer misreadings from a printed card.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateCardCode(secret: string, householdId: string): string {
  const mac = createHmac('sha256', secret).update(`card:v1:${householdId}`).digest();
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[mac[i] % 32];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function hashCardCode(code: string, householdId: string): string {
  return pbkdf2Sync(normalizeCardCode(code), householdId, CODE_HASH_ITERATIONS, 32, 'sha256').toString('hex');
}

export function verifyCardCode(input: string, householdId: string, storedHash: string): boolean {
  const a = Buffer.from(hashCardCode(input, householdId), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Keyed hash of an NID: lets us detect duplicates without storing the NID. */
export function hashNid(secret: string, nid: string): string {
  return createHmac('sha256', secret).update(`nid:v1:${nid}`).digest('hex');
}
