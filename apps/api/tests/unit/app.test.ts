// P0-006 API skeleton (PRD §14.4 TEST-API-01..10), via app.inject (no network).
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BODY_LIMIT_BYTES, buildApp } from '../../src/app.ts';
import { AppError } from '../../src/lib/errors.ts';
import { parseOrThrow } from '../../src/lib/validation.ts';

const config = {
  logLevel: 'info',
  nodeEnv: 'test',
  appOrigin: 'http://localhost:3000',
  session: { cookieName: '__Host-nalara_session', secret: 'test-session-secret-'.padEnd(40, 'a') },
} as const;
const apps: FastifyInstance[] = [];

class LogCapture extends Writable {
  readonly lines: string[] = [];
  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
    done();
  }
  get text(): string {
    return this.lines.join('\n');
  }
}

async function makeApp(options: { ready?: boolean | Error; rateLimitMax?: number } = {}) {
  const logs = new LogCapture();
  const ready = options.ready ?? true;
  const app = await buildApp(config, {
    readiness: () => (ready instanceof Error ? Promise.reject(ready) : Promise.resolve(ready)),
    logStream: logs,
    ...(options.rateLimitMax !== undefined ? { rateLimitMax: options.rateLimitMax } : {}),
  });
  // Test-only routes to exercise validation and error handling; not part of the product API.
  const body = z.object({ name: z.string().min(1).max(20) }).strict();
  app.post('/__test/echo', (request) => Promise.resolve(parseOrThrow(body, request.body)));
  app.get('/__test/boom', () => {
    throw new Error('database password is hunter2 at /srv/app/secret.ts:42');
  });
  app.get('/__test/forbidden', () => {
    throw new AppError('FORBIDDEN');
  });
  await app.ready();
  apps.push(app);
  return { app, logs };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function errorOf(payload: string) {
  return (JSON.parse(payload) as { error: { code: string; message: string; requestId: string } })
    .error;
}

describe('TEST-API-01 public liveness', () => {
  it('returns minimal status without dependency details', async () => {
    const { app } = await makeApp({ ready: false });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('TEST-API-02 private readiness', () => {
  it('reports ready only when the dependency check passes', async () => {
    const { app } = await makeApp({ ready: true });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it.each([false, new Error('connect ECONNREFUSED 10.0.0.5:5432 password=x')])(
    'returns 503 without revealing why (%s)',
    async (ready) => {
      const { app } = await makeApp({ ready });
      const response = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(response.statusCode).toBe(503);
      expect(errorOf(response.payload).code).toBe('NOT_READY');
      expect(response.payload).not.toMatch(/ECONNREFUSED|5432|password/);
    },
  );
});

describe('TEST-API-03 unknown route', () => {
  it('returns the 404 envelope', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(errorOf(response.payload)).toMatchObject({ code: 'NOT_FOUND', message: 'Not found' });
  });
});

describe('TEST-API-04 invalid JSON', () => {
  it('rejects malformed JSON with INVALID_JSON', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": ',
    });
    expect(response.statusCode).toBe(400);
    expect(errorOf(response.payload).code).toBe('INVALID_JSON');
  });

  it('rejects non-JSON content types with 415', async () => {
    const { app } = await makeApp();
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded']) {
      const response = await app.inject({
        method: 'POST',
        url: '/__test/echo',
        headers: { 'content-type': contentType },
        payload: 'name=x',
      });
      expect(response.statusCode, contentType).toBe(415);
      expect(errorOf(response.payload).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });
});

describe('TEST-API-05 oversized payload', () => {
  it('rejects bodies above the limit with 413', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x'.repeat(BODY_LIMIT_BYTES) }),
    });
    expect(response.statusCode).toBe(413);
    expect(errorOf(response.payload).code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('TEST-API-06 invalid schema', () => {
  it('lists failing fields and rules without echoing values', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      payload: { name: 'secret-value-that-is-too-long-xyz', extra: 'also-secret' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; fields: { path: string }[] } }>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields.map((field) => field.path).sort()).toEqual(['(root)', 'name']);
    expect(response.payload).not.toMatch(/secret-value|also-secret/);
  });

  it('accepts a valid body', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/__test/echo',
      payload: { name: 'ok' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: 'ok' });
  });
});

describe('TEST-API-07 request ID generation', () => {
  it('generates a request ID and returns it in header and error body', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/nope' });
    const header = response.headers['x-request-id'];
    expect(header).toMatch(/^req_[A-Za-z0-9_-]{16}$/);
    expect(errorOf(response.payload).requestId).toBe(header);
  });

  it('replaces malformed incoming IDs so logs cannot be injected', async () => {
    const { app } = await makeApp();
    for (const bad of ['short', 'has spaces in it', 'a'.repeat(65), 'evil\nlevel=fatal']) {
      const response = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-request-id': bad },
      });
      expect(response.headers['x-request-id']).toMatch(/^req_/);
    }
  });
});

describe('TEST-API-08 request ID propagation', () => {
  it('reuses a well-formed incoming ID in response and logs', async () => {
    const { app, logs } = await makeApp();
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'proxy-generated-id-123' },
    });
    expect(response.headers['x-request-id']).toBe('proxy-generated-id-123');
    expect(logs.text).toContain('"requestId":"proxy-generated-id-123"');
  });
});

describe('TEST-API-09 no stack traces or internals', () => {
  it('turns unexpected errors into a generic 500 envelope', async () => {
    const { app, logs } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/__test/boom' });
    expect(response.statusCode).toBe(500);
    expect(errorOf(response.payload)).toMatchObject({
      code: 'INTERNAL',
      message: 'Internal server error',
    });
    expect(response.payload).not.toMatch(/hunter2|secret\.ts|at \/|stack/);
    expect(logs.text).not.toContain('hunter2');
  });

  it('maps AppError codes to their fixed status and message', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/__test/forbidden' });
    expect(response.statusCode).toBe(403);
    expect(errorOf(response.payload).code).toBe('FORBIDDEN');
  });

  it('never logs cookies, authorization headers or query strings', async () => {
    const { app, logs } = await makeApp();
    await app.inject({
      method: 'GET',
      url: '/health/live?token=query-secret-123',
      headers: {
        cookie: '__Host-nalara_session=cookie-secret',
        authorization: 'Bearer auth-secret',
      },
    });
    expect(logs.lines.length).toBeGreaterThan(0);
    expect(logs.text).not.toMatch(/query-secret-123|cookie-secret|auth-secret/);
  });
});

describe('TEST-API-10 rate limit response', () => {
  it('returns 429 with the envelope and Retry-After once the limit is hit', async () => {
    const { app } = await makeApp({ rateLimitMax: 3 });
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 4; i += 1) {
      last = await app.inject({ method: 'GET', url: '/health/live' });
      statuses.push(last.statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    expect(last?.headers['retry-after']).toBeDefined();
    expect(errorOf(last?.payload ?? '{}').code).toBe('RATE_LIMITED');
  });

  it('never rate-limits the internal readiness probe', async () => {
    const { app } = await makeApp({ rateLimitMax: 1 });
    for (let i = 0; i < 5; i += 1) {
      expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    }
  });
});
