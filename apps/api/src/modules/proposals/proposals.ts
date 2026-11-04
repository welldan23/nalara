// Proposals and approvals (P3-01, ADR-020). An agent never changes anything itself: it files a
// proposal, and only the founder's approval applies it through the same modules the founder uses.
// - Payloads are validated per kind when filed and again when applied.
// - The target's version is read by the server when the proposal is filed (never trusted from the
//   agent); if the target changed since, applying fails instead of overwriting newer work.
// - A proposal is decided once. Approving applies it inside the decision's transaction; a refusal
//   from the target module marks it failed with a stable code, and nothing is half-applied.
// - Sources created from a proposal are always `candidate`: the founder still checks the licence
//   before anything is fetched.
import { and, count, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import {
  AGENT_ROLES,
  PROPOSAL_KINDS,
  agentPreferences,
  aiActionProposals,
  approvals,
  articles,
  discoveredItems,
  sources,
} from '../../db/schema.ts';
import type { PROPOSAL_STATUSES, schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import type { ErrorCode } from '../../lib/errors.ts';
import { parseOrThrow } from '../../lib/validation.ts';
import { plainText } from '../articles/content.ts';
import { recordAudit } from '../audit/audit.ts';
import { createSource, getSource, sourceInputSchema, updateSource } from '../sources/sources.ts';
import type { Actor } from '../sources/sources.ts';

type Db = NodePgDatabase<typeof schema>;

export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export type AgentRole = (typeof AGENT_ROLES)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

const reasonSchema = plainText(1000).trim().min(1);

/** Source fields an agent may propose; never `status` (verifying is the founder's own act). */
const SOURCE_FIELDS = [
  'name',
  'organization',
  'type',
  'officialUrl',
  'licenseStatus',
  'licenseNote',
  'attribution',
  'notes',
  'feedUrl',
] as const;

const sourceFields = z
  .record(z.string(), z.unknown())
  .refine(
    (value) =>
      Object.keys(value).every((key) => (SOURCE_FIELDS as readonly string[]).includes(key)),
    'unknown_field',
  );

const PAYLOADS = {
  'sources.propose_create': z.strictObject({ source: sourceFields }),
  'sources.propose_update': z.strictObject({
    changes: sourceFields.refine((value) => Object.keys(value).length > 0, 'empty'),
  }),
  'preferences.propose_update': z
    .strictObject({
      topics: z.array(plainText(40).trim().min(2)).min(1).max(20).optional(),
      notes: plainText(2000).optional(),
    })
    .refine((value) => value.topics !== undefined || value.notes !== undefined, 'empty'),
  'inbox.propose_flag': z.strictObject({
    topic: plainText(40).trim().min(2),
    relevance: z.enum(['high', 'medium']),
  }),
  'articles.propose_note': z.strictObject({
    notes: z
      .array(
        z.strictObject({
          quote: plainText(300).default(''),
          issue: plainText(500).trim().min(1),
        }),
      )
      .min(1)
      .max(20),
  }),
} as const satisfies Record<ProposalKind, z.ZodType>;

/** Which target each kind needs (preferences are a single row, addressed by version only). */
const TARGETS = {
  'sources.propose_create': null,
  'sources.propose_update': 'source',
  'preferences.propose_update': null,
  'inbox.propose_flag': 'discovered_item',
  'articles.propose_note': 'article',
} as const satisfies Record<ProposalKind, string | null>;

const filingSchema = z.strictObject({
  kind: z.enum(PROPOSAL_KINDS),
  payload: z.record(z.string(), z.unknown()),
  reason: reasonSchema,
  targetId: z.uuid().optional(),
});

export interface ProposalView {
  readonly id: string;
  readonly kind: ProposalKind;
  readonly agentRole: AgentRole;
  readonly payload: Record<string, unknown>;
  readonly reason: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly targetVersion: number | null;
  /** `expired` is reported as soon as the deadline passes, even before anyone decides. */
  readonly status: ProposalStatus;
  readonly failure: string | null;
  readonly resultId: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly decidedAt: Date | null;
}

const columns = {
  id: aiActionProposals.id,
  kind: aiActionProposals.kind,
  agentRole: aiActionProposals.agentRole,
  payload: aiActionProposals.payload,
  reason: aiActionProposals.reason,
  targetType: aiActionProposals.targetType,
  targetId: aiActionProposals.targetId,
  targetVersion: aiActionProposals.targetVersion,
  status: sql<ProposalStatus>`CASE WHEN ${aiActionProposals.status} = 'pending'
    AND ${aiActionProposals.expiresAt} <= now() THEN 'expired' ELSE ${aiActionProposals.status} END`,
  failure: aiActionProposals.failure,
  resultId: aiActionProposals.resultId,
  createdAt: aiActionProposals.createdAt,
  expiresAt: aiActionProposals.expiresAt,
  decidedAt: aiActionProposals.decidedAt,
};

function invalid(path: string, rule: string): AppError {
  return new AppError('VALIDATION_FAILED', [{ path, rule }]);
}

/** Current version of the target, read by the server; refuses targets that do not exist. */
async function targetVersion(
  db: Db,
  kind: ProposalKind,
  targetId: string | undefined,
): Promise<number | null> {
  const type = TARGETS[kind];
  if (type === null && targetId !== undefined) throw invalid('targetId', 'not_allowed');
  if (type !== null && targetId === undefined) throw invalid('targetId', 'required');
  switch (kind) {
    case 'sources.propose_create':
      return null;
    case 'preferences.propose_update': {
      const [row] = await db.select({ version: agentPreferences.version }).from(agentPreferences);
      return row?.version ?? 1;
    }
    case 'sources.propose_update': {
      const [row] = await db
        .select({ version: sources.version })
        .from(sources)
        .where(eq(sources.id, targetId ?? ''));
      if (row === undefined) throw invalid('targetId', 'not_found');
      return row.version;
    }
    case 'inbox.propose_flag': {
      const [row] = await db
        .select({ id: discoveredItems.id })
        .from(discoveredItems)
        .where(eq(discoveredItems.id, targetId ?? ''));
      if (row === undefined) throw invalid('targetId', 'not_found');
      return null;
    }
    case 'articles.propose_note': {
      const [row] = await db
        .select({ version: articles.currentVersion, status: articles.status })
        .from(articles)
        .where(eq(articles.id, targetId ?? ''));
      if (row === undefined) throw invalid('targetId', 'not_found');
      if (row.status !== 'draft' && row.status !== 'in_review') throw invalid('targetId', 'state');
      return row.version;
    }
  }
}

/** The source as it would be after the proposal; must pass the founder's own validation. */
async function proposedSource(
  db: Db,
  kind: ProposalKind,
  payload: Record<string, unknown>,
  targetId: string | null,
): Promise<{ id: string | null; input: Record<string, unknown> }> {
  if (kind === 'sources.propose_create') {
    const fields = (payload as { source: Record<string, unknown> }).source;
    return { id: null, input: { ...fields, status: 'candidate' } };
  }
  const current = await getSource(db, targetId ?? '');
  if (current === null) throw new AppError('NOT_FOUND');
  const changes = (payload as { changes: Record<string, unknown> }).changes;
  const base: Record<string, unknown> = { status: current.status };
  for (const key of SOURCE_FIELDS) base[key] = current[key];
  return { id: current.id, input: { ...base, ...changes } };
}

export interface FileProposal {
  readonly role: AgentRole;
  readonly kind: ProposalKind;
  readonly payload: Record<string, unknown>;
  readonly reason: string;
  readonly targetId?: string;
}

/** Files a proposal (used by the agent gateway, P3-02). Nothing else changes. */
export async function fileProposal(db: Db, raw: FileProposal): Promise<ProposalView> {
  if (!(AGENT_ROLES as readonly string[]).includes(raw.role)) throw invalid('role', 'unknown');
  const filing = parseOrThrow(filingSchema, {
    kind: raw.kind,
    payload: raw.payload,
    reason: raw.reason,
    ...(raw.targetId === undefined ? {} : { targetId: raw.targetId }),
  });
  const payload = parseOrThrow(PAYLOADS[filing.kind], filing.payload) as Record<string, unknown>;
  const version = await targetVersion(db, filing.kind, filing.targetId);
  if (filing.kind === 'sources.propose_create' || filing.kind === 'sources.propose_update') {
    const { input } = await proposedSource(db, filing.kind, payload, filing.targetId ?? null);
    parseOrThrow(sourceInputSchema, input);
  }
  const type = TARGETS[filing.kind];
  const [row] = await db
    .insert(aiActionProposals)
    .values({
      kind: filing.kind,
      agentRole: raw.role,
      payload,
      reason: filing.reason,
      targetType: type,
      targetId: filing.targetId ?? null,
      targetVersion: version,
      expiresAt: sql`now() + interval '7 days'`,
    })
    .returning(columns);
  if (row === undefined) throw new Error('insert returned no row');
  return row;
}

const PAGE = 50;
const cursorSchema = z.strictObject({ t: z.iso.datetime(), i: z.uuid() });

function decodeCursor(cursor: string) {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { at: new Date(parsed.t), id: parsed.i };
  } catch {
    throw invalid('cursor', 'invalid');
  }
}

export async function listProposals(
  db: Db,
  options: { readonly status?: ProposalStatus; readonly cursor?: string } = {},
): Promise<{ items: ProposalView[]; nextCursor: string | null }> {
  const conditions: SQL[] = [];
  const status = options.status ?? 'pending';
  const live = sql`${aiActionProposals.expiresAt} > now()`;
  if (status === 'pending') {
    conditions.push(eq(aiActionProposals.status, 'pending'), live);
  } else if (status === 'expired') {
    const expired = or(
      eq(aiActionProposals.status, 'expired'),
      and(eq(aiActionProposals.status, 'pending'), sql`NOT (${live})`),
    );
    if (expired !== undefined) conditions.push(expired);
  } else {
    conditions.push(eq(aiActionProposals.status, status));
  }
  if (options.cursor !== undefined) {
    const after = decodeCursor(options.cursor);
    const older = or(
      lt(aiActionProposals.createdAt, after.at),
      and(eq(aiActionProposals.createdAt, after.at), lt(aiActionProposals.id, after.id)),
    );
    if (older !== undefined) conditions.push(older);
  }
  const rows = await db
    .select(columns)
    .from(aiActionProposals)
    .where(and(...conditions))
    .orderBy(desc(aiActionProposals.createdAt), desc(aiActionProposals.id))
    .limit(PAGE + 1);
  const items = rows.slice(0, PAGE);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > PAGE && last !== undefined
        ? Buffer.from(
            JSON.stringify({ t: last.createdAt.toISOString(), i: last.id }),
            'utf8',
          ).toString('base64url')
        : null,
  };
}

export async function countPendingProposals(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(aiActionProposals)
    .where(
      and(eq(aiActionProposals.status, 'pending'), sql`${aiActionProposals.expiresAt} > now()`),
    );
  return row?.n ?? 0;
}

export interface ProposalDetail extends ProposalView {
  /** A short human label for the target, for the founder's screen. */
  readonly target: { readonly label: string; readonly currentVersion: number | null } | null;
  readonly decision: {
    readonly decision: 'approve' | 'reject';
    readonly channel: 'os' | 'telegram';
    readonly decidedAt: Date;
  } | null;
}

async function targetLabel(db: Db, proposal: ProposalView): Promise<ProposalDetail['target']> {
  const id = proposal.targetId;
  if (proposal.kind === 'preferences.propose_update') {
    const [row] = await db.select({ version: agentPreferences.version }).from(agentPreferences);
    return { label: 'Preferensi agent', currentVersion: row?.version ?? null };
  }
  if (id === null) return null;
  if (proposal.targetType === 'source') {
    const [row] = await db
      .select({ label: sources.name, version: sources.version })
      .from(sources)
      .where(eq(sources.id, id));
    return row === undefined ? null : { label: row.label, currentVersion: row.version };
  }
  if (proposal.targetType === 'discovered_item') {
    const [row] = await db
      .select({ label: discoveredItems.title })
      .from(discoveredItems)
      .where(eq(discoveredItems.id, id));
    return row === undefined ? null : { label: row.label, currentVersion: null };
  }
  const [row] = await db
    .select({ label: articles.slug, version: articles.currentVersion })
    .from(articles)
    .where(eq(articles.id, id));
  return row === undefined ? null : { label: row.label, currentVersion: row.version };
}

export async function getProposal(db: Db, id: string): Promise<ProposalDetail | null> {
  const [row] = await db
    .select(columns)
    .from(aiActionProposals)
    .where(eq(aiActionProposals.id, id));
  if (row === undefined) return null;
  const [decision] = await db
    .select({
      decision: approvals.decision,
      channel: approvals.channel,
      decidedAt: approvals.decidedAt,
    })
    .from(approvals)
    .where(eq(approvals.proposalId, id));
  return { ...row, target: await targetLabel(db, row), decision: decision ?? null };
}

/** Stable failure codes for an approved proposal that could not be applied. */
const FAILURES: Partial<Record<ErrorCode, string>> = {
  VERSION_CONFLICT: 'target:changed',
  NOT_FOUND: 'target:missing',
  VALIDATION_FAILED: 'payload:invalid',
  INVALID_TRANSITION: 'target:state',
  NOT_EDITABLE: 'target:state',
};

function failureCode(error: AppError): string {
  if (error.code === 'VALIDATION_FAILED' && error.fields?.some((f) => f.rule === 'duplicate')) {
    return 'source:duplicate';
  }
  return FAILURES[error.code] ?? 'apply:refused';
}

/** Applies an approved proposal; returns what it created, if anything. */
async function apply(db: Db, actor: Actor, proposal: ProposalView): Promise<string | null> {
  const payload = parseOrThrow(PAYLOADS[proposal.kind], proposal.payload) as Record<
    string,
    unknown
  >;
  switch (proposal.kind) {
    case 'sources.propose_create': {
      const { input } = await proposedSource(db, proposal.kind, payload, null);
      return (await createSource(db, actor, input)).id;
    }
    case 'sources.propose_update': {
      const { id, input } = await proposedSource(db, proposal.kind, payload, proposal.targetId);
      await updateSource(db, actor, id ?? '', input, proposal.targetVersion ?? 0);
      return null;
    }
    case 'preferences.propose_update': {
      const wish = payload as { topics?: string[]; notes?: string };
      const [row] = await db
        .update(agentPreferences)
        .set({
          ...(wish.topics === undefined ? {} : { topics: wish.topics }),
          ...(wish.notes === undefined ? {} : { notes: wish.notes }),
          version: sql`${agentPreferences.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(agentPreferences.version, proposal.targetVersion ?? 0))
        .returning({ version: agentPreferences.version });
      if (row === undefined) throw new AppError('VERSION_CONFLICT');
      return null;
    }
    case 'inbox.propose_flag':
    case 'articles.propose_note': {
      // Nothing to change: approving a flag lets the writer agent draft from the item (P3-03);
      // approving a note records that the founder has read it.
      if (proposal.kind === 'articles.propose_note') {
        const [row] = await db
          .select({ version: articles.currentVersion })
          .from(articles)
          .where(eq(articles.id, proposal.targetId ?? ''));
        if (row === undefined) throw new AppError('NOT_FOUND');
      }
      return null;
    }
  }
}

export type Decision = 'approve' | 'reject';
export type Channel = 'os' | 'telegram';

export interface DecisionResult {
  readonly status: ProposalStatus;
  readonly failure: string | null;
  readonly resultId: string | null;
}

/**
 * The founder decides a pending proposal, once. Approving applies it in the same transaction;
 * if applying is refused (target changed, duplicate…), the proposal is marked failed instead.
 * A proposal past its deadline is marked expired and refused.
 */
export async function decideProposal(
  db: Db,
  actor: Actor,
  id: string,
  decision: Decision,
  channel: Channel = 'os',
): Promise<DecisionResult> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ ...columns, rawStatus: aiActionProposals.status })
      .from(aiActionProposals)
      .where(eq(aiActionProposals.id, id))
      .for('update');
    if (row === undefined) throw new AppError('NOT_FOUND');
    if (row.rawStatus !== 'pending') throw new AppError('INVALID_TRANSITION');
    const audit = (status: ProposalStatus) =>
      recordAudit(tx, {
        action: 'proposal.decide',
        actorType: 'founder',
        actorId: actor.userId,
        result: status === 'expired' ? 'denied' : 'success',
        resourceType: 'ai_action_proposal',
        resourceId: id,
        ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
        metadata: { kind: row.kind, decision, status, channel },
      });
    if (row.status === 'expired') {
      await tx
        .update(aiActionProposals)
        .set({ status: 'expired', decidedAt: sql`now()` })
        .where(eq(aiActionProposals.id, id));
      await audit('expired');
      return { status: 'expired', failure: null, resultId: null } satisfies DecisionResult;
    }
    await tx
      .insert(approvals)
      .values({ proposalId: id, decision, channel, decidedBy: actor.userId });
    let outcome: DecisionResult = { status: 'rejected', failure: null, resultId: null };
    if (decision === 'approve') {
      try {
        // The source module opens its own transaction; on this handle that is a savepoint, so a
        // refusal rolls back only what applying did.
        const resultId = await tx.transaction((savepoint) => apply(savepoint, actor, row));
        outcome = { status: 'approved', failure: null, resultId };
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        outcome = { status: 'failed', failure: failureCode(error), resultId: null };
      }
    }
    await tx
      .update(aiActionProposals)
      .set({
        status: outcome.status,
        failure: outcome.failure,
        resultId: outcome.resultId,
        decidedAt: sql`now()`,
      })
      .where(eq(aiActionProposals.id, id));
    await audit(outcome.status);
    return outcome;
  });
  if (result.status === 'expired') throw new AppError('INVALID_TRANSITION');
  return result;
}

export interface AgentPreferencesView {
  readonly topics: string[];
  readonly notes: string;
  readonly version: number;
  readonly updatedAt: Date;
}

export async function getAgentPreferences(db: Db): Promise<AgentPreferencesView> {
  const [row] = await db
    .select({
      topics: agentPreferences.topics,
      notes: agentPreferences.notes,
      version: agentPreferences.version,
      updatedAt: agentPreferences.updatedAt,
    })
    .from(agentPreferences);
  if (row === undefined) throw new Error('agent_preferences row missing');
  return row;
}
