// Browser-side (offline) verification of a token-card code using WebCrypto.
// Produces exactly the same PBKDF2 hash as the server (domain/token.ts).
import { CODE_HASH_ITERATIONS, normalizeCardCode } from './cardcode';

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashCardCodeWeb(code: string, householdId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(normalizeCardCode(code)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(householdId), iterations: CODE_HASH_ITERATIONS },
    key,
    256,
  );
  return toHex(bits);
}

export async function verifyCardCodeWeb(input: string, householdId: string, storedHash: string): Promise<boolean> {
  const h = await hashCardCodeWeb(input, householdId);
  if (h.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}
