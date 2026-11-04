// Append-only audit writes with a per-action metadata allowlist (PRD B §7, ADR-009), so secrets
// or free-form payloads cannot slip into the audit log by accident.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { auditEvents } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';

/** Every audit action and the only metadata keys it may carry. */
export const AUDIT_ACTIONS = {
  'founder.bootstrap': [],
  'session.logout': [],
  'auth.password': [],
  'auth.mfa': ['method'],
  'mfa.enrol': [],
  'mfa.recovery_rotate': [],
  'article.create': ['version'],
  'article.revise': ['version', 'returned_to_draft'],
  'article.submit': ['version'],
  'article.return': ['version'],
  'article.approve': ['version', 'verification', 'source_exception'],
  'article.publish': ['version', 'verification'],
  'article.archive': ['version'],
  'article.correct': ['version', 'verification', 'substantial'],
  'source.create': ['version', 'status', 'license_status'],
  // `changed`: comma-separated field names only, never their values.
  'source.update': ['version', 'status', 'license_status', 'changed'],
  'source.check_feed': ['queued'],
  'source.release_feed': ['check_queued'],
  // `removed`: names of stripped metadata parts (e.g. "EXIF,XMP"), never their contents.
  'media.upload': ['mime', 'width', 'height', 'bytes', 'usage_basis', 'licensed', 'removed'],
  'media.update': ['version', 'usage_basis', 'licensed', 'changed'],
} as const satisfies Record<string, readonly string[]>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export interface AuditEvent {
  readonly action: AuditAction;
  readonly actorType: 'founder' | 'system';
  readonly actorId?: string;
  readonly result: 'success' | 'failure' | 'denied';
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly requestId?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export class AuditMetadataError extends Error {
  constructor(action: string, key: string) {
    super(`audit metadata key "${key}" is not allowed for action ${action}`);
    this.name = 'AuditMetadataError';
  }
}

type Db = Pick<NodePgDatabase<typeof schema>, 'insert'>;

export async function recordAudit(db: Db, event: AuditEvent): Promise<void> {
  const allowed: readonly string[] = AUDIT_ACTIONS[event.action];
  const metadata = event.metadata ?? {};
  for (const key of Object.keys(metadata)) {
    if (!allowed.includes(key)) throw new AuditMetadataError(event.action, key);
  }
  await db.insert(auditEvents).values({
    action: event.action,
    actorType: event.actorType,
    actorId: event.actorId ?? null,
    result: event.result,
    resourceType: event.resourceType ?? null,
    resourceId: event.resourceId ?? null,
    requestId: event.requestId ?? null,
    metadata,
  });
}
