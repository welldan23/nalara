// Editorial state machine (P1-03, ADR-012, PRD v4 §6.2):
//
//   draft ──submit──▶ in_review ──approve──▶ approved ──publish──▶ published ──archive──▶ archived
//     ▲                  │                                                         ▲
//     └─────return───────┘                    draft ──archive──────────────────────┘
//
// Every transition runs in one transaction with the article row locked, re-checks the expected
// version, re-hashes the stored revision, and writes an immutable publication event + audit.
import { asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { articleRevisions, articles, publicationEvents } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { recordAudit } from '../audit/audit.ts';
import type { AuditAction } from '../audit/audit.ts';
import type { Actor } from './articles.ts';
import { contentSha256, revisionContentSchema } from './content.ts';
import type { RevisionContent } from './content.ts';
import { publishGate } from './gate.ts';
import type { GateBlocker } from './gate.ts';
import type { VerificationLevel } from './verification.ts';

type Db = NodePgDatabase<typeof schema>;
type Status = (typeof articles.$inferSelect)['status'];

export const TRANSITIONS = {
  submit: { from: ['draft'], to: 'in_review' },
  return: { from: ['in_review'], to: 'draft' },
  approve: { from: ['in_review'], to: 'approved' },
  publish: { from: ['approved'], to: 'published' },
  archive: { from: ['draft', 'published'], to: 'archived' },
} as const satisfies Record<string, { from: readonly Status[]; to: Status }>;

export type TransitionAction = keyof typeof TRANSITIONS;

export interface TransitionInput {
  readonly expectedVersion: number;
  /** Required for `return` (why it goes back); optional otherwise. */
  readonly note?: string;
  /** `approve` only: the founder's written reason to publish without a verified source. */
  readonly sourceException?: string;
}

export interface TransitionResult {
  readonly status: Status;
  readonly verification: VerificationLevel;
}

/** Thrown when the publish gate refuses; carries the reasons for the editor. */
export class GateBlockedError extends AppError {
  readonly blockers: readonly GateBlocker[];

  constructor(blockers: readonly GateBlocker[]) {
    super(
      'GATE_BLOCKED',
      blockers.map((blocker) => ({ path: 'gate', rule: blocker })),
    );
    this.blockers = blockers;
  }
}

function storedContent(row: typeof articleRevisions.$inferSelect): RevisionContent {
  // Re-validate what the database holds: a revision that no longer matches the content schema
  // must never be approved or published.
  const parsed = revisionContentSchema.safeParse({
    title: row.title,
    dek: row.dek,
    articleType: row.articleType,
    categoryId: row.categoryId,
    body: row.body,
    bodySource: row.bodySource,
    methodNote: row.methodNote,
    citations: row.citations,
  });
  if (!parsed.success) throw new Error(`stored revision ${row.id} fails the content schema`);
  return parsed.data;
}

const AUDIT_ACTION: Readonly<Record<TransitionAction, AuditAction>> = {
  submit: 'article.submit',
  return: 'article.return',
  approve: 'article.approve',
  publish: 'article.publish',
  archive: 'article.archive',
};

export async function transition(
  db: Db,
  actor: Actor,
  articleId: string,
  action: TransitionAction,
  input: TransitionInput,
): Promise<TransitionResult> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'expectedVersion', rule: 'invalid' }]);
  }
  const note = input.note?.trim() ?? '';
  if (action === 'return' && note.length < 5) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'note', rule: 'too_small' }]);
  }
  if (note.length > 500)
    throw new AppError('VALIDATION_FAILED', [{ path: 'note', rule: 'too_big' }]);
  const exception = input.sourceException?.trim() ?? '';
  if (
    exception !== '' &&
    (action !== 'approve' || exception.length < 20 || exception.length > 500)
  ) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'sourceException', rule: 'invalid' }]);
  }

  return db.transaction(async (tx) => {
    const [article] = await tx
      .select()
      .from(articles)
      .where(eq(articles.id, articleId))
      .for('update');
    if (article === undefined) throw new AppError('NOT_FOUND');
    if (article.currentVersion !== input.expectedVersion) throw new AppError('VERSION_CONFLICT');
    const rule = TRANSITIONS[action];
    if (!(rule.from as readonly Status[]).includes(article.status)) {
      throw new AppError('INVALID_TRANSITION');
    }
    if (article.currentRevisionId === null) throw new Error('article has no current revision');
    const [revision] = await tx
      .select()
      .from(articleRevisions)
      .where(eq(articleRevisions.id, article.currentRevisionId));
    if (revision === undefined) throw new Error('current revision missing');

    // The stored hash must still describe the stored content (tamper / drift check).
    const content = storedContent(revision);
    const hash = contentSha256(content);
    if (!hash.equals(revision.contentSha256)) throw new AppError('INTEGRITY_FAILED');

    const now = new Date();
    let verification = publishGate(content).verification;
    const changes: Partial<typeof articles.$inferInsert> = { status: rule.to, updatedAt: now };

    if (action === 'approve') {
      const gate = publishGate(content, { sourceException: exception });
      if (gate.blockers.length > 0) throw new GateBlockedError(gate.blockers);
      verification = gate.verification;
      Object.assign(changes, {
        approvedRevisionId: revision.id,
        approvedContentSha256: hash,
        approvedBy: actor.userId,
        approvedAt: now,
        sourceException:
          exception === '' || verification !== 'BELUM_TERVERIFIKASI' ? null : exception,
      });
    }

    if (action === 'publish') {
      // Publish exactly the approved bytes, and re-run the gate on them (PRD v4 §7).
      if (
        article.approvedRevisionId !== revision.id ||
        article.approvedContentSha256?.equals(hash) !== true
      ) {
        throw new GateBlockedError(['revision_changed_after_approval']);
      }
      const gate = publishGate(content, { sourceException: article.sourceException });
      if (gate.blockers.length > 0) throw new GateBlockedError(gate.blockers);
      verification = gate.verification;
      Object.assign(changes, {
        publishedAt: now,
        firstPublishedAt: article.firstPublishedAt ?? now,
      });
    }

    if (action === 'return') {
      Object.assign(changes, {
        approvedRevisionId: null,
        approvedContentSha256: null,
        approvedBy: null,
        approvedAt: null,
        sourceException: null,
      });
    }

    await tx.update(articles).set(changes).where(eq(articles.id, article.id));
    await tx.insert(publicationEvents).values({
      articleId: article.id,
      revisionId: revision.id,
      action,
      fromStatus: article.status,
      toStatus: rule.to,
      contentSha256: hash,
      verification,
      note: action === 'approve' && exception !== '' ? exception : note === '' ? null : note,
      actorId: actor.userId,
    });
    const metadata: Record<string, string | number | boolean> = { version: revision.version };
    if (action === 'approve' || action === 'publish') metadata['verification'] = verification;
    if (action === 'approve') metadata['source_exception'] = exception !== '';
    await recordAudit(tx, {
      action: AUDIT_ACTION[action],
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'article',
      resourceId: article.id,
      ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
      metadata,
    });
    return { status: rule.to, verification };
  });
}

export interface PublicationEventView {
  readonly action: TransitionAction;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly revisionId: string;
  readonly verification: VerificationLevel;
  readonly note: string | null;
  readonly createdAt: Date;
}

export async function listPublicationEvents(
  db: Db,
  articleId: string,
): Promise<PublicationEventView[]> {
  return db
    .select({
      action: publicationEvents.action,
      fromStatus: publicationEvents.fromStatus,
      toStatus: publicationEvents.toStatus,
      revisionId: publicationEvents.revisionId,
      verification: publicationEvents.verification,
      note: publicationEvents.note,
      createdAt: publicationEvents.createdAt,
    })
    .from(publicationEvents)
    .where(eq(publicationEvents.articleId, articleId))
    .orderBy(asc(publicationEvents.createdAt), asc(publicationEvents.id));
}
