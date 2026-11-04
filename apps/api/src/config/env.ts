// Typed, fail-fast environment configuration for the API (P0-004, ADR-004, ADR-005).
//
// Contract:
// - loadConfig() either returns a fully validated Config or throws ConfigError.
// - ConfigError messages name the variable and the rule that failed, never the value.
// - Production is stricter than development/test (HTTPS origin, __Host- cookie, no debug logs).
import { isIP } from 'node:net';
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
  /**
   * Reverse proxies whose X-Forwarded-For is trusted (IPs or CIDRs). Empty: trust nobody, so the
   * client IP used for rate limiting is the TCP peer.
   */
  readonly trustedProxies: readonly string[];
  /**
   * Rollout flag (ADR-015): false keeps every published article off the public API (404), so a
   * fresh deployment never shows content before the founder decides to launch.
   */
  readonly publicSiteEnabled: boolean;
  /**
   * Requests per minute per client IP across the API (default 300). Tests only: refused in
   * production, where the default always applies.
   */
  readonly rateLimitMax?: number;
}

/** Variables whose values must never appear in logs or error messages. */
export const SECRET_ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_MIGRATOR_URL',
  'WORKER_DATABASE_URL',
  'SESSION_SECRET',
  'MFA_ENCRYPTION_KEY',
  'AGENT_TOKEN',
  'AI_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
] as const;

/** Every variable NALARA understands. Used by the typo guard and by .env.example tests. */
export const KNOWN_ENV_KEYS = [
  'NODE_ENV',
  'APP_BASE_URL',
  'API_BASE_URL',
  'DATABASE_URL',
  'DATABASE_MIGRATOR_URL',
  'WORKER_DATABASE_URL',
  'SESSION_COOKIE_NAME',
  'SESSION_SECRET',
  'MFA_ENCRYPTION_KEY',
  'LOG_LEVEL',
  'PORT',
  'TRUSTED_PROXIES',
  'PUBLIC_SITE_ENABLED',
  'RATE_LIMIT_MAX',
  'FOUNDER_EMAIL',
  'BACKUP_DESTINATION',
  // Agent runner only (P3-03).
  'AGENT_GATEWAY_URL',
  'AGENT_TOKEN',
  'AGENT_ROLES',
  'AGENT_INTERVAL_SECONDS',
  'AI_BASE_URL',
  'AI_API_KEY',
  'AI_MODEL',
  // Founder Telegram bot (P3-04, D-26).
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_FOUNDER_USER_ID',
  'TELEGRAM_CHAT_ID',
] as const;

/**
 * Variables read only by Docker Compose and db/init (never by the API process).
 * Listed so .env.example stays complete; they use no reserved prefix.
 */
export const COMPOSE_ENV_KEYS = [
  'POSTGRES_PASSWORD',
  'DB_MIGRATOR_PASSWORD',
  'DB_APP_PASSWORD',
  'DB_WORKER_PASSWORD',
  'SITE_ADDRESS',
  'CADDY_TLS',
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
  TRUSTED_PROXIES: z.string().trim().default(''),
  PUBLIC_SITE_ENABLED: z
    .enum(['true', 'false'], { error: 'PUBLIC_SITE_ENABLED must be true or false' })
    .default('false'),
  RATE_LIMIT_MAX: z.coerce
    .number({ error: 'RATE_LIMIT_MAX must be an integer between 30 and 100000' })
    .int({ error: 'RATE_LIMIT_MAX must be an integer between 30 and 100000' })
    .min(30, { error: 'RATE_LIMIT_MAX must be an integer between 30 and 100000' })
    .max(100_000, { error: 'RATE_LIMIT_MAX must be an integer between 30 and 100000' })
    .optional(),
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

  const trustedProxies =
    raw.TRUSTED_PROXIES === '' ? [] : raw.TRUSTED_PROXIES.split(',').map((entry) => entry.trim());
  if (!trustedProxies.every(isIpOrCidr)) {
    issues.push('TRUSTED_PROXIES must be a comma-separated list of IP addresses or CIDR ranges');
  }

  if (production && raw.RATE_LIMIT_MAX !== undefined) {
    issues.push('RATE_LIMIT_MAX is for tests only and is not allowed in production');
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
    trustedProxies,
    publicSiteEnabled: raw.PUBLIC_SITE_ENABLED === 'true',
    ...(raw.RATE_LIMIT_MAX === undefined ? {} : { rateLimitMax: raw.RATE_LIMIT_MAX }),
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

export interface WorkerConfig {
  readonly nodeEnv: NodeEnv;
  /** Connection for the nalara_worker role (P2-02): queue and ingestion tables only. */
  readonly databaseUrl: string;
  readonly logLevel: LogLevel;
}

const workerSchema = z.object({
  NODE_ENV: schema.shape.NODE_ENV,
  WORKER_DATABASE_URL: required('WORKER_DATABASE_URL'),
  LOG_LEVEL: schema.shape.LOG_LEVEL,
});

/** Config for the worker process only: no session, MFA or app-role secrets (P2-02). */
export function loadWorkerConfig(env: RawEnv = process.env): WorkerConfig {
  const issues = typoIssues(env);
  const parsed = workerSchema.safeParse(nonEmpty(env));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) issues.push(issue.message);
    throw new ConfigError(issues);
  }
  checkDatabaseUrl('WORKER_DATABASE_URL', parsed.data.WORKER_DATABASE_URL, issues);
  if (parsed.data.NODE_ENV === 'production' && ['debug', 'trace'].includes(parsed.data.LOG_LEVEL)) {
    issues.push('LOG_LEVEL debug/trace is not allowed in production');
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return {
    nodeEnv: parsed.data.NODE_ENV,
    databaseUrl: parsed.data.WORKER_DATABASE_URL,
    logLevel: parsed.data.LOG_LEVEL,
  };
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

function isIpOrCidr(entry: string): boolean {
  const [address = '', prefix, extra] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || extra !== undefined) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
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
    publicSiteEnabled: config.publicSiteEnabled,
    ...(config.rateLimitMax === undefined ? {} : { rateLimitMax: config.rateLimitMax }),
  };
}

export interface AdminCliConfig {
  readonly nodeEnv: NodeEnv;
  /** Application-role connection. */
  readonly databaseUrl: string;
}

const adminCliSchema = z.object({
  NODE_ENV: schema.shape.NODE_ENV,
  DATABASE_URL: required('DATABASE_URL'),
});

/** Config for small admin CLIs on the server (P3-02 agent credentials). */
export function loadAdminCliConfig(env: RawEnv = process.env): AdminCliConfig {
  const issues = typoIssues(env);
  const parsed = adminCliSchema.safeParse(nonEmpty(env));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) issues.push(issue.message);
    throw new ConfigError(issues);
  }
  checkDatabaseUrl('DATABASE_URL', parsed.data.DATABASE_URL, issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return { nodeEnv: parsed.data.NODE_ENV, databaseUrl: parsed.data.DATABASE_URL };
}

const AGENT_ROLE_NAMES = ['radar', 'penulis', 'pemeriksa', 'periset', 'pemantau'] as const;
export type AgentRoleName = (typeof AGENT_ROLE_NAMES)[number];

export interface AgentProviderConfig {
  /** OpenAI-compatible base URL, e.g. https://api.example.com/v1 (https only). */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export interface AgentRunnerConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
  /** The API's internal address; the runner talks to nothing else inside NALARA. */
  readonly gatewayUrl: string;
  readonly token: string;
  readonly roles: readonly AgentRoleName[];
  readonly intervalSeconds: number;
  /** null until the founder picks a provider (D-25): the runner then stays idle. */
  readonly provider: AgentProviderConfig | null;
}

const agentSchema = z.object({
  NODE_ENV: schema.shape.NODE_ENV,
  LOG_LEVEL: schema.shape.LOG_LEVEL,
  AGENT_GATEWAY_URL: required('AGENT_GATEWAY_URL'),
  AGENT_TOKEN: required('AGENT_TOKEN'),
  AGENT_ROLES: z.string().default(AGENT_ROLE_NAMES.join(',')),
  AGENT_INTERVAL_SECONDS: z.coerce
    .number({ error: 'AGENT_INTERVAL_SECONDS must be a number' })
    .int({ error: 'AGENT_INTERVAL_SECONDS must be a whole number' })
    .min(60, { error: 'AGENT_INTERVAL_SECONDS must be at least 60' })
    .max(86_400, { error: 'AGENT_INTERVAL_SECONDS must be at most 86400' })
    .default(1800),
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
});

/**
 * Config for the agent runner (P3-03, ADR-020): a gateway token and, optionally, an AI provider.
 * No database URL, session or MFA secret is read here: the runner has none.
 */
export function loadAgentRunnerConfig(env: RawEnv = process.env): AgentRunnerConfig {
  const issues = typoIssues(env);
  const parsed = agentSchema.safeParse(nonEmpty(env));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) issues.push(issue.message);
    throw new ConfigError(issues);
  }
  const data = parsed.data;
  const gateway = parseUrl(data.AGENT_GATEWAY_URL);
  if (gateway === undefined || !['http:', 'https:'].includes(gateway.protocol)) {
    issues.push('AGENT_GATEWAY_URL must be an http(s) URL');
  } else if (gateway.username !== '' || gateway.password !== '') {
    issues.push('AGENT_GATEWAY_URL must not contain credentials');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(data.AGENT_TOKEN)) {
    issues.push('AGENT_TOKEN must be the token printed by agent:credential create');
  }
  const roles = data.AGENT_ROLES.split(',').map((role) => role.trim());
  const known: readonly string[] = AGENT_ROLE_NAMES;
  if (roles.length === 0 || roles.some((role) => !known.includes(role))) {
    issues.push(`AGENT_ROLES must be a comma-separated list of ${AGENT_ROLE_NAMES.join(', ')}`);
  }
  // The provider counts as configured only once its base URL is set; the example file's
  // placeholder key alone does not switch anything on.
  let provider: AgentProviderConfig | null = null;
  if (data.AI_BASE_URL !== undefined) {
    const base = parseUrl(data.AI_BASE_URL);
    if (base?.protocol !== 'https:' || base.username !== '' || base.password !== '') {
      issues.push('AI_BASE_URL must be an https URL without credentials');
    }
    if (data.AI_API_KEY === undefined) issues.push('AI_API_KEY is required with AI_BASE_URL');
    else {
      const problem = notPlaceholder('AI_API_KEY')(data.AI_API_KEY);
      if (problem !== undefined) issues.push(problem);
    }
    if (data.AI_MODEL === undefined || !/^[A-Za-z0-9._:/-]{1,100}$/.test(data.AI_MODEL)) {
      issues.push('AI_MODEL is required with AI_BASE_URL (letters, digits, . _ : / -)');
    }
    provider = {
      baseUrl: data.AI_BASE_URL.replace(/\/+$/, ''),
      apiKey: data.AI_API_KEY ?? '',
      model: data.AI_MODEL ?? '',
    };
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return {
    nodeEnv: data.NODE_ENV,
    logLevel: data.LOG_LEVEL,
    gatewayUrl: data.AGENT_GATEWAY_URL.replace(/\/+$/, ''),
    token: data.AGENT_TOKEN,
    roles: [...new Set(roles)] as AgentRoleName[],
    intervalSeconds: data.AGENT_INTERVAL_SECONDS,
    provider,
  };
}

export interface TelegramWebhookConfig {
  /** Telegram sends it back in X-Telegram-Bot-Api-Secret-Token on every update. */
  readonly secret: string;
  /** Numeric ids: only this user, in this chat, is ever answered. */
  readonly founderUserId: number;
  readonly chatId: number;
}

export interface TelegramBotConfig {
  readonly botToken: string;
  readonly chatId: number;
}

const TELEGRAM_SECRET = /^[A-Za-z0-9_-]{32,256}$/;
const TELEGRAM_BOT_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;

function telegramId(key: string, value: string | undefined, issues: string[]): number {
  if (value === undefined || !/^-?\d{1,15}$/.test(value)) {
    issues.push(`${key} must be a numeric Telegram id`);
    return 0;
  }
  return Number(value);
}

/**
 * The API's side of the founder bot (P3-04): the webhook. Off (null) until
 * TELEGRAM_WEBHOOK_SECRET is set; then the founder's user id and chat id are required too.
 */
export function loadTelegramWebhookConfig(env: RawEnv = process.env): TelegramWebhookConfig | null {
  const raw = nonEmpty(env);
  const secret = raw['TELEGRAM_WEBHOOK_SECRET'];
  // The example file's placeholder means "not set up yet", like an empty value.
  if (secret === undefined || PLACEHOLDER_PATTERN.test(secret)) return null;
  const issues: string[] = [];
  if (!TELEGRAM_SECRET.test(secret)) {
    issues.push('TELEGRAM_WEBHOOK_SECRET must be 32-256 characters of A-Z a-z 0-9 _ -');
  }
  const founderUserId = telegramId(
    'TELEGRAM_FOUNDER_USER_ID',
    raw['TELEGRAM_FOUNDER_USER_ID'],
    issues,
  );
  const chatId = telegramId('TELEGRAM_CHAT_ID', raw['TELEGRAM_CHAT_ID'], issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return { secret, founderUserId, chatId };
}

/** The worker's side of the founder bot (P3-04): sending. Off (null) until the token is set. */
export function loadTelegramBotConfig(env: RawEnv = process.env): TelegramBotConfig | null {
  const raw = nonEmpty(env);
  const botToken = raw['TELEGRAM_BOT_TOKEN'];
  if (botToken === undefined || PLACEHOLDER_PATTERN.test(botToken)) return null;
  const issues: string[] = [];
  if (!TELEGRAM_BOT_TOKEN.test(botToken)) {
    issues.push('TELEGRAM_BOT_TOKEN must be the token from @BotFather');
  }
  const chatId = telegramId('TELEGRAM_CHAT_ID', raw['TELEGRAM_CHAT_ID'], issues);
  if (issues.length > 0) throw new ConfigError(issues);
  return { botToken, chatId };
}
