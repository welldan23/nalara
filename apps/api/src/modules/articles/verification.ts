// Verification label (ADR-019, pattern from VORSA x SENTINEL): earned from the citations, never
// declared by the client. Recomputed on every save, preview and (P1-03) publish.
import type { Citation } from './content.ts';

export const VERIFICATION_LEVELS = ['TERVERIFIKASI', 'SEBAGIAN', 'BELUM_TERVERIFIKASI'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

/** Indonesian second-level domains where the organisation sits one label further left. */
const SECOND_LEVEL = new Set([
  'co.id',
  'go.id',
  'or.id',
  'ac.id',
  'web.id',
  'my.id',
  'sch.id',
  'mil.id',
  'co.uk',
  'org.uk',
  'gov.uk',
  'ac.uk',
  'com.au',
  'gov.au',
  'co.jp',
  'go.jp',
]);

/**
 * The publisher's registrable domain, so two pages of the same outlet count once:
 * www.bps.go.id and webapi.bps.go.id are both "bps.go.id".
 */
export function publisherKey(url: string): string {
  const labels = new URL(url).hostname.toLowerCase().replace(/\.$/, '').split('.');
  const lastTwo = labels.slice(-2).join('.');
  return SECOND_LEVEL.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

export function verificationLevel(citations: readonly Citation[]): VerificationLevel {
  const verified = citations.filter((citation) => citation.verified);
  if (verified.length === 0) return 'BELUM_TERVERIFIKASI';
  if (verified.some((citation) => citation.primary)) return 'TERVERIFIKASI';
  const publishers = new Set(verified.map((citation) => publisherKey(citation.url)));
  return publishers.size >= 2 ? 'TERVERIFIKASI' : 'SEBAGIAN';
}
