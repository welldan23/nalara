// Per-request Content-Security-Policy with a nonce (P1-10b, ADR-017), plus the UX-only redirect
// for /os (Next 16 "proxy", formerly middleware; K-10).
//
// Scripts run only with this response's nonce (or when loaded by such a script: 'strict-dynamic').
// There is no 'unsafe-inline' for scripts, so injected markup cannot run code. Next.js reads the
// policy from the request headers set here and puts the nonce on its own scripts; every HTML page
// is rendered per request (ADR-013), so each response has a fresh nonce.
//
// Styles keep 'unsafe-inline' for now (Next.js and the token <style> need it). Residual risk,
// recorded in docs/phase-1/PROGRESS.md: CSS injection cannot run scripts.
//
// The /os redirect is UX only, not a security boundary: the API authorises every request, and
// /os pages re-check the session server-side (ADR-002).
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = '__Host-nalara_session';

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isOs = pathname === '/os' || pathname.startsWith('/os/');
  if (isOs && pathname !== '/os/login' && !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL('/os/login', request.url));
  }

  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Every page and metadata route; not the API (proxied to Fastify), build assets or static
      // files, which get Caddy's strict default policy instead.
      source: '/((?!api/|_next/static|_next/image|brand/).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
