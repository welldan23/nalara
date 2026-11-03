// The emergency SQL in docs/runbooks/incident.md, executed exactly as written (P0-016, TEST-OPS-10).
// The SQL is read from the Markdown file, so the runbook cannot drift from the schema unnoticed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { hashPassword } from '../../src/modules/auth/password.ts';
import { createSession } from '../../src/modules/auth/session.ts';
import {
  adminUrl,
  connect,
  createTestDatabase,
  databaseAvailable,
  type TestDatabase,
} from '../support/database.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const runbook = readFileSync(join(root, 'docs', 'runbooks', 'incident.md'), 'utf8');

/** The heredoc of the break-glass section (§4). */
function breakGlassSql(): string {
  const section = runbook.split(/^## /m).find((part) => part.startsWith('4.'));
  const sql = /<<'SQL'\n([\s\S]*?)\nSQL\n/.exec(section ?? '')?.[1];
  if (sql === undefined) throw new Error('break-glass SQL block not found in incident.md §4');
  return sql;
}

/** The "revoke every session" statement of §1. */
function revokeAllSql(): string {
  const section = runbook.split(/^## /m).find((part) => part.startsWith('1.'));
  const sql = /"(UPDATE sessions SET revoked_at = now\(\) WHERE revoked_at IS NULL)"/.exec(
    section ?? '',
  )?.[1];
  if (sql === undefined) throw new Error('session revocation SQL not found in incident.md §1');
  return sql;
}

const ORIGIN = 'http://localhost:3000';
const EMAIL = 'founder@example.invalid';
const PASSWORD = 'runbook integration passphrase 2026';
const SESSION = '__Host-nalara_session';
const config: AppConfig = {
  logLevel: 'fatal',
  nodeEnv: 'test',
  appOrigin: ORIGIN,
  session: { cookieName: SESSION, secret: 'test-session-secret-'.padEnd(40, 'a') },
  mfaEncryptionKey: Buffer.alloc(32, 7),
};

describe.skipIf(!databaseAvailable)('incident runbook SQL', { timeout: 120_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let superuser: pg.Client;
  let app: FastifyInstance;
  let founderId = '';

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    await migrator.end();
    // The runbook runs as the postgres superuser (`psql -U postgres -d nalara`).
    const url = new URL(adminUrl ?? '');
    url.pathname = `/${testDb.name}`;
    superuser = await connect(url.toString());
    // A founder with MFA enabled and unused recovery codes, i.e. the state before the incident.
    const inserted = await superuser.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc, totp_last_step)
       VALUES ($1, $2, 'founder', true, $3, 1) RETURNING id`,
      [EMAIL, await hashPassword(PASSWORD), Buffer.alloc(48, 1)],
    );
    founderId = inserted.rows[0]?.id ?? '';
    await superuser.query(
      `INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2), ($1, $3)`,
      [founderId, Buffer.alloc(32, 2), Buffer.alloc(32, 3)],
    );
    database = createDatabase(testDb.appUrl, { max: 5 });
    app = await buildApp(config, {
      readiness: () => Promise.resolve(true),
      database: database.db,
      loginRateLimitMax: 1_000,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
    await superuser.end();
    await testDb.drop();
  });

  const ping = (token: string) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/os/ping',
      headers: { cookie: `${SESSION}=${token}` },
    });
  const loginNext = async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: EMAIL, password: PASSWORD },
      headers: { origin: ORIGIN },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ next: string }>().next;
  };

  it('§1 "revoke every session" logs out a live session', async () => {
    const { token } = await createSession(database.db, founderId);
    expect((await ping(token)).statusCode).toBe(200);
    await superuser.query(revokeAllSql());
    expect((await ping(token)).statusCode).toBe(401);
  });

  it('§4 break-glass resets MFA, removes recovery codes, revokes sessions and is audited', async () => {
    expect(await loginNext()).toBe('mfa');
    const { token } = await createSession(database.db, founderId);
    expect((await ping(token)).statusCode).toBe(200);

    await superuser.query(breakGlassSql());

    const user = await superuser.query<{
      mfa_enabled: boolean;
      totp_secret_enc: Buffer | null;
      totp_last_step: string | null;
    }>('SELECT mfa_enabled, totp_secret_enc, totp_last_step FROM users');
    expect(user.rows).toEqual([
      { mfa_enabled: false, totp_secret_enc: null, totp_last_step: null },
    ]);
    const codes = await superuser.query('SELECT 1 FROM recovery_codes');
    expect(codes.rowCount).toBe(0);
    expect((await ping(token)).statusCode).toBe(401);
    const audit = await superuser.query<{ actor_type: string; result: string }>(
      `SELECT actor_type, result FROM audit_events WHERE action = 'mfa.break_glass_reset'`,
    );
    expect(audit.rows).toEqual([{ actor_type: 'system', result: 'success' }]);

    // The next password login must go through a fresh MFA enrolment, never straight in.
    expect(await loginNext()).toBe('mfa_enrolment');
  });
});
