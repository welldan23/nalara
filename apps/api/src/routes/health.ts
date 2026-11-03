// Health endpoints (PRD B §8). /health/live is public and says nothing about dependencies.
// /health/ready is for the Compose healthcheck only (not routed by the proxy, ADR-006) and
// still reveals nothing beyond ready / not ready.
import type { FastifyPluginAsync } from 'fastify';
import { errorBody } from '../lib/errors.ts';

export interface HealthOptions {
  readonly readiness: () => Promise<boolean>;
  readonly timeoutMs?: number;
}

export const healthRoutes: FastifyPluginAsync<HealthOptions> = (app, options) => {
  const timeoutMs = options.timeoutMs ?? 2_000;

  // Public, so it stays rate limited like everything else.
  app.get('/health/live', () => Promise.resolve({ status: 'ok' }));

  // Internal healthcheck target; exempt so a busy limiter never marks the service unhealthy.
  app.get('/health/ready', { config: { rateLimit: false } }, async (request, reply) => {
    const ready = await withTimeout(options.readiness(), timeoutMs).catch(() => false);
    if (ready) return { status: 'ready' };
    return reply.code(503).send(errorBody('NOT_READY', request.id));
  });
  return Promise.resolve();
};

async function withTimeout(promise: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
