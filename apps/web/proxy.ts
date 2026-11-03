// UX-only redirect (Next 16 "proxy", formerly middleware; K-10). Not a security boundary:
// the API authorises every request, and /os pages re-check the session server-side (ADR-002).
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = '__Host-nalara_session';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname === '/os/login' || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL('/os/login', request.url));
}

export const config = { matcher: ['/os', '/os/:path*'] };
