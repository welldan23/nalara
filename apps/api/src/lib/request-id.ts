// Request correlation IDs (PRD B §6.3, ADR-006). An incoming X-Request-ID is reused only if it
// is short and plain; anything else is replaced so attackers cannot inject log content.
import { randomBytes } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';
const ACCEPTED_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function newRequestId(): string {
  return `req_${randomBytes(12).toString('base64url')}`;
}

export function requestIdFrom(header: string | string[] | undefined): string {
  return typeof header === 'string' && ACCEPTED_ID.test(header) ? header : newRequestId();
}
