// CSRF defences (ADR-004): same-origin check + synchronizer token bound to the session.
// The token is an HMAC of the session id under SESSION_SECRET, so it needs no storage and is
// useless for any other session.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CSRF_HEADER = 'x-csrf-token';
export const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function csrfTokenFor(secret: string, sessionId: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionId}`, 'utf8').digest('base64url');
}

export function isValidCsrfToken(secret: string, sessionId: string, provided: unknown): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || provided.length > 128) return false;
  const expected = Buffer.from(csrfTokenFor(secret, sessionId), 'utf8');
  const actual = Buffer.from(provided, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type OriginVerdict = 'same-origin' | 'cross-origin' | 'unknown';

/**
 * Classify a request from its Origin and Sec-Fetch-Site headers. Browsers send at least one on
 * every unsafe request; 'unknown' means a non-browser client.
 */
export function originVerdict(
  appOrigin: string,
  origin: string | undefined,
  secFetchSite: string | undefined,
): OriginVerdict {
  if (origin !== undefined) return origin === appOrigin ? 'same-origin' : 'cross-origin';
  if (secFetchSite !== undefined) {
    return secFetchSite === 'same-origin' || secFetchSite === 'none'
      ? 'same-origin'
      : 'cross-origin';
  }
  return 'unknown';
}
