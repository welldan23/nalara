// P0-004/P0-006 acceptance: the real process refuses bad config, serves health, and shuts down
// cleanly on SIGTERM. The database is not needed for liveness.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB_PASSWORD = 'fixture-db-password';
const port = String(40_000 + Math.floor(Math.random() * 10_000));

const baseEnv: Record<string, string> = {
  PATH: process.env['PATH'] ?? '',
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:3000',
  // Port 9 (discard) on loopback: nothing listens, so the pool can never connect.
  DATABASE_URL: `postgres://nalara_app:${DB_PASSWORD}@127.0.0.1:9/nalara_test`,
  SESSION_SECRET: 'test-session-secret-'.padEnd(40, 'a'),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PORT: port,
};

describe('API process', { timeout: 20_000 }, () => {
  it('refuses to start when a required secret is missing', () => {
    const env = Object.fromEntries(
      Object.entries(baseEnv).filter(([key]) => key !== 'SESSION_SECRET'),
    );
    const result = spawnSync(process.execPath, ['src/main.ts'], {
      cwd: apiRoot,
      env,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to start');
    expect(result.stderr).toContain('SESSION_SECRET is required');
    expect(`${result.stdout}${result.stderr}`).not.toContain(DB_PASSWORD);
  });

  it('serves liveness, reports not-ready without a database, and stops on SIGTERM', async () => {
    const child = spawn(process.execPath, ['src/main.ts'], { cwd: apiRoot, env: baseEnv });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));

    const deadline = Date.now() + 10_000;
    while (!output.includes('Server listening') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(output).toContain('Server listening');

    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect(live.status).toBe(200);
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(ready.status).toBe(503);

    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(output).toContain('shutting down');
    for (const secret of [DB_PASSWORD, baseEnv['SESSION_SECRET'], baseEnv['MFA_ENCRYPTION_KEY']]) {
      expect(output).not.toContain(secret);
    }
  });
});
