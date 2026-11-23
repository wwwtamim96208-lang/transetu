import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

/** An error that maps directly to an HTTP response. Messages are user-facing (Bangla). */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/**
 * Reject cross-site state-changing requests. Together with SameSite=Lax
 * session cookies this protects against CSRF.
 */
function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return; // non-browser clients (curl, tests) send no Origin
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (new URL(origin).host !== host) {
    throw new HttpError(403, 'BAD_ORIGIN', 'অনুমোদিত উৎস থেকে অনুরোধ আসেনি।');
  }
}

function toResponse(e: unknown) {
  if (e instanceof HttpError) {
    return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
  }
  if (e instanceof ZodError) {
    return json(
      { error: { code: 'VALIDATION_ERROR', message: 'কিছু তথ্য সঠিক নয়।', details: e.flatten().fieldErrors } },
      400,
    );
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return json({ error: { code: 'CONFLICT', message: 'এই তথ্য দিয়ে আগেই একটি রেকর্ড আছে।' } }, 409);
  }
  if (e instanceof SyntaxError) {
    return json({ error: { code: 'BAD_JSON', message: 'অনুরোধের ফরম্যাট সঠিক নয়।' } }, 400);
  }
  console.error(e);
  return json({ error: { code: 'INTERNAL', message: 'সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।' } }, 500);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap a route handler: origin check for mutations + uniform error responses. */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (e) {
      return toResponse(e);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 100_000) throw new HttpError(413, 'TOO_LARGE', 'অনুরোধ অনেক বড়।');
  return text ? JSON.parse(text) : {};
}
