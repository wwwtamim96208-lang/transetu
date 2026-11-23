import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { prisma } from './db';
import { env } from './env';
import { HttpError } from './http';
import { audit } from './audit';

export const SESSION_COOKIE = 'ts_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // one field shift
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
// Used when the email does not exist, so response time does not reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string;
  orgName: string;
  areaId: string | null;
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function login(email: string, password: string, userAgent: string | null): Promise<SessionUser> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() }, include: { org: true } });
  const invalid = new HttpError(401, 'INVALID_CREDENTIALS', 'ইমেইল বা পাসওয়ার্ড ভুল।');

  if (!user || !user.isActive) {
    await bcrypt.compare(password, DUMMY_HASH);
    await audit(prisma, { action: 'LOGIN_FAILED', entityType: 'User', after: { email } });
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(429, 'ACCOUNT_LOCKED', 'অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে। ১৫ মিনিট পর চেষ্টা করুন।');
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null },
    });
    await audit(prisma, { userId: user.id, action: lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', entityType: 'User', entityId: user.id });
    throw invalid;
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt, userAgent: userAgent?.slice(0, 200) } });
  await audit(prisma, { userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  return toSessionUser(user);
}

export async function logout() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  store.delete(SESSION_COOKIE);
}

/** Returns the logged-in user, or null. Expired sessions and deactivated users are rejected. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { org: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
  return toSessionUser(session.user);
}

/** Throws 401 when not logged in, 403 when the role is not allowed. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'আগে লগইন করুন।');
  if (roles && !roles.includes(user.role)) throw new HttpError(403, 'FORBIDDEN', 'এই কাজের অনুমতি আপনার নেই।');
  return user;
}

function toSessionUser(u: { id: string; email: string; name: string; role: Role; orgId: string; areaId: string | null; org: { nameBn: string } }): SessionUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, orgId: u.orgId, orgName: u.org.nameBn, areaId: u.areaId };
}

export const ROLE_BN: Record<Role, string> = {
  ADMIN: 'প্রশাসক',
  COORDINATOR: 'সমন্বয়কারী',
  VOLUNTEER: 'স্বেচ্ছাসেবী',
};
