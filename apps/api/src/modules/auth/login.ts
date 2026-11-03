// Password step of login (P0-008, ADR-004, ADR-005).
//
// - Unknown email, wrong password and locked account all look identical to the caller, and all
//   cost one Argon2 verification, so neither the response nor its timing reveals which it was.
// - Failure counters are updated atomically in SQL, so parallel attempts cannot under-count.
// - Success yields a single-use, short-lived challenge, never a session. Its scope says whether
//   the founder must enrol MFA ('enrolment') or present a code ('mfa').
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { loginChallenges, users } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { recordAudit } from '../audit/audit.ts';
import { hashPassword, verifyPassword } from './password.ts';

export const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export type ChallengeScope = 'enrolment' | 'mfa';

export interface IssuedChallenge {
  readonly token: string;
  readonly scope: ChallengeScope;
  readonly expiresAt: Date;
}

export type LoginOutcome =
  { readonly ok: true; readonly challenge: IssuedChallenge } | { readonly ok: false };

type Db = NodePgDatabase<typeof schema>;

let dummyHash: Promise<string> | undefined;
/** Hash of a random secret, so unknown emails cost the same Argon2 work as real ones. */
function timingDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHash;
}

export function hashChallengeToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export async function attemptPasswordLogin(
  db: Db,
  input: { readonly email: string; readonly password: string; readonly requestId?: string },
  now = new Date(),
): Promise<LoginOutcome> {
  const email = input.email.trim().toLowerCase();
  const [user] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      mfaEnabled: users.mfaEnabled,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const audit = (result: 'success' | 'failure' | 'denied', userId?: string) =>
    recordAudit(db, {
      action: 'auth.password',
      actorType: 'system',
      result,
      ...(userId !== undefined ? { resourceType: 'user', resourceId: userId } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });

  if (user === undefined) {
    await verifyPassword(await timingDummyHash(), input.password);
    await audit('failure');
    return { ok: false };
  }

  // Always verify, even when locked, so a locked account answers in the same time.
  const valid = await verifyPassword(user.passwordHash, input.password);
  const locked = user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();
  if (locked) {
    await audit('denied', user.id);
    return { ok: false };
  }

  if (!valid) {
    await db
      .update(users)
      .set({
        failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
        // CI-PROOF (TEST-CI-04): off-by-one in the lockout SQL, only visible against a real database.
        lockedUntil: sql`CASE WHEN ${users.failedLoginAttempts} + 1 > ${MAX_FAILED_ATTEMPTS}
          THEN ${new Date(now.getTime() + LOCKOUT_MS)}::timestamptz ELSE ${users.lockedUntil} END`,
      })
      .where(eq(users.id, user.id));
    await audit('failure', user.id);
    return { ok: false };
  }

  const challenge = await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, user.id));
    // Only the newest challenge is usable: invalidate any unused older ones.
    await tx
      .update(loginChallenges)
      .set({ usedAt: now })
      .where(and(eq(loginChallenges.userId, user.id), isNull(loginChallenges.usedAt)));
    const token = randomBytes(32).toString('base64url');
    const scope: ChallengeScope = user.mfaEnabled ? 'mfa' : 'enrolment';
    const expiresAt = new Date(now.getTime() + LOGIN_CHALLENGE_TTL_MS);
    await tx.insert(loginChallenges).values({
      userId: user.id,
      tokenHash: hashChallengeToken(token),
      scope,
      expiresAt,
      createdAt: now,
    });
    return { token, scope, expiresAt };
  });
  await audit('success', user.id);
  return { ok: true, challenge };
}
