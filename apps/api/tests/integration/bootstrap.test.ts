// P0-007 founder bootstrap CLI against a real database (TEST-AUTH-10 "bootstrap once").
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  type TestDatabase,
} from '../support/database.ts';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PASSWORD = 'bootstrap test passphrase 2026';

interface Run {
  readonly code: number | null;
  readonly output: string;
}

function runBootstrap(
  env: Record<string, string>,
  stdinText: string,
  args: string[] = [],
): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/cli/bootstrap-founder.ts', ...args], {
      cwd: apiRoot,
      env: { PATH: process.env['PATH'] ?? '', ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.on('exit', (code) => {
      resolve({ code, output });
    });
    child.stdin.end(stdinText);
  });
}

describe.skipIf(!databaseAvailable)('founder bootstrap CLI', { timeout: 60_000 }, () => {
  let database: TestDatabase;
  let admin: pg.Client;
  let env: Record<string, string>;

  beforeAll(async () => {
    database = await createTestDatabase();
    const migrator = await connect(database.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    await migrator.end();
    admin = await connect(database.migratorUrl);
    env = {
      NODE_ENV: 'test',
      DATABASE_URL: database.appUrl,
      FOUNDER_EMAIL: 'Founder@Example.invalid',
    };
  });

  afterAll(async () => {
    await admin.end();
    await database.drop();
  });

  const counts = async () => {
    const users = await admin.query<{ n: string }>('SELECT count(*)::text AS n FROM users');
    const audit = await admin.query<{ n: string }>('SELECT count(*)::text AS n FROM audit_events');
    return { users: users.rows[0]?.n, audit: audit.rows[0]?.n };
  };

  it('rejects a weak password without creating anything', async () => {
    const run = await runBootstrap(env, 'short\n');
    expect(run.code).toBe(1);
    expect(run.output).toContain('password must be at least 12 characters');
    expect(run.output).not.toContain('short\n');
    expect(await counts()).toEqual({ users: '0', audit: '0' });
  });

  it('refuses production unless --production is passed', async () => {
    const run = await runBootstrap({ ...env, NODE_ENV: 'production' }, `${PASSWORD}\n`);
    expect(run.code).toBe(2);
    expect(run.output).toContain('--production');
    expect(await counts()).toEqual({ users: '0', audit: '0' });
  });

  it('never accepts the password as an argument', async () => {
    const run = await runBootstrap(env, '', [PASSWORD]);
    expect(run.code).toBe(1);
    expect(run.output).not.toContain(PASSWORD);
  });

  it('creates exactly one founder with an Argon2id hash and an audit event', async () => {
    const run = await runBootstrap(env, `${PASSWORD}\n`);
    expect(run.code, run.output).toBe(0);
    expect(run.output).toContain('founder created');
    expect(run.output).not.toContain(PASSWORD);

    const user = await admin.query<{
      email: string;
      role: string;
      password_hash: string;
      mfa_enabled: boolean;
    }>('SELECT email, role, password_hash, mfa_enabled FROM users');
    expect(user.rows).toHaveLength(1);
    expect(user.rows[0]).toMatchObject({
      email: 'founder@example.invalid',
      role: 'founder',
      mfa_enabled: false,
    });
    expect(user.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(user.rows[0]?.password_hash).not.toContain(PASSWORD);

    const audit = await admin.query<{
      action: string;
      actor_type: string;
      result: string;
      metadata: unknown;
    }>('SELECT action, actor_type, result, metadata FROM audit_events');
    expect(audit.rows).toEqual([
      { action: 'founder.bootstrap', actor_type: 'system', result: 'success', metadata: {} },
    ]);
  });

  it('TEST-AUTH-10 refuses a second bootstrap and changes nothing', async () => {
    const before = await admin.query<{ password_hash: string }>('SELECT password_hash FROM users');
    const run = await runBootstrap(
      { ...env, FOUNDER_EMAIL: 'someone-else@example.invalid' },
      'another strong passphrase 2026\n',
    );
    expect(run.code).toBe(2);
    expect(run.output).toContain('already exists');
    expect(await counts()).toEqual({ users: '1', audit: '1' });
    const after = await admin.query<{ password_hash: string }>('SELECT password_hash FROM users');
    expect(after.rows).toEqual(before.rows);
  });

  it('has no HTTP bootstrap or signup endpoint', async () => {
    const app = await buildApp(
      {
        logLevel: 'fatal',
        nodeEnv: 'test',
        appOrigin: 'http://localhost:3000',
        session: { cookieName: '__Host-nalara_session', secret: 'x'.repeat(40) },
        mfaEncryptionKey: Buffer.alloc(32, 7),
      },
      { readiness: () => Promise.resolve(true) },
    );
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).not.toMatch(/bootstrap|signup|register|founder/i);
    for (const url of ['/api/v1/auth/bootstrap', '/api/v1/founder', '/api/v1/auth/register']) {
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(404);
    }
    await app.close();
  });
});
