// Authentication and CSRF guards (ADR-004, PRD B §6.2). The API is the only authority:
// Next.js redirects are UX, these hooks are the security boundary.
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Config } from '../config/env.ts';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import {
  CSRF_HEADER,
  UNSAFE_METHODS,
  isValidCsrfToken,
  originVerdict,
} from '../modules/auth/csrf.ts';
import { findActiveSession } from '../modules/auth/session.ts';
import type { ActiveSession } from '../modules/auth/session.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by requireFounder; null on routes that do not require authentication. */
    auth: ActiveSession | null;
  }
}

export type AuthConfig = Pick<Config, 'appOrigin' | 'session' | 'nodeEnv'>;

export interface AuthGuards {
  readonly requireFounder: preHandlerAsyncHookHandler;
  readonly requireCsrf: preHandlerAsyncHookHandler;
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Global guard for every unsafe request, authenticated or not (e.g. login): a browser request
 * from another origin is refused before routing. Non-browser clients send neither header.
 */
export function crossOriginGuard(config: AuthConfig) {
  return (request: FastifyRequest): Promise<void> => {
    if (!UNSAFE_METHODS.has(request.method)) return Promise.resolve();
    const verdict = originVerdict(
      config.appOrigin,
      header(request, 'origin'),
      header(request, 'sec-fetch-site'),
    );
    return verdict === 'cross-origin'
      ? Promise.reject(new AppError('FORBIDDEN'))
      : Promise.resolve();
  };
}

export function createAuthGuards(
  config: AuthConfig,
  db: NodePgDatabase<typeof schema>,
): AuthGuards {
  const requireFounder: preHandlerAsyncHookHandler = async (request) => {
    const token = request.cookies[config.session.cookieName];
    if (token === undefined || token === '') throw new AppError('UNAUTHORIZED');
    let session: ActiveSession | null;
    try {
      session = await findActiveSession(db, token);
    } catch {
      // Fail closed: if sessions cannot be checked, nobody is authenticated (PRD B §6.1).
      throw new AppError('NOT_READY');
    }
    if (session === null) throw new AppError('UNAUTHORIZED');
    request.auth = session;
  };

  const requireCsrf: preHandlerAsyncHookHandler = (request) => {
    const session = request.auth;
    if (session === null) return Promise.reject(new AppError('UNAUTHORIZED'));
    // Authenticated mutations must come from our own pages: a browser always sends one of these.
    const verdict = originVerdict(
      config.appOrigin,
      header(request, 'origin'),
      header(request, 'sec-fetch-site'),
    );
    if (verdict !== 'same-origin') return Promise.reject(new AppError('FORBIDDEN'));
    if (!isValidCsrfToken(config.session.secret, session.sessionId, request.headers[CSRF_HEADER])) {
      return Promise.reject(new AppError('FORBIDDEN'));
    }
    return Promise.resolve();
  };

  return { requireFounder, requireCsrf };
}

/** Cookie attributes for the session (ADR-004): host-only, HTTPS-only, not readable by JS. */
export function sessionCookieOptions(expiresAt?: Date) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    ...(expiresAt !== undefined ? { expires: expiresAt } : {}),
  };
}
