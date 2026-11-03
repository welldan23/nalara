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
export const SECRET_ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_MIGRATOR_URL',
  'SESSION_SECRET',
  'MFA_ENCRYPTION_KEY',
] as const;

/** Every variable NALARA understands. Used by the typo guard and by .env.example tests. */
export const KNOWN_ENV_KEYS = [
  'NODE_ENV',
  'APP_BASE_URL',
  'API_BASE_URL',
  'DATABASE_URL',
  'DATABASE_MIGRATOR_URL',
  'SESSION_COOKIE_NAME',
  'SESSION_SECRET',
  'MFA_ENCRYPTION_KEY',
  'LOG_LEVEL',
  'PORT',
  'FOUNDER_EMAIL',
  'BACKUP_DESTINATION',
] as const;

/**
 * Variables read only by Docker Compose and db/init (never by the API process).
 * Listed so .env.example stays complete; they use no reserved prefix.
 */
export const COMPOSE_ENV_KEYS = [
  'POSTGRES_PASSWORD',
  'DB_MIGRATOR_PASSWORD',
  'DB_APP_PASSWORD',
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
  const issues = typoIssues(env);
  const parsed = schema.safeParse(nonEmpty(env));
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

  checkDatabaseUrl('DATABASE_URL', raw.DATABASE_URL, issues);

  for (const [key, value] of [
    ['SESSION_SECRET', raw.SESSION_SECRET],
    ['MFA_ENCRYPTION_KEY', raw.MFA_ENCRYPTION_KEY],
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

export interface MigratorConfig {
  readonly nodeEnv: NodeEnv;
  /** Connection for the DDL-capable nalara_migrator role (ADR-003). */
  readonly migratorDatabaseUrl: string;
}

const migratorSchema = z.object({
  NODE_ENV: schema.shape.NODE_ENV,
  DATABASE_MIGRATOR_URL: required('DATABASE_MIGRATOR_URL'),
});

/** Config for the migration CLI only: it never needs session or MFA secrets. */
export function loadMigratorConfig(env: RawEnv = process.env): MigratorConfig {
  const issues = typoIssues(env);
  const parsed = migratorSchema.safeParse(nonEmpty(env));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) issues.push(issue.message);
    throw new ConfigError(issues);
  }
  checkDatabaseUrl('DATABASE_MIGRATOR_URL', parsed.data.DATABASE_MIGRATOR_URL, issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return { nodeEnv: parsed.data.NODE_ENV, migratorDatabaseUrl: parsed.data.DATABASE_MIGRATOR_URL };
}

export interface BootstrapConfig {
  readonly nodeEnv: NodeEnv;
  /** Application-role connection; nalara_app may insert the founder and the audit row. */
  readonly databaseUrl: string;
  /** Lower-cased founder email. */
  readonly founderEmail: string;
}

const bootstrapSchema = z.object({
  NODE_ENV: schema.shape.NODE_ENV,
  DATABASE_URL: required('DATABASE_URL'),
  FOUNDER_EMAIL: required('FOUNDER_EMAIL')
    .max(254, { error: 'FOUNDER_EMAIL must be at most 254 characters' })
    .pipe(z.email({ error: 'FOUNDER_EMAIL must be a valid email address' })),
});

/** Config for the one-time founder bootstrap CLI (P0-007). The password is never read from env. */
export function loadBootstrapConfig(env: RawEnv = process.env): BootstrapConfig {
  const issues = typoIssues(env);
  const parsed = bootstrapSchema.safeParse(nonEmpty(env));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) issues.push(issue.message);
    throw new ConfigError(issues);
  }
  checkDatabaseUrl('DATABASE_URL', parsed.data.DATABASE_URL, issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return {
    nodeEnv: parsed.data.NODE_ENV,
    databaseUrl: parsed.data.DATABASE_URL,
    founderEmail: parsed.data.FOUNDER_EMAIL.toLowerCase(),
  };
}

/**
 * Typo guard (TEST-ENV-06). A variable that is not ours but is a near miss of one of ours
 * (edit distance <= 2 for names of 8+ characters, or same name in another case) is almost certainly a misspelling, e.g.
 * SESSION_SECRT or session_secret, and silently ignoring it would start the API without that
 * setting. Unrelated variables are left alone, even with a similar prefix: hosting platforms
 * set their own (e.g. SESSION_INGRESS_URL), and rejecting those would make startup brittle.
 */
function typoIssues(env: RawEnv): string[] {
  const known: readonly string[] = [...KNOWN_ENV_KEYS, ...COMPOSE_ENV_KEYS];
  const issues: string[] = [];
  for (const key of Object.keys(env)) {
    if (known.includes(key)) continue;
    const nearMiss = known.find(
      (candidate) =>
        candidate === key.toUpperCase() ||
        // Short names (PORT) only match by case: PATH is two edits from PORT but unrelated.
        (candidate.length >= 8 &&
          Math.abs(candidate.length - key.length) <= 2 &&
          editDistance(candidate, key) <= 2),
    );
    if (nearMiss !== undefined) {
      issues.push(`${key} is not a known variable (did you mean ${nearMiss}?)`);
    }
  }
  return issues;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Treat empty strings as "not set" so defaults apply and required checks fire. */
function nonEmpty(env: RawEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== '',
    ),
  );
}

function checkDatabaseUrl(key: string, value: string, issues: string[]): void {
  const url = parseUrl(value);
  if (
    url === undefined ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname === '' ||
    url.pathname.length <= 1
  ) {
    issues.push(`${key} must be a postgres:// URL with host and database name`);
  }
  const problem = notPlaceholder(key)(value);
  if (problem !== undefined) issues.push(problem);
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
