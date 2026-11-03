// Server-side sessions (ADR-004, P0-010). The browser holds an opaque 256-bit token; the
// database stores only its SHA-256. Sessions expire absolutely and on idle, can be revoked,
// and are rotated on login so a pre-login token can never become authenticated.
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sessions, users } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';

export const SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_TTL_MS = 60 * 60 * 1000;
/** Avoid a write on every request: refresh last_seen_at at most once per minute. */
const TOUCH_INTERVAL_MS = 60 * 1000;
/** 32 random bytes in base64url = 43 characters, nothing else. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type Db = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction; both expose the same query builders. */
type Executor = Pick<Db, 'select' | 'insert' | 'update'>;

export interface ActiveSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly role: 'founder';
  readonly mfaEnabled: boolean;
  readonly expiresAt: Date;
}

export interface IssuedSession {
  readonly sessionId: string;
  /** Give to the client exactly once (cookie); never store or log it. */
  readonly token: string;
  readonly expiresAt: Date;
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function isWellFormedSessionToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export async function createSession(
  db: Executor,
  userId: string,
  now = new Date(),
): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      createdAt: now,
      lastSeenAt: now,
    })
    .returning({ id: sessions.id });
  if (row === undefined) throw new Error('session insert returned no row');
  return { sessionId: row.id, token, expiresAt };
}

/**
 * Resolve a token to an active founder session, or null. Malformed tokens are rejected before
 * touching the database. Database errors propagate so callers fail closed.
 */
export async function findActiveSession(
  db: Executor,
  token: string,
  now = new Date(),
): Promise<ActiveSession | null> {
  if (!isWellFormedSessionToken(token)) return null;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      role: users.role,
      mfaEnabled: users.mfaEnabled,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .limit(1);
  if (row === undefined) return null;
  if (row.revokedAt !== null) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  const lastSeen = row.lastSeenAt ?? row.createdAt;
  if (lastSeen.getTime() + SESSION_IDLE_TTL_MS <= now.getTime()) return null;

  if (now.getTime() - lastSeen.getTime() >= TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    email: row.email,
    role: row.role,
    mfaEnabled: row.mfaEnabled,
    expiresAt: row.expiresAt,
  };
}

/** Revoke one session. Returns false if it was already revoked or does not exist. */
export async function revokeSession(
  db: Executor,
  sessionId: string,
  now = new Date(),
): Promise<boolean> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return revoked.length > 0;
}

/** Issue a fresh session and revoke the previous one atomically (login, privilege change). */
export async function rotateSession(
  db: Db,
  userId: string,
  previousSessionId: string | undefined,
  now = new Date(),
): Promise<IssuedSession> {
  return db.transaction(async (tx) => {
    if (previousSessionId !== undefined) await revokeSession(tx, previousSessionId, now);
    return createSession(tx, userId, now);
  });
}
