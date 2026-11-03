// Session routes (PRD B §8). Login and MFA arrive in P0-008/P0-009 and reuse issueSessionCookie.
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { schema } from '../db/schema.ts';
import { recordAudit } from '../modules/audit/audit.ts';
import { csrfTokenFor } from '../modules/auth/csrf.ts';
import { revokeSession } from '../modules/auth/session.ts';
import type { IssuedSession } from '../modules/auth/session.ts';
import { sessionCookieOptions } from '../plugins/auth.ts';
import type { AuthConfig, AuthGuards } from '../plugins/auth.ts';

export interface AuthRouteOptions {
  readonly config: AuthConfig;
  readonly db: NodePgDatabase<typeof schema>;
  readonly guards: AuthGuards;
}

export function issueSessionCookie(
  reply: FastifyReply,
  cookieName: string,
  session: IssuedSession,
): void {
  reply.setCookie(cookieName, session.token, sessionCookieOptions(session.expiresAt));
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = (app, { config, db, guards }) => {
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
