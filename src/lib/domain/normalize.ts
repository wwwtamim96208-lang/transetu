// Pure normalisation helpers. No framework imports, so they run in the
// browser (offline mode), on the server and in unit tests.

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Convert Bangla digits (০-৯) to ASCII digits. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/**
 * Normalise a Bangladeshi mobile number to 01XXXXXXXXX.
 * Accepts +8801..., 8801..., 01..., 1... and Bangla digits.
 * Returns null when the number is not a valid BD mobile number.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = toAsciiDigits(input).replace(/\D/g, '');
  if (d.startsWith('880')) d = '0' + d.slice(3);
  else if (/^1[3-9]\d{8}$/.test(d)) d = '0' + d;
  return /^01[3-9]\d{8}$/.test(d) ? d : null;
}

/** Valid NID lengths in Bangladesh: 10 (smart card), 13 or 17 (old). */
export function normalizeNid(input: string | null | undefined): string | null {
  if (!input) return null;
  const d = toAsciiDigits(input).replace(/\D/g, '');
  return d.length === 10 || d.length === 13 || d.length === 17 ? d : null;
}

// Honorifics and prefixes that are written inconsistently and carry no
// identity information ("মোঃ রহিম" == "Md. Rahim" == "রহিম").
const HONORIFICS = new Set([
  'md', 'mohammad', 'mohammed', 'muhammad', 'mohd', 'mst', 'most', 'mosammat',
  'mosammet', 'mrs', 'mr', 'late',
  'মোঃ', 'মো', 'মোহাম্মদ', 'মুহাম্মদ', 'মোহাম্মাদ', 'মোছাঃ', 'মোছা', 'মোসাম্মৎ',
  'মোসাঃ', 'মিসেস', 'মরহুম',
]);

// Bengali consonant -> Latin consonant class. Vowels and vowel signs are
// dropped, so "রহিম", "রহীম" and "Rahim" all become "rhm".
const BN_CONSONANT: Record<string, string> = {
  'ক': 'k', 'খ': 'k', 'গ': 'g', 'ঘ': 'g', 'ঙ': 'ng',
  'চ': 'c', 'ছ': 'c', 'জ': 'j', 'ঝ': 'j', 'ঞ': 'n',
  'ট': 't', 'ঠ': 't', 'ড': 'd', 'ঢ': 'd', 'ণ': 'n',
  'ত': 't', 'থ': 't', 'দ': 'd', 'ধ': 'd', 'ন': 'n',
  'প': 'p', 'ফ': 'f', 'ব': 'b', 'ভ': 'b', 'ম': 'm',
  'য': 'j', 'র': 'r', 'ল': 'l', 'শ': 's', 'ষ': 's',
  'স': 's', 'হ': 'h', 'ৎ': 't', 'ং': 'ng',
};
const NUKTA = '়'; // ড় ঢ় য় decompose to base + nukta under NFC

function bengaliSkeleton(token: string): string {
  const chars = [...token.normalize('NFC')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (chars[i + 1] === NUKTA) {
      if (c === 'ড' || c === 'ঢ') out += 'r';
      // য় is a vowel glide -> dropped
      i++;
      continue;
    }
    // precomposed forms, in case input was not decomposed
    if (c === 'ড়' || c === 'ঢ়') { out += 'r'; continue; }
    if (c === 'য়') continue;
    out += BN_CONSONANT[c] ?? '';
  }
  return out;
}

function latinSkeleton(token: string): string {
  return token
    .toLowerCase()
    .replace(/sh/g, 's').replace(/ch/g, 'c').replace(/kh/g, 'k')
    .replace(/gh/g, 'g').replace(/ph/g, 'f').replace(/th/g, 't')
    .replace(/dh/g, 'd').replace(/bh/g, 'b').replace(/jh/g, 'j')
    .replace(/z/g, 'j').replace(/q/g, 'k').replace(/v/g, 'b').replace(/x/g, 'ks')
    .replace(/[^a-z]/g, '')
    .replace(/[aeiouwy]/g, '');
}

/** Split a name into meaningful tokens, dropping honorifics. */
export function nameTokens(name: string): string[] {
  return toAsciiDigits(name)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,\-_/()'"`]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !HONORIFICS.has(t) && !HONORIFICS.has(t.replace(/ঃ$/, '')));
}

/**
 * Phonetic key for a person's name that is stable across Bangla/English
 * spelling and common honorific variations. Used for duplicate detection.
 */
export function nameKey(name: string): string {
  const key = nameTokens(name)
    .map((t) => (/[ঀ-৿]/.test(t) ? bengaliSkeleton(t) : latinSkeleton(t)))
    .join('');
  return key.replace(/(.)\1+/g, '$1'); // collapse repeats: hossain -> hsn
}

/** Classic Levenshtein distance (small strings only). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Two name keys refer to the same name (allowing one spelling slip on longer names). */
export function namesSimilar(keyA: string, keyB: string): boolean {
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  return Math.min(keyA.length, keyB.length) >= 4 && levenshtein(keyA, keyB) <= 1;
}

export function maskPhone(phone: string | null): string | null {
  return phone ? `${phone.slice(0, 3)}*****${phone.slice(-3)}` : null;
}
