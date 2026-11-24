// Shared, dependency-free card-code helpers (used by server AND browser).

export const CODE_HASH_ITERATIONS = 20000;

/** Normalise what a volunteer types: case, dashes, spaces, O->0, I/L->1. */
export function normalizeCardCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** Card codes are 8 Crockford-base32 characters. */
export function looksLikeCardCode(input: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(normalizeCardCode(input));
}
