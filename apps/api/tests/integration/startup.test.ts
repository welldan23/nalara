// P0-004 acceptance: a missing required secret prevents startup with a safe error.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PASSWORD = 'fixture-db-password';

const baseEnv: Record<string, string> = {
  PATH: process.env['PATH'] ?? '',
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: `postgres://nalara_app:${DB_PASSWORD}@localhost:5432/nalara_test`,
  SESSION_SECRET: 'test-session-secret-'.padEnd(40, 'a'),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

function start(env: Record<string, string>) {
  // Clean env: nothing from the developer's shell leaks into the child process.
  return spawnSync(process.execPath, ['src/main.ts'], { cwd: apiRoot, env, encoding: 'utf8' });
}

describe('API startup', () => {
  it('starts with a valid configuration and logs a redacted summary', () => {
    const result = start(baseEnv);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('configuration loaded');
    expect(result.stdout).not.toContain(DB_PASSWORD);
    expect(result.stdout).not.toContain(baseEnv['SESSION_SECRET']);
    expect(result.stdout).not.toContain(baseEnv['MFA_ENCRYPTION_KEY']);
  });

  it('refuses to start when a required secret is missing', () => {
    const env = Object.fromEntries(
      Object.entries(baseEnv).filter(([key]) => key !== 'SESSION_SECRET'),
    );
    const result = start(env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to start');
    expect(result.stderr).toContain('SESSION_SECRET is required');
    expect(`${result.stdout}${result.stderr}`).not.toContain(DB_PASSWORD);
  });
});
