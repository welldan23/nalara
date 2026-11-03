// P1-01 authorization policy: deny by default for every founder API route.
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES } from '../../src/lib/errors.ts';
import {
  MissingPermissionError,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  enforcePolicy,
  hasPermission,
} from '../../src/plugins/policy.ts';
import type { ActiveSession } from '../../src/modules/auth/session.ts';

const session: ActiveSession = {
  sessionId: 's',
  userId: 'u',
  email: 'founder@example.invalid',
  role: 'founder',
  mfaEnabled: true,
  expiresAt: new Date(Date.now() + 60_000),
};

function testApp(authenticated: boolean): FastifyInstance {
  const app = Fastify();
  app.decorateRequest('auth', null);
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof AppError ? ERROR_CODES[error.code].status : 500;
    return reply.status(status).send({ code: error instanceof AppError ? error.code : 'INTERNAL' });
  });
  app.addHook('preHandler', (request, _reply, done) => {
    request.auth = authenticated ? session : null;
    done();
  });
  return app;
}

describe('authorization policy (P1-01)', () => {
  it('grants the founder every permission', () => {
    for (const permission of PERMISSIONS) expect(hasPermission('founder', permission)).toBe(true);
    expect(ROLE_PERMISSIONS.founder).toEqual(PERMISSIONS);
  });

  it('refuses to start when a route declares no permission', async () => {
    const app = testApp(true);
    // Same plugin shape as routes/os.ts: synchronous body returning a promise.
    await app.register((scope) => {
      enforcePolicy(scope);
      scope.get('/forgotten', () => ({ ok: true }));
      return Promise.resolve();
    });
    await expect(app.ready()).rejects.toBeInstanceOf(MissingPermissionError);
    // Routes outside the policy scope are not affected.
    const outside = testApp(true);
    await outside.register((scope) => {
      enforcePolicy(scope);
      scope.get('/declared', { config: { permission: 'os.access' } }, () => ({ ok: true }));
      return Promise.resolve();
    });
    outside.get('/health', () => ({ ok: true }));
    await expect(outside.ready()).resolves.toBeDefined();
    await outside.close();
  });

  it('answers 403 when the role lacks the permission and 401 without a session', async () => {
    for (const [authenticated, status] of [
      [true, 403],
      [false, 401],
    ] as const) {
      const app = testApp(authenticated);
      await app.register((scope) => {
        enforcePolicy(scope, { founder: ['os.access'] });
        scope.get('/write', { config: { permission: 'articles.write' } }, () => ({ ok: true }));
        scope.get('/ping', { config: { permission: 'os.access' } }, () => ({ ok: true }));
        return Promise.resolve();
      });
      expect((await app.inject({ method: 'GET', url: '/write' })).statusCode).toBe(status);
      expect((await app.inject({ method: 'GET', url: '/ping' })).statusCode).toBe(
        authenticated ? 200 : 401,
      );
      await app.close();
    }
  });
});
