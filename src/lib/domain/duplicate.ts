import { namesSimilar } from './normalize';

/**
 * Three-tier duplicate policy:
 *  BLOCK  - same NID. Registration is refused.
 *  FLAG   - same phone. Allowed only with explicit confirmation + reason
 *           (phones are often shared between families); a review item is created.
 *  REVIEW - similar head-of-household name in the same ward. Allowed, but a
 *           review item is created for a coordinator to check.
 */
export type DupLevel = 'BLOCK' | 'FLAG' | 'REVIEW';
export type DupReason = 'NID_MATCH' | 'PHONE_MATCH' | 'NAME_SIMILAR_SAME_WARD';

export interface DupCandidate {
  id: string;
  headNameKey: string;
  phone: string | null;
  nidHash: string | null;
  wardId: string;
}

export interface DupInput {
  headNameKey: string;
  phone: string | null;
  nidHash: string | null;
  wardId: string;
  excludeId?: string;
}

export interface DupMatch {
  householdId: string;
  level: DupLevel;
  reasons: DupReason[];
}

const RANK: Record<DupLevel, number> = { BLOCK: 3, FLAG: 2, REVIEW: 1 };
const LEVEL_OF: Record<DupReason, DupLevel> = {
  NID_MATCH: 'BLOCK',
  PHONE_MATCH: 'FLAG',
  NAME_SIMILAR_SAME_WARD: 'REVIEW',
};

export function findDuplicates(input: DupInput, candidates: DupCandidate[]): DupMatch[] {
  const matches: DupMatch[] = [];
  for (const c of candidates) {
    if (c.id === input.excludeId) continue;
    const reasons: DupReason[] = [];
    if (input.nidHash && c.nidHash && input.nidHash === c.nidHash) reasons.push('NID_MATCH');
    if (input.phone && c.phone && input.phone === c.phone) reasons.push('PHONE_MATCH');
    if (c.wardId === input.wardId && namesSimilar(input.headNameKey, c.headNameKey)) {
      reasons.push('NAME_SIMILAR_SAME_WARD');
    }
    if (!reasons.length) continue;
    const level = reasons.map((r) => LEVEL_OF[r]).sort((a, b) => RANK[b] - RANK[a])[0];
    matches.push({ householdId: c.id, level, reasons });
  }
  return matches.sort((a, b) => RANK[b.level] - RANK[a.level]);
}

export const DUP_REASON_BN: Record<DupReason, string> = {
  NID_MATCH: 'একই NID',
  PHONE_MATCH: 'একই ফোন নম্বর',
  NAME_SIMILAR_SAME_WARD: 'একই ওয়ার্ডে প্রায় একই নাম',
};
