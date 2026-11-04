// Single-use approval tokens for the founder's Telegram buttons (P3-04, PRD v4 §8).
// A token is 128 random bits, bound to one proposal and one decision, valid for at most 24 hours
// (never past the proposal's own deadline), and stored only as its SHA-256. Consuming one is a
// single conditional UPDATE, so two taps (or a replayed callback) can never both succeed, and it
// voids the sibling button as well.
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { approvalTokens } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';

type Db = NodePgDatabase<typeof schema>;
export type Decision = 'approve' | 'reject';

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest();

/** Two fresh tokens for a proposal (the worker stores them before sending the message). */
export async function issueTokens(
  db: Pick<Db, 'insert'>,
  proposalId: string,
  proposalExpiresAt: Date,
): Promise<Record<Decision, string>> {
  const tokens = {
    approve: randomBytes(16).toString('base64url'),
    reject: randomBytes(16).toString('base64url'),
  };
  const day = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const expiresAt = proposalExpiresAt < day ? proposalExpiresAt : day;
  await db.insert(approvalTokens).values(
    (Object.entries(tokens) as [Decision, string][]).map(([decision, token]) => ({
      proposalId,
      decision,
      tokenHash: hash(token),
      expiresAt,
    })),
  );
  return tokens;
}

/**
 * Uses a token once. Returns its proposal and decision, or null when it is unknown, expired,
 * already used, or for a different decision than the button claimed.
 */
export async function consumeToken(
  db: Db,
  token: string,
  claimed: Decision,
): Promise<{ proposalId: string; decision: Decision } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(approvalTokens)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(approvalTokens.tokenHash, hash(token)),
          eq(approvalTokens.decision, claimed),
          isNull(approvalTokens.consumedAt),
          sql`${approvalTokens.expiresAt} > now()`,
        ),
      )
      .returning({ proposalId: approvalTokens.proposalId, decision: approvalTokens.decision });
    if (row === undefined) return null;
    // The other button of the same message dies with it.
    await tx
      .update(approvalTokens)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(approvalTokens.proposalId, row.proposalId), isNull(approvalTokens.consumedAt)));
    return row;
  });
}
