import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Append-only audit trail. Pass the transaction client so the log commits with the change. */
export async function audit(db: Db, e: AuditEntry) {
  await db.auditLog.create({
    data: {
      userId: e.userId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
