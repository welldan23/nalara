// Second factor (P0-009, ADR-005): enrolment and verification against a login challenge.
//
// Invariants:
// - A session is minted only here, only after a valid second factor, only once per challenge
//   (the challenge is consumed with a conditional UPDATE inside the same transaction).
// - A TOTP step is accepted at most once (totp_last_step is advanced with a conditional UPDATE).
// - A challenge dies after MAX_CHALLENGE_ATTEMPTS wrong codes.
// - Every failure looks the same to the caller.
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { loginChallenges, recoveryCodes, users } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { recordAudit } from '../audit/audit.ts';
import { hashChallengeToken } from './login.ts';
import type { ChallengeScope } from './login.ts';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  isPlausibleRecoveryCode,
} from './recovery-codes.ts';
import { open, seal, totpContext } from './secret-box.ts';
import { createSession } from './session.ts';
import type { IssuedSession } from './session.ts';
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from './totp.ts';

export const MAX_CHALLENGE_ATTEMPTS = 5;
const CHALLENGE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

type Db = NodePgDatabase<typeof schema>;

/** Thrown inside a transaction to roll back everything it did (no half-consumed factors). */
class FactorRejected extends Error {}

interface LiveChallenge {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly scope: ChallengeScope;
  readonly pendingTotpSecretEnc: Buffer | null;
  readonly totpSecretEnc: Buffer | null;
  readonly totpLastStep: number | null;
}

export type SecondFactor = { readonly code: string } | { readonly recoveryCode: string };

export type VerifyOutcome =
  | {
      readonly ok: true;
      readonly session: IssuedSession;
      /** Present only right after enrolment: show once, never again. */
      readonly recoveryCodes?: readonly string[];
    }
  | { readonly ok: false };

async function liveChallenge(db: Db, token: string, now: Date): Promise<LiveChallenge | null> {
  if (!CHALLENGE_TOKEN.test(token)) return null;
  const [row] = await db
    .select({
      id: loginChallenges.id,
      userId: users.id,
      email: users.email,
      scope: loginChallenges.scope,
      pendingTotpSecretEnc: loginChallenges.pendingTotpSecretEnc,
      totpSecretEnc: users.totpSecretEnc,
      totpLastStep: users.totpLastStep,
    })
    .from(loginChallenges)
    .innerJoin(users, eq(users.id, loginChallenges.userId))
    .where(
      and(
        eq(loginChallenges.tokenHash, hashChallengeToken(token)),
        isNull(loginChallenges.usedAt),
        gt(loginChallenges.expiresAt, now),
        lt(loginChallenges.failedAttempts, MAX_CHALLENGE_ATTEMPTS),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** mfa/setup: generate a fresh TOTP secret for an enrolment challenge (replaces any previous). */
export async function startEnrolment(
  db: Db,
  key: Buffer,
  token: string,
  now = new Date(),
): Promise<{ readonly secret: string; readonly otpauthUri: string } | null> {
  const challenge = await liveChallenge(db, token, now);
  if (challenge?.scope !== 'enrolment') return null;
  const secret = generateTotpSecret();
  await db
    .update(loginChallenges)
    .set({ pendingTotpSecretEnc: seal(key, secret, totpContext(challenge.userId)) })
    .where(eq(loginChallenges.id, challenge.id));
  return { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, challenge.email) };
}

/** mfa/verify: finish enrolment or login. Returns a session only on a valid second factor. */
export async function verifySecondFactor(
  db: Db,
  key: Buffer,
  token: string,
  factor: SecondFactor,
  requestId: string | undefined,
  now = new Date(),
): Promise<VerifyOutcome> {
  const challenge = await liveChallenge(db, token, now);
  if (challenge === null) return { ok: false };
  const context = totpContext(challenge.userId);

  const fail = async (): Promise<VerifyOutcome> => {
    await db.transaction(async (tx) => {
      await tx
        .update(loginChallenges)
        .set({
          failedAttempts: sql`${loginChallenges.failedAttempts} + 1`,
          usedAt: sql`CASE WHEN ${loginChallenges.failedAttempts} + 1 >= ${MAX_CHALLENGE_ATTEMPTS}
            THEN ${now}::timestamptz ELSE ${loginChallenges.usedAt} END`,
        })
        .where(eq(loginChallenges.id, challenge.id));
      await recordAudit(tx, {
        action: 'auth.mfa',
        actorType: 'system',
        result: 'failure',
        resourceType: 'user',
        resourceId: challenge.userId,
        ...(requestId !== undefined ? { requestId } : {}),
      });
    });
    return { ok: false };
  };

  if (challenge.scope === 'enrolment') {
    if (!('code' in factor) || challenge.pendingTotpSecretEnc === null) return fail();
    const secret = open(key, challenge.pendingTotpSecretEnc, context);
    const step = verifyTotp(secret, factor.code, now, null);
    if (step === null) return fail();
    const codes = generateRecoveryCodes();
    const session = await inTransaction(db, async (tx) => {
      if (!(await consume(tx, challenge.id, now))) throw new FactorRejected();
      await tx
        .update(users)
        .set({
          totpSecretEnc: seal(key, secret, context),
          totpLastStep: step,
          mfaEnabled: true,
          updatedAt: now,
        })
        .where(eq(users.id, challenge.userId));
      await replaceRecoveryCodes(tx, challenge.userId, codes);
      const issued = await createSession(tx, challenge.userId, now);
      await recordAudit(tx, {
        action: 'mfa.enrol',
        actorType: 'founder',
        actorId: challenge.userId,
        result: 'success',
        resourceType: 'user',
        resourceId: challenge.userId,
        ...(requestId !== undefined ? { requestId } : {}),
      });
      return issued;
    });
    return session === null ? { ok: false } : { ok: true, session, recoveryCodes: codes };
  }

  // scope 'mfa': the founder already has TOTP.
  if (challenge.totpSecretEnc === null) return fail();
  const session = await inTransaction(db, async (tx) => {
    let method: 'totp' | 'recovery';
    if ('code' in factor) {
      const secret = open(key, challenge.totpSecretEnc ?? Buffer.alloc(0), context);
      const step = verifyTotp(secret, factor.code, now, challenge.totpLastStep);
      if (step === null) throw new FactorRejected();
      const advanced = await tx
        .update(users)
        .set({ totpLastStep: step })
        .where(
          and(
            eq(users.id, challenge.userId),
            or(isNull(users.totpLastStep), lt(users.totpLastStep, step)),
          ),
        )
        .returning({ id: users.id });
      if (advanced.length === 0) throw new FactorRejected(); // the same code won a race elsewhere
      method = 'totp';
    } else {
      if (!isPlausibleRecoveryCode(factor.recoveryCode)) throw new FactorRejected();
      const used = await tx
        .update(recoveryCodes)
        .set({ usedAt: now })
        .where(
          and(
            eq(recoveryCodes.userId, challenge.userId),
            eq(recoveryCodes.codeHash, hashRecoveryCode(factor.recoveryCode)),
            isNull(recoveryCodes.usedAt),
          ),
        )
        .returning({ id: recoveryCodes.id });
      if (used.length === 0) throw new FactorRejected();
      method = 'recovery';
    }
    if (!(await consume(tx, challenge.id, now))) throw new FactorRejected();
    const issued = await createSession(tx, challenge.userId, now);
    await recordAudit(tx, {
      action: 'auth.mfa',
      actorType: 'founder',
      actorId: challenge.userId,
      result: 'success',
      resourceType: 'user',
      resourceId: challenge.userId,
      metadata: { method },
      ...(requestId !== undefined ? { requestId } : {}),
    });
    return issued;
  });
  return session === null ? fail() : { ok: true, session };
}

/** Rotate recovery codes for a logged-in founder: all previous codes stop working. */
export async function rotateRecoveryCodes(
  db: Db,
  userId: string,
  requestId: string | undefined,
): Promise<readonly string[]> {
  const codes = generateRecoveryCodes();
  await db.transaction(async (tx) => {
    await replaceRecoveryCodes(tx, userId, codes);
    await recordAudit(tx, {
      action: 'mfa.recovery_rotate',
      actorType: 'founder',
      actorId: userId,
      result: 'success',
      resourceType: 'user',
      resourceId: userId,
      ...(requestId !== undefined ? { requestId } : {}),
    });
  });
  return codes;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Run fn in a transaction; FactorRejected rolls it back and yields null. */
async function inTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T | null> {
  try {
    return await db.transaction(fn);
  } catch (error) {
    if (error instanceof FactorRejected) return null;
    throw error;
  }
}

async function consume(tx: Tx, challengeId: string, now: Date): Promise<boolean> {
  const consumed = await tx
    .update(loginChallenges)
    .set({ usedAt: now })
    .where(and(eq(loginChallenges.id, challengeId), isNull(loginChallenges.usedAt)))
    .returning({ id: loginChallenges.id });
  return consumed.length > 0;
}

async function replaceRecoveryCodes(
  tx: Tx,
  userId: string,
  codes: readonly string[],
): Promise<void> {
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await tx
    .insert(recoveryCodes)
    .values(codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })));
}
