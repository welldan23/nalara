// Fastify application factory (P0-006, ADR-002). Pure construction: no listening, no global
// state, so tests can build an instance per case and use app.inject().
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { LogController } from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Config, TelegramWebhookConfig } from './config/env.ts';
import type { schema } from './db/schema.ts';
import { AppError, ERROR_CODES, errorBody } from './lib/errors.ts';
import type { ErrorCode } from './lib/errors.ts';
import { REQUEST_ID_HEADER, requestIdFrom } from './lib/request-id.ts';
import { createAuthGuards, crossOriginGuard } from './plugins/auth.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoutes } from './routes/health.ts';
import { agentRoutes } from './routes/agent.ts';
import { telegramRoutes } from './routes/telegram.ts';
import { queueCardPost } from './modules/cards/outbox.ts';
import { osRoutes } from './routes/os.ts';
import { publicRoutes } from './routes/public.ts';

export interface AppDependencies {
  /** True only when the database answers and every migration is applied. */
  readonly readiness: () => Promise<boolean>;
  /** Log destination; defaults to stdout. Tests pass a capture stream. */
  readonly logStream?: NodeJS.WritableStream;
  /** Requests per window per client IP across the API. */
  readonly rateLimitMax?: number;
  /**
   * Database for authenticated routes. Without it only health routes exist (unit tests);
   * main.ts always passes it.
   */
  readonly database?: NodePgDatabase<typeof schema>;
  /** Override the per-IP login attempt limit (tests). */
  readonly loginRateLimitMax?: number;
  /** Override the per-IP second-factor attempt limit (tests). */
  readonly mfaRateLimitMax?: number;
  /** The founder's Telegram webhook (P3-04); absent means the route does not exist. */
  readonly telegram?: TelegramWebhookConfig;
}

export type AppConfig = Pick<
  Config,
  'logLevel' | 'nodeEnv' | 'appOrigin' | 'session' | 'mfaEncryptionKey'
> &
  Partial<Pick<Config, 'trustedProxies' | 'publicSiteEnabled' | 'rateLimitMax'>>;

export const BODY_LIMIT_BYTES = 16 * 1024;
export const REQUEST_TIMEOUT_MS = 10_000;
export const READINESS_TIMEOUT_MS = 2_000;

/** Header, cookie and body fields that must never reach the logs. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-telegram-bot-api-secret-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.secret',
  '*.totp',
  '*.recoveryCode',
];

export async function buildApp(config: AppConfig, deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
      serializers: {
        // Path only: query strings can carry tokens. Bodies are never logged.
        req: (req: { method: string; url: string; id: string }) => ({
          method: req.method,
          path: req.url.split('?')[0],
          requestId: req.id,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      ...(deps.logStream !== undefined ? { stream: deps.logStream } : {}),
    },
    genReqId: (req) => requestIdFrom(req.headers[REQUEST_ID_HEADER]),
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    bodyLimit: BODY_LIMIT_BYTES,
    requestTimeout: REQUEST_TIMEOUT_MS,
    return503OnClosing: true,
    // Only the configured edge proxy may set the client IP (X-Forwarded-For); everyone else's
    // header is ignored, so rate limits cannot be dodged or turned against other users.
    trustProxy:
      config.trustedProxies !== undefined && config.trustedProxies.length > 0
        ? [...config.trustedProxies]
        : false,
  });

  // JSON only (ADR-004): drop Fastify's default text/plain parser so anything else is 415.
  app.removeContentTypeParser('text/plain');

  await app.register(rateLimit, {
    global: true,
    max: deps.rateLimitMax ?? config.rateLimitMax ?? 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new AppError('RATE_LIMITED'),
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    reply.header('x-content-type-options', 'nosniff');
    // API answers are private and fresh by default; only a route that opts in (image files,
    // P1-09) sets its own caching.
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send(errorBody('NOT_FOUND', request.id));
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    const code = classify(error);
    const status = ERROR_CODES[code].status;
    if (status >= 500) {
      request.log.error(
        { err: { type: error.name, code: (error as FastifyError).code } },
        'request failed',
      );
    }
    const fields = error instanceof AppError ? error.fields : undefined;
    void reply.code(status).send(errorBody(code, request.id, fields));
  });

  await app.register(cookie);
  app.decorateRequest('auth', null);
  app.addHook('onRequest', crossOriginGuard(config));

  await app.register(healthRoutes, { readiness: deps.readiness });
  if (deps.database !== undefined) {
    const guards = createAuthGuards(config, deps.database);
    await app.register(authRoutes, {
      config,
      db: deps.database,
      guards,
      ...(deps.loginRateLimitMax !== undefined
        ? { loginRateLimitMax: deps.loginRateLimitMax }
        : {}),
      ...(deps.mfaRateLimitMax !== undefined ? { mfaRateLimitMax: deps.mfaRateLimitMax } : {}),
    });
    // Kartu IG to the founder's Telegram after each publish (P5-04b), only when the bot is set up.
    // Runs after the answer: rendering takes a moment and never blocks or undoes a publish.
    const database = deps.database;
    const onPublished =
      deps.telegram === undefined
        ? undefined
        : (articleId: string) => {
            queueCardPost(database, articleId, { origin: config.appOrigin })
              .then((outcome) => {
                app.log.info({ outcome }, 'kartu IG queued for telegram');
              })
              .catch((error: unknown) => {
                app.log.error(
                  {
                    err: { type: (error as Error).name, code: (error as { code?: unknown }).code },
                  },
                  'kartu IG render failed',
                );
              });
          };
    await app.register(osRoutes, {
      prefix: '/api/v1/os',
      guards,
      db: deps.database,
      origin: config.appOrigin,
      ...(onPublished === undefined ? {} : { onPublished }),
    });
    await app.register(agentRoutes, { prefix: '/api/v1/agent', db: deps.database });
    if (deps.telegram !== undefined) {
      await app.register(telegramRoutes, {
        prefix: '/api/v1/telegram',
        db: deps.database,
        telegram: deps.telegram,
        ...(onPublished === undefined ? {} : { onPublished }),
      });
    }
    await app.register(publicRoutes, {
      prefix: '/api/v1/public',
      db: deps.database,
      enabled: config.publicSiteEnabled ?? false,
    });
  }
  return app;
}

function classify(error: FastifyError | AppError): ErrorCode {
  if (error instanceof AppError) return error.code;
  switch (error.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return 'PAYLOAD_TOO_LARGE';
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return 'INVALID_JSON';
    case 'FST_ERR_VALIDATION':
      return 'VALIDATION_FAILED';
    default:
      break;
  }
  if (error instanceof SyntaxError || error.statusCode === 400) return 'BAD_REQUEST';
  if (error.statusCode === 413) return 'PAYLOAD_TOO_LARGE';
  if (error.statusCode === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (error.statusCode === 429) return 'RATE_LIMITED';
  return 'INTERNAL';
}
