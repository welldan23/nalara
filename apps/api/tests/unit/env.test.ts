// P0-004 environment validation (PRD §14.2 TEST-ENV-01..10).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMPOSE_ENV_KEYS,
  ConfigError,
  DEFAULT_SESSION_COOKIE_NAME,
  KNOWN_ENV_KEYS,
  SECRET_ENV_KEYS,
  describeConfig,
  loadConfig,
  loadMigratorConfig,
  loadAgentRunnerConfig,
} from '../../src/config/env.ts';

// Obvious, low-entropy fixture values: test-only, never real secrets.
const SESSION_SECRET = 'test-session-secret-'.padEnd(40, 'a');
const MFA_KEY = Buffer.alloc(32, 7).toString('base64');
const DB_PASSWORD = 'fixture-db-password';
const DATABASE_URL = `postgres://nalara_app:${DB_PASSWORD}@localhost:5432/nalara_test`;

const validEnv: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL,
  SESSION_SECRET,
  MFA_ENCRYPTION_KEY: MFA_KEY,
};

const productionEnv: Readonly<Record<string, string>> = {
  ...validEnv,
  NODE_ENV: 'production',
  APP_BASE_URL: 'https://nalara.example',
};

function issuesFor(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  return [];
}

function without(key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(validEnv).filter(([name]) => name !== key));
}

describe('loadConfig: valid input', () => {
  it('returns typed config with defaults', () => {
    const config = loadConfig(validEnv);
    expect(config.nodeEnv).toBe('test');
    expect(config.appOrigin).toBe('http://localhost:3000');
    expect(config.port).toBe(4000);
    expect(config.logLevel).toBe('info');
    expect(config.session.cookieName).toBe(DEFAULT_SESSION_COOKIE_NAME);
    expect(config.mfaEncryptionKey).toHaveLength(32);
  });

  it('ignores unrelated variables such as PATH and HOME', () => {
    expect(() => loadConfig({ ...validEnv, PATH: '/usr/bin', HOME: '/root' })).not.toThrow();
  });
});

describe('TEST-ENV-01 missing DATABASE_URL', () => {
  it('fails with a named, safe error', () => {
    expect(issuesFor(without('DATABASE_URL'))).toContain('DATABASE_URL is required');
  });

  it('treats an empty value as missing', () => {
    expect(issuesFor({ ...validEnv, DATABASE_URL: '  ' })).toContain('DATABASE_URL is required');
  });
});

describe('TEST-ENV-02 invalid DATABASE_URL', () => {
  it.each([
    'not a url',
    'mysql://user:pw@localhost:3306/nalara',
    'postgres://localhost:5432',
    'postgres://user:pw@/nalara',
  ])('rejects %s', (value) => {
    expect(issuesFor({ ...validEnv, DATABASE_URL: value })).toContain(
      'DATABASE_URL must be a postgres:// URL with host and database name',
    );
  });

  it('accepts postgresql:// as well', () => {
    expect(
      issuesFor({ ...validEnv, DATABASE_URL: DATABASE_URL.replace('postgres:', 'postgresql:') }),
    ).toEqual([]);
  });
});

describe('TEST-ENV-03 empty or weak SESSION_SECRET', () => {
  it('rejects empty', () => {
    expect(issuesFor({ ...validEnv, SESSION_SECRET: '' })).toContain('SESSION_SECRET is required');
  });

  it('rejects shorter than 32 characters', () => {
    expect(issuesFor({ ...validEnv, SESSION_SECRET: 'short-secret' })).toContain(
      'SESSION_SECRET must be at least 32 characters',
    );
  });

  it('rejects an MFA key that is not 32 bytes of base64', () => {
    for (const value of [Buffer.alloc(16, 1).toString('base64'), 'not-base64!!', `${MFA_KEY}A`]) {
      expect(issuesFor({ ...validEnv, MFA_ENCRYPTION_KEY: value })).toContain(
        'MFA_ENCRYPTION_KEY must be base64 for exactly 32 bytes',
      );
    }
  });
});

describe('TEST-ENV-04 invalid APP_BASE_URL', () => {
  it.each([
    ['not a url', 'APP_BASE_URL must be an absolute http(s) URL'],
    ['ftp://localhost', 'APP_BASE_URL must be an absolute http(s) URL'],
    ['http://localhost:3000/os', 'APP_BASE_URL must be an origin without path, query or fragment'],
    ['http://user:pw@localhost:3000', 'APP_BASE_URL must not contain credentials'],
    ['http://nalara.example', 'APP_BASE_URL may use http only for localhost'],
  ])('rejects %s', (value, message) => {
    expect(issuesFor({ ...validEnv, APP_BASE_URL: value })).toContain(message);
  });

  it('normalises a trailing slash to the bare origin', () => {
    expect(loadConfig({ ...validEnv, APP_BASE_URL: 'http://localhost:3000/' }).appOrigin).toBe(
      'http://localhost:3000',
    );
  });
});

describe('RATE_LIMIT_MAX (P1-08, tests only)', () => {
  it('defaults to unset, so the API uses its built-in limit', () => {
    expect(loadConfig(validEnv).rateLimitMax).toBeUndefined();
  });

  it('accepts a bounded integer outside production', () => {
    expect(loadConfig({ ...validEnv, RATE_LIMIT_MAX: '2000' }).rateLimitMax).toBe(2000);
  });

  it.each(['abc', '1.5', '0', '29', '100001'])('rejects %s', (value) => {
    expect(issuesFor({ ...validEnv, RATE_LIMIT_MAX: value })).toContain(
      'RATE_LIMIT_MAX must be an integer between 30 and 100000',
    );
  });

  it('is refused in production, so the default always protects the live API', () => {
    expect(issuesFor({ ...productionEnv, RATE_LIMIT_MAX: '2000' })).toContain(
      'RATE_LIMIT_MAX is for tests only and is not allowed in production',
    );
  });
});

describe('TEST-ENV-05 production debug flag', () => {
  it.each(['debug', 'trace'])('rejects LOG_LEVEL=%s in production', (level) => {
    expect(issuesFor({ ...productionEnv, LOG_LEVEL: level })).toContain(
      'LOG_LEVEL debug/trace is not allowed in production',
    );
  });

  it('allows debug outside production', () => {
    expect(loadConfig({ ...validEnv, LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
  });

  it('rejects an unknown NODE_ENV and requires it to be set', () => {
    expect(issuesFor({ ...validEnv, NODE_ENV: 'staging' })).toContain(
      'NODE_ENV must be one of development, test, production',
    );
    expect(issuesFor(without('NODE_ENV'))).toContain(
      'NODE_ENV must be one of development, test, production',
    );
  });
});

describe('TEST-ENV-06 unknown env rejected', () => {
  it.each([
    ['SESSION_SECRT', 'SESSION_SECRET'],
    ['DATABSE_URL', 'DATABASE_URL'],
    ['session_secret', 'SESSION_SECRET'],
    ['MFA_ENCRYPTION_KY', 'MFA_ENCRYPTION_KEY'],
    ['APP_BASE_UR', 'APP_BASE_URL'],
    ['port', 'PORT'],
  ])('rejects the near-miss %s', (typo, intended) => {
    expect(issuesFor({ ...validEnv, [typo]: 'x' })).toContain(
      `${typo} is not a known variable (did you mean ${intended}?)`,
    );
  });

  it('ignores unrelated platform variables that merely share a prefix', () => {
    expect(
      issuesFor({
        ...validEnv,
        SESSION_INGRESS_URL: 'https://x',
        APP_ID: '1',
        LOG_FORMAT: 'json',
        PATH: '/usr/bin',
        PWD: '/srv',
        HOSTNAME: 'vps',
      }),
    ).toEqual([]);
  });

  it('rejects an invalid PORT', () => {
    for (const port of ['0', '65536', 'abc', '80.5']) {
      expect(issuesFor({ ...validEnv, PORT: port })).toContain(
        'PORT must be an integer between 1 and 65535',
      );
    }
  });
});

describe('TEST-ENV-07 redaction on error', () => {
  it('never includes secret values in error messages', () => {
    const leakyEnv = {
      ...validEnv,
      NODE_ENV: 'production',
      APP_BASE_URL: 'http://insecure.example',
      SESSION_SECRET: 'tooshort-but-secret-value',
      MFA_ENCRYPTION_KEY: 'definitely-not-a-key-value',
      DATABASE_URL: `mysql://root:${DB_PASSWORD}@db/nalara`,
    };
    let message = '';
    try {
      loadConfig(leakyEnv);
    } catch (error) {
      message = error instanceof Error ? `${error.message} ${error.stack ?? ''}` : '';
    }
    expect(message).toContain('Invalid environment configuration');
    for (const secret of [DB_PASSWORD, 'tooshort-but-secret-value', 'definitely-not-a-key-value']) {
      expect(message).not.toContain(secret);
    }
  });

  it('reports every problem at once', () => {
    expect(issuesFor({ NODE_ENV: 'test' }).length).toBeGreaterThanOrEqual(4);
  });
});

describe('TEST-ENV-08 secret absent in startup log', () => {
  it('describeConfig redacts secrets and database credentials', () => {
    const summary = JSON.stringify(describeConfig(loadConfig(validEnv)));
    for (const secret of [SESSION_SECRET, MFA_KEY, DB_PASSWORD, 'nalara_app']) {
      expect(summary).not.toContain(secret);
    }
    expect(summary).toContain('[REDACTED]');
    expect(summary).toContain('localhost:5432/nalara_test');
  });

  it('marks every secret key as secret', () => {
    expect(SECRET_ENV_KEYS).toEqual([
      'DATABASE_URL',
      'DATABASE_MIGRATOR_URL',
      'WORKER_DATABASE_URL',
      'SESSION_SECRET',
      'MFA_ENCRYPTION_KEY',
      'AGENT_TOKEN',
      'AI_API_KEY',
    ]);
  });
});

describe('TEST-ENV-09 different dev/prod config', () => {
  it('accepts a correct production config', () => {
    expect(loadConfig(productionEnv).appOrigin).toBe('https://nalara.example');
  });

  it('requires https in production', () => {
    expect(issuesFor({ ...productionEnv, APP_BASE_URL: 'http://localhost:3000' })).toContain(
      'APP_BASE_URL must use https in production',
    );
  });

  it('requires a __Host- cookie in production only', () => {
    expect(issuesFor({ ...productionEnv, SESSION_COOKIE_NAME: 'nalara_session' })).toContain(
      'SESSION_COOKIE_NAME must start with "__Host-" in production',
    );
    expect(
      loadConfig({ ...validEnv, SESSION_COOKIE_NAME: 'nalara_session' }).session.cookieName,
    ).toBe('nalara_session');
  });
});

describe('TEST-ENV-10 .env.example contains placeholders only', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const lines = readFileSync(join(root, '.env.example'), 'utf8').split('\n');
  const entries = lines
    .map((line) => line.replace(/^#\s*/, ''))
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => {
      const [key = '', ...rest] = line.split('=');
      return [key, rest.join('=')] as const;
    });
  const example = Object.fromEntries(
    lines
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const [key = '', ...rest] = line.split('=');
        return [key, rest.join('=')];
      }),
  );

  it('documents every known variable and nothing else', () => {
    expect(entries.map(([key]) => key).sort()).toEqual(
      [...KNOWN_ENV_KEYS, ...COMPOSE_ENV_KEYS].sort(),
    );
  });

  it('uses placeholders for every secret', () => {
    for (const key of SECRET_ENV_KEYS) {
      expect(example[key], key).toMatch(/REPLACE_WITH_/);
    }
  });

  it('cannot be used as-is: the API refuses to start with the example values', () => {
    const issues = issuesFor(example);
    expect(issues).toContain('SESSION_SECRET still contains a placeholder value');
    expect(issues).toContain('MFA_ENCRYPTION_KEY still contains a placeholder value');
    expect(issues).toContain('DATABASE_URL still contains a placeholder value');
  });
});

describe('loadMigratorConfig', () => {
  const migratorUrl = 'postgres://nalara_migrator:fixture-migrator-pw@localhost:5432/nalara';

  it('needs only NODE_ENV and DATABASE_MIGRATOR_URL', () => {
    expect(loadMigratorConfig({ NODE_ENV: 'test', DATABASE_MIGRATOR_URL: migratorUrl })).toEqual({
      nodeEnv: 'test',
      migratorDatabaseUrl: migratorUrl,
    });
  });

  it('rejects a missing, invalid or placeholder URL without echoing it', () => {
    const messages = (env: Record<string, string>) => {
      try {
        loadMigratorConfig(env);
      } catch (error) {
        return error instanceof ConfigError ? error.issues : [];
      }
      return [];
    };
    expect(messages({ NODE_ENV: 'test' })).toContain('DATABASE_MIGRATOR_URL is required');
    expect(messages({ NODE_ENV: 'test', DATABASE_MIGRATOR_URL: 'mysql://x' })).toContain(
      'DATABASE_MIGRATOR_URL must be a postgres:// URL with host and database name',
    );
    const placeholder = messages({
      NODE_ENV: 'test',
      DATABASE_MIGRATOR_URL: 'postgres://m:REPLACE_WITH_PW@localhost:5432/nalara',
    });
    expect(placeholder).toContain('DATABASE_MIGRATOR_URL still contains a placeholder value');
    expect(placeholder.join(' ')).not.toContain('REPLACE_WITH_PW');
  });
});

describe('TRUSTED_PROXIES', () => {
  it('defaults to trusting nobody', () => {
    expect(loadConfig(validEnv).trustedProxies).toEqual([]);
  });

  it('accepts IPv4/IPv6 addresses and CIDR ranges', () => {
    expect(
      loadConfig({ ...validEnv, TRUSTED_PROXIES: '172.31.250.10, 10.0.0.0/8,::1,fd00::/8' })
        .trustedProxies,
    ).toEqual(['172.31.250.10', '10.0.0.0/8', '::1', 'fd00::/8']);
  });

  it.each(['caddy', '10.0.0.0/33', '1.2.3.4/8/1', '*', '10.0.0.0/x'])('rejects %s', (value) => {
    expect(issuesFor({ ...validEnv, TRUSTED_PROXIES: value })).toContain(
      'TRUSTED_PROXIES must be a comma-separated list of IP addresses or CIDR ranges',
    );
  });
});

describe('loadAgentRunnerConfig (P3-03)', () => {
  const token = 'A'.repeat(43);
  const base = { NODE_ENV: 'production', AGENT_GATEWAY_URL: 'http://api:4000', AGENT_TOKEN: token };
  const issues = (env: Record<string, string>) => {
    try {
      loadAgentRunnerConfig(env);
      return [];
    } catch (error) {
      return (error as { issues: string[] }).issues;
    }
  };

  it('needs only the gateway and its token, and stays idle without a provider', () => {
    expect(loadAgentRunnerConfig(base)).toMatchObject({
      gatewayUrl: 'http://api:4000',
      roles: ['radar', 'penulis', 'pemeriksa', 'periset', 'pemantau'],
      intervalSeconds: 1800,
      provider: null,
    });
    // The example file's placeholder key alone switches nothing on.
    expect(
      loadAgentRunnerConfig({ ...base, AI_API_KEY: 'REPLACE_WITH_AI_PROVIDER_KEY' }).provider,
    ).toBeNull();
    // It never needs (or reads) a database URL.
    expect(Object.keys(loadAgentRunnerConfig(base))).not.toContain('databaseUrl');
  });

  it('refuses bad tokens, roles, intervals and providers', () => {
    expect(issues({ ...base, AGENT_TOKEN: 'short' })).toEqual([
      'AGENT_TOKEN must be the token printed by agent:credential create',
    ]);
    expect(issues({ ...base, AGENT_ROLES: 'radar,founder' })[0]).toMatch(/AGENT_ROLES/);
    expect(issues({ ...base, AGENT_INTERVAL_SECONDS: '5' })[0]).toMatch(/at least 60/);
    expect(issues({ ...base, AGENT_GATEWAY_URL: 'http://u:p@api:4000' })[0]).toMatch(/credentials/);
    expect(
      issues({
        ...base,
        AI_BASE_URL: 'http://provider.example/v1',
        AI_API_KEY: 'k',
        AI_MODEL: 'm',
      }),
    ).toEqual(['AI_BASE_URL must be an https URL without credentials']);
    expect(issues({ ...base, AI_BASE_URL: 'https://provider.example/v1' })).toEqual([
      'AI_API_KEY is required with AI_BASE_URL',
      'AI_MODEL is required with AI_BASE_URL (letters, digits, . _ : / -)',
    ]);
    expect(
      issues({
        ...base,
        AI_BASE_URL: 'https://provider.example/v1',
        AI_API_KEY: 'REPLACE_WITH_AI_PROVIDER_KEY',
        AI_MODEL: 'm',
      }),
    ).toEqual(['AI_API_KEY still contains a placeholder value']);
    expect(
      loadAgentRunnerConfig({
        ...base,
        AI_BASE_URL: 'https://provider.example/v1/',
        AI_API_KEY: 'fixture-key',
        AI_MODEL: 'vendor/model-1',
        AGENT_ROLES: 'radar, pemantau',
      }),
    ).toMatchObject({
      roles: ['radar', 'pemantau'],
      provider: { baseUrl: 'https://provider.example/v1', model: 'vendor/model-1' },
    });
  });
});
