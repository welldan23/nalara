// Gateway credentials for the agent runner (P3-02, ADR-020). A credential is a 256-bit random
// token, shown once by the CLI; only its SHA-256 is stored. Revoking is final.
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { agentCredentials } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { recordAudit } from '../audit/audit.ts';

type Db = NodePgDatabase<typeof schema>;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

export interface AgentCredential {
  readonly id: string;
  readonly label: string;
}

const hash = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();

export class CredentialLabelError extends Error {
  constructor(reason: 'invalid' | 'taken' | 'unknown') {
    super(`agent credential label ${reason}`);
    this.name = 'CredentialLabelError';
  }
}

/** Creates a credential and returns its token, the only time it exists in clear. */
export async function createCredential(
  db: Db,
  label: string,
): Promise<AgentCredential & { readonly token: string }> {
  if (!LABEL_PATTERN.test(label)) throw new CredentialLabelError('invalid');
  const token = randomBytes(32).toString('base64url');
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(agentCredentials)
        .values({ label, tokenHash: hash(token) })
        .returning({ id: agentCredentials.id, label: agentCredentials.label });
      if (row === undefined) throw new Error('insert returned no row');
      await recordAudit(tx, {
        action: 'agent.credential',
        actorType: 'system',
        result: 'success',
        resourceType: 'agent_credential',
        resourceId: row.id,
        metadata: { label, change: 'created' },
      });
      return { ...row, token };
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause ?? error;
    if ((cause as { code?: string }).code === '23505') throw new CredentialLabelError('taken');
    throw error;
  }
}

export async function revokeCredential(db: Db, label: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(agentCredentials)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(agentCredentials.label, label), isNull(agentCredentials.revokedAt)))
      .returning({ id: agentCredentials.id });
    if (row === undefined) throw new CredentialLabelError('unknown');
    await recordAudit(tx, {
      action: 'agent.credential',
      actorType: 'system',
      result: 'success',
      resourceType: 'agent_credential',
      resourceId: row.id,
      metadata: { label, change: 'revoked' },
    });
  });
}

/** The active credential for a bearer token, or null. Records last use at most once a minute. */
export async function findCredential(db: Db, token: string): Promise<AgentCredential | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db
    .select({ id: agentCredentials.id, label: agentCredentials.label })
    .from(agentCredentials)
    .where(and(eq(agentCredentials.tokenHash, hash(token)), isNull(agentCredentials.revokedAt)));
  if (row === undefined) return null;
  await db
    .update(agentCredentials)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(agentCredentials.id, row.id),
        or(
          isNull(agentCredentials.lastUsedAt),
          lt(agentCredentials.lastUsedAt, sql`now() - interval '1 minute'`),
        ),
      ),
    );
  return row;
}

export interface CredentialView {
  readonly label: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export async function listCredentials(db: Db): Promise<CredentialView[]> {
  return db
    .select({
      label: agentCredentials.label,
      createdAt: agentCredentials.createdAt,
      lastUsedAt: agentCredentials.lastUsedAt,
      revokedAt: agentCredentials.revokedAt,
    })
    .from(agentCredentials)
    .orderBy(desc(agentCredentials.createdAt))
    .limit(50);
}
