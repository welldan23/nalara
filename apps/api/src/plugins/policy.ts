// Authorization policy for the founder API (P1-01, replaces v3 P02-002). Deny by default:
// every /api/v1/os route must declare the permission it needs, or the API refuses to start.
// The role → permission map is the single place to change when more roles exist.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.ts';
import type { ActiveSession } from '../modules/auth/session.ts';

export const PERMISSIONS = [
  'os.access',
  'articles.read',
  'articles.write',
  // Approve and publish: kept separate so a future editor role can write without publishing.
  'articles.publish',
  // Source Registry (P1-05).
  'sources.read',
  'sources.write',
  // Media library (P1-09).
  'media.read',
  'media.write',
  // Inbox of discovered feed items (P2-06).
  'inbox.read',
  'inbox.write',
  // Agent proposals (P3-01): reading them, and deciding (which applies them).
  'proposals.read',
  'proposals.decide',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

type Role = ActiveSession['role'];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  founder: PERMISSIONS,
};

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Required on every route inside the policy scope. */
    permission?: Permission;
  }
}

export class MissingPermissionError extends Error {
  constructor(method: string, url: string) {
    super(`route ${method} ${url} declares no permission (config.permission)`);
    this.name = 'MissingPermissionError';
  }
}

export function hasPermission(
  role: Role,
  permission: Permission,
  map: Readonly<Record<Role, readonly Permission[]>> = ROLE_PERMISSIONS,
): boolean {
  return map[role].includes(permission);
}

/**
 * Install inside an encapsulated plugin, before its routes and after authentication:
 * a route without a permission makes app.ready() fail (the API never starts), and a request
 * whose role lacks the permission is refused with 403.
 */
export function enforcePolicy(
  app: FastifyInstance,
  map: Readonly<Record<Role, readonly Permission[]>> = ROLE_PERMISSIONS,
): void {
  // Collected here and refused in onReady: throwing inside onRoute would escape the plugin
  // loader as an uncaught exception instead of a clean startup failure.
  const missing: MissingPermissionError[] = [];
  app.addHook('onRoute', (route) => {
    const permission = route.config?.permission;
    if (permission === undefined || !PERMISSIONS.includes(permission)) {
      const method = Array.isArray(route.method) ? route.method.join(',') : route.method;
      missing.push(new MissingPermissionError(method, route.url));
    }
  });
  app.addHook('onReady', () => {
    const [first] = missing;
    return first === undefined ? Promise.resolve() : Promise.reject(first);
  });
  app.addHook('preHandler', (request: FastifyRequest) => {
    const session = request.auth;
    if (session === null) return Promise.reject(new AppError('UNAUTHORIZED'));
    const permission = request.routeOptions.config.permission;
    if (permission === undefined || !hasPermission(session.role, permission, map)) {
      return Promise.reject(new AppError('FORBIDDEN'));
    }
    return Promise.resolve();
  });
}
