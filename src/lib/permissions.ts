import type { Prisma } from '@prisma/client';
import type { SessionUser } from './auth';

// Permission matrix (also in README):
//                        ADMIN   COORDINATOR          VOLUNTEER
// view households        all     all                  own union only
// create household       yes     yes                  own union only
// edit household         all     own organisation's   ones they created
// delete (soft)          yes     no                   no

/** Prisma filter limiting which households a user can see. */
export function householdScope(user: SessionUser): Prisma.HouseholdWhereInput {
  const base: Prisma.HouseholdWhereInput = { deletedAt: null };
  if (user.role === 'VOLUNTEER') {
    // A volunteer without an assigned union sees nothing.
    return { ...base, ward: { parentId: user.areaId ?? '00000000-0000-0000-0000-000000000000' } };
  }
  return base;
}

export function canViewHousehold(user: SessionUser, h: { ward: { parentId: string | null } }) {
  return user.role !== 'VOLUNTEER' || (!!user.areaId && h.ward.parentId === user.areaId);
}

export function canEditHousehold(user: SessionUser, h: { createdById: string; createdByOrgId: string; ward: { parentId: string | null } }) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'COORDINATOR') return h.createdByOrgId === user.orgId;
  return h.createdById === user.id && canViewHousehold(user, h);
}

export function canDeleteHousehold(user: SessionUser) {
  return user.role === 'ADMIN';
}

/** Volunteers may only register households in wards of their own union. */
export function canUseWard(user: SessionUser, ward: { parentId: string | null }) {
  return user.role !== 'VOLUNTEER' || (!!user.areaId && ward.parentId === user.areaId);
}
