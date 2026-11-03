// Auth routes (PRD B §8): password login (challenge only), current founder, logout.
// MFA verification (P0-009) consumes the challenge and calls issueSessionCookie.
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { parseOrThrow } from '../lib/validation.ts';
import { recordAudit } from '../modules/audit/audit.ts';
import { csrfTokenFor } from '../modules/auth/csrf.ts';
import { attemptPasswordLogin } from '../modules/auth/login.ts';
import { revokeSession } from '../modules/auth/session.ts';
import type { IssuedSession } from '../modules/auth/session.ts';
import { sessionCookieOptions } from '../plugins/auth.ts';
import type { AuthConfig, AuthGuards } from '../plugins/auth.ts';

export interface AuthRouteOptions {
  readonly config: AuthConfig;
  readonly db: NodePgDatabase<typeof schema>;
  readonly guards: AuthGuards;
  /** Password attempts per minute per client IP (stricter than the global limit). */
  readonly loginRateLimitMax?: number;
}

/** Short-lived MFA challenge cookie; only the MFA endpoints read it (ADR-005). */
export const CHALLENGE_COOKIE = '__Host-nalara_challenge';

const loginBody = z
  .object({
    email: z.string().trim().min(1).max(254),
    // Upper bound only to cap work; the policy (12..128) applies when the password is set.
    password: z.string().min(1).max(1024),
  })
  .strict();

export function issueSessionCookie(
  reply: FastifyReply,
  cookieName: string,
  session: IssuedSession,
): void {
  reply.setCookie(cookieName, session.token, sessionCookieOptions(session.expiresAt));
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = (
  app,
  { config, db, guards, loginRateLimitMax },
) => {
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: loginRateLimitMax ?? 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parseOrThrow(loginBody, request.body);
      const outcome = await attemptPasswordLogin(db, { ...body, requestId: request.id });
      if (!outcome.ok) throw new AppError('INVALID_CREDENTIALS');
      const { challenge } = outcome;
      reply.setCookie(CHALLENGE_COOKIE, challenge.token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        expires: challenge.expiresAt,
      });
      return {
        next: challenge.scope === 'mfa' ? 'mfa' : 'mfa_enrolment',
        expiresAt: challenge.expiresAt.toISOString(),
      };
    },
  );

  app.get('/api/v1/auth/me', { preHandler: guards.requireFounder }, (request) => {
    const session = request.auth;
    if (session === null) throw new Error('requireFounder did not set auth');
    return Promise.resolve({
      user: {
        id: session.userId,
        email: session.email,
        role: session.role,
        mfaEnabled: session.mfaEnabled,
      },
      csrfToken: csrfTokenFor(config.session.secret, session.sessionId),
    });
  });

  app.post(
    '/api/v1/auth/logout',
    { preHandler: [guards.requireFounder, guards.requireCsrf] },
    async (request, reply) => {
      const session = request.auth;
      if (session === null) throw new Error('requireFounder did not set auth');
      await db.transaction(async (tx) => {
        await revokeSession(tx, session.sessionId);
        await recordAudit(tx, {
          action: 'session.logout',
          actorType: 'founder',
          actorId: session.userId,
          result: 'success',
          resourceType: 'session',
          resourceId: session.sessionId,
          requestId: request.id,
        });
      });
      reply.clearCookie(config.session.cookieName, sessionCookieOptions());
      return reply.code(204).send();
    },
  );
  return Promise.resolve();
};
