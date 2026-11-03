// Founder creation (P0-007). The only way a user row is created: there is no signup endpoint.
// The database enforces "at most one founder" (ADR-009); this module turns that into a clear
// FounderExistsError and records the bootstrap in the audit log in the same transaction.
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { recordAudit } from '../audit/audit.ts';

export class FounderExistsError extends Error {
  constructor() {
    super('a founder account already exists; bootstrap refuses to create or overwrite another');
    this.name = 'FounderExistsError';
  }
}

export async function createFounder(
  db: NodePgDatabase<typeof schema>,
  input: { readonly email: string; readonly passwordHash: string },
): Promise<{ readonly id: string }> {
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'founder'))
        .limit(1);
      if (existing.length > 0) throw new FounderExistsError();

      const [created] = await tx
        .insert(users)
        .values({ email: input.email, passwordHash: input.passwordHash, role: 'founder' })
        .returning({ id: users.id });
      if (created === undefined) throw new Error('founder insert returned no row');

      await recordAudit(tx, {
        action: 'founder.bootstrap',
        actorType: 'system',
        result: 'success',
        resourceType: 'user',
        resourceId: created.id,
      });
      return created;
    });
  } catch (error) {
    // A concurrent bootstrap loses the race on the unique index instead of the pre-check.
    if (isUniqueViolation(error)) throw new FounderExistsError();
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === '23505' || causeCode === '23505';
}
