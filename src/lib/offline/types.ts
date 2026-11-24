// Shapes shared by the server (pack builder, sync endpoint) and the device.
// No imports: safe for both bundles.

export type PackStatus = 'AWAITING_CONFIRMATION' | 'DELIVERED';

export interface PackHousehold {
  id: string;
  headName: string;
  phoneMasked: string | null;
  wardName: string;
  memberCount: number;
  femaleHeaded: boolean;
  damageLevel: 'NONE' | 'PARTIAL' | 'SEVERE' | 'TOTAL';
  /** PBKDF2 hash of the card code: verifies codes offline, cannot reveal them. */
  tokenHash: string;
  members: { age: number; disability: boolean; chronicIllness: boolean; pregnant: boolean }[];
}

export interface PackCategory {
  id: string;
  code: string;
  nameBn: string;
  unit: string;
  needBasis: 'PER_PERSON' | 'PER_HOUSEHOLD';
  needPerDay: number;
  cooldownDays: number;
}

export interface PackAllotment {
  id: string;
  categoryId: string;
  quantity: number;
  /** Server-side remaining at download time. */
  remaining: number;
}

export interface PackDelivery {
  id: string;
  householdId: string;
  categoryId: string;
  occurredAt: string;
  status: PackStatus;
  orgName: string;
}

export interface FieldPack {
  version: 1;
  downloadedAt: string;
  validUntil: string;
  user: { id: string; name: string; orgName: string };
  unionName: string;
  households: PackHousehold[];
  categories: PackCategory[];
  allotments: PackAllotment[];
  deliveries: PackDelivery[];
}

export type SyncState = 'pending' | 'synced' | 'rejected';

/** A distribution recorded on the device, waiting to be (or already) synced. */
export interface OutboxItem {
  id: string;
  /** Owner on this device: a shared phone must never push another volunteer's records. */
  volunteerId: string;
  householdId: string;
  categoryId: string;
  allotmentId: string;
  quantity: number;
  status: 'AWAITING_CONFIRMATION' | 'DELIVERED' | 'FAILED';
  occurredAt: string;
  /** Kept only until synced, so the server can re-verify it. */
  confirmCode?: string;
  confirmAttempts: number;
  overrideReason?: string;
  note?: string;
  createdOffline: boolean;
  syncState: SyncState;
  syncedAt?: string;
  serverStatus?: string;
  flags?: string[];
  error?: string;
  updatedAt: string;
}

export type SyncResultKind = 'created' | 'updated' | 'duplicate' | 'unchanged' | 'rejected';

export interface SyncResult {
  id: string;
  result: SyncResultKind;
  status?: string;
  flags: string[];
  error?: string;
  /** Transient server problem: keep the item pending and try again later. */
  retryable?: boolean;
}
