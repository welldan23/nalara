// Typed, fail-fast environment configuration for the API (P0-004, ADR-004, ADR-005).
//
// Contract:
// - loadConfig() either returns a fully validated Config or throws ConfigError.
// - ConfigError messages name the variable and the rule that failed, never the value.
// - Production is stricter than development/test (HTTPS origin, __Host- cookie, no debug logs).
import { z } from 'zod';

export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface Config {
  readonly nodeEnv: NodeEnv;
  /** Origin of the public site (scheme + host + port), used for Origin/CSRF checks. */
  readonly appOrigin: string;
  readonly databaseUrl: string;
  readonly session: {
    readonly cookieName: string;
    /** HMAC key for CSRF tokens only (ADR-004). */
    readonly secret: string;
  };
  /** 32-byte AES-256-GCM key for TOTP secrets (ADR-005). */
  readonly mfaEncryptionKey: Buffer;
  readonly logLevel: LogLevel;
  readonly port: number;
}

/** Variables whose values must never appear in logs or error messages. */
export const SECRET_ENV_KEYS = ['DATABASE_URL', 'SESSION_SECRET', 'MFA_ENCRYPTION_KEY'] as const;

/** Every variable NALARA understands. Used by the typo guard and by .env.example tests. */
export const KNOWN_ENV_KEYS = [
  'NODE_ENV',
  'APP_BASE_URL',
  'API_BASE_URL',
  'DATABASE_URL',
  'SESSION_COOKIE_NAME',
  'SESSION_SECRET',
  'MFA_ENCRYPTION_KEY',
  'LOG_LEVEL',
  'PORT',
  'FOUNDER_EMAIL',
  'BACKUP_DESTINATION',
] as const;

/**
 * Prefixes reserved for NALARA. An unknown variable with one of these prefixes is almost
 * certainly a typo (e.g. SESION_SECRET would not match, but SESSION_SECRT does) and is rejected.
 */
export const RESERVED_ENV_PREFIXES = [
  'APP_',
  'API_',
  'DATABASE_',
  'SESSION_',
  'MFA_',
  'LOG_',
  'FOUNDER_',
  'BACKUP_',
  'NALARA_',
] as const;

export const DEFAULT_SESSION_COOKIE_NAME = '__Host-nalara_session';
const MIN_SESSION_SECRET_LENGTH = 32;
const MFA_KEY_BYTES = 32;
const PLACEHOLDER_PATTERN = /replace[-_ ]?with|change[-_ ]?me|placeholder|^<.*>$|^x{3,}$/i;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration: ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const required = (key: string) =>
  z
    .string({ error: `${key} is required` })
    .trim()
    .min(1, { error: `${key} is required` });

const notPlaceholder = (key: string) => (value: string) =>
  PLACEHOLDER_PATTERN.test(value) ? `${key} still contains a placeholder value` : undefined;

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production'], {
    error: 'NODE_ENV must be one of development, test, production',
  }),
  APP_BASE_URL: required('APP_BASE_URL'),
  DATABASE_URL: required('DATABASE_URL'),
  SESSION_COOKIE_NAME: z
    .string()
    .trim()
    .regex(/^(__Host-)?[A-Za-z0-9_-]{1,64}$/, {
      error: 'SESSION_COOKIE_NAME may only contain letters, digits, "_" and "-"',
    })
    .default(DEFAULT_SESSION_COOKIE_NAME),
  SESSION_SECRET: required('SESSION_SECRET'),
  MFA_ENCRYPTION_KEY: required('MFA_ENCRYPTION_KEY'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'], {
      error: 'LOG_LEVEL must be one of fatal, error, warn, info, debug, trace',
    })
    .default('info'),
  PORT: z
    .string()
    .trim()
    .regex(/^\d{1,5}$/, { error: 'PORT must be an integer between 1 and 65535' })
    .transform(Number)
    .refine((port) => port >= 1 && port <= 65535, {
      error: 'PORT must be an integer between 1 and 65535',
    })
    .default(4000),
});

type RawEnv = Readonly<Record<string, string | undefined>>;

/** Validate the environment. Throws ConfigError listing every problem (names only, no values). */
export function loadConfig(env: RawEnv = process.env): Config {
  const issues: string[] = [];

  for (const key of Object.keys(env)) {
    const reserved = RESERVED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (reserved && !(KNOWN_ENV_KEYS as readonly string[]).includes(key)) {
      issues.push(`${key} is not a known variable (check for a typo)`);
    }
  }

  // Treat empty strings as "not set" so defaults apply and required checks fire.
  const input = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) issues.push(issue.message);
    throw new ConfigError(issues);
  }

  const raw = parsed.data;
  const production = raw.NODE_ENV === 'production';

  const appUrl = parseUrl(raw.APP_BASE_URL);
  if (appUrl === undefined || !['http:', 'https:'].includes(appUrl.protocol)) {
    issues.push('APP_BASE_URL must be an absolute http(s) URL');
  } else {
    if (appUrl.pathname !== '/' || appUrl.search !== '' || appUrl.hash !== '') {
      issues.push('APP_BASE_URL must be an origin without path, query or fragment');
    }
    if (appUrl.username !== '' || appUrl.password !== '') {
      issues.push('APP_BASE_URL must not contain credentials');
    }
    if (production && appUrl.protocol !== 'https:') {
      issues.push('APP_BASE_URL must use https in production');
    }
    if (!production && appUrl.protocol === 'http:' && !LOCAL_HOSTNAMES.has(appUrl.hostname)) {
      issues.push('APP_BASE_URL may use http only for localhost');
    }
  }

  const dbUrl = parseUrl(raw.DATABASE_URL);
  if (
    dbUrl === undefined ||
    !['postgres:', 'postgresql:'].includes(dbUrl.protocol) ||
    dbUrl.hostname === '' ||
    dbUrl.pathname.length <= 1
  ) {
    issues.push('DATABASE_URL must be a postgres:// URL with host and database name');
  }

  for (const [key, value] of [
    ['SESSION_SECRET', raw.SESSION_SECRET],
    ['MFA_ENCRYPTION_KEY', raw.MFA_ENCRYPTION_KEY],
    ['DATABASE_URL', raw.DATABASE_URL],
  ] as const) {
    const problem = notPlaceholder(key)(value);
    if (problem !== undefined) issues.push(problem);
  }

  if (raw.SESSION_SECRET.length < MIN_SESSION_SECRET_LENGTH) {
    issues.push(`SESSION_SECRET must be at least ${String(MIN_SESSION_SECRET_LENGTH)} characters`);
  }

  const mfaKey = decodeBase64Key(raw.MFA_ENCRYPTION_KEY);
  if (mfaKey?.length !== MFA_KEY_BYTES) {
    issues.push(`MFA_ENCRYPTION_KEY must be base64 for exactly ${String(MFA_KEY_BYTES)} bytes`);
  }

  if (production && !raw.SESSION_COOKIE_NAME.startsWith('__Host-')) {
    issues.push('SESSION_COOKIE_NAME must start with "__Host-" in production');
  }
  if (production && (raw.LOG_LEVEL === 'debug' || raw.LOG_LEVEL === 'trace')) {
    issues.push('LOG_LEVEL debug/trace is not allowed in production');
  }

  if (issues.length > 0 || appUrl === undefined || mfaKey === undefined) {
    throw new ConfigError(issues);
  }

  return {
    nodeEnv: raw.NODE_ENV,
    appOrigin: appUrl.origin,
    databaseUrl: raw.DATABASE_URL,
    session: { cookieName: raw.SESSION_COOKIE_NAME, secret: raw.SESSION_SECRET },
    mfaEncryptionKey: mfaKey,
    logLevel: raw.LOG_LEVEL,
    port: raw.PORT,
  };
}

function decodeBase64Key(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return undefined;
  return Buffer.from(value, 'base64');
}

/** Log-safe view of the configuration: secrets replaced, database credentials removed. */
export function describeConfig(config: Config): Record<string, unknown> {
  const db = new URL(config.databaseUrl);
  return {
    nodeEnv: config.nodeEnv,
    appOrigin: config.appOrigin,
    database: `${db.protocol}//${db.host}${db.pathname}`,
    sessionCookieName: config.session.cookieName,
    sessionSecret: '[REDACTED]',
    mfaEncryptionKey: '[REDACTED]',
    logLevel: config.logLevel,
    port: config.port,
  };
}
