// Bangla display helpers. Every date is shown in Bangladesh time, whether the
// code runs on the server (UTC on Vercel) or in a browser set to another zone.

export const TZ = 'Asia/Dhaka';

const BN = '০১২৩৪৫৬৭৮৯';

/** Replace ASCII digits in any string with Bangla digits. */
export function bnDigits(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => BN[Number(d)]);
}

/** Number with Bangla digits and grouping (১,২৩৪). */
export function bnNum(n: number, maxFractionDigits = 0): string {
  return n.toLocaleString('bn-BD', { maximumFractionDigits: maxFractionDigits });
}

export function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString('bn-BD', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('bn-BD', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
}

export const UNIT_BN: Record<string, string> = { packet: 'প্যাকেট', litre: 'লিটার', kit: 'কিট' };
export const unitBn = (u: string) => UNIT_BN[u] ?? u;

export const DAMAGE_BN = { NONE: 'নেই', PARTIAL: 'আংশিক', SEVERE: 'গুরুতর', TOTAL: 'সম্পূর্ণ' } as const;

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
