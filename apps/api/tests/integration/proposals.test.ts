// P3-01 proposals and approvals: agents file proposals, only the founder's decision applies them,
// once, against the version they were written for. Proposals and decisions are immutable.
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { AppError } from '../../src/lib/errors.ts';
import { csrfTokenFor } from '../../src/modules/auth/csrf.ts';
import { createSession } from '../../src/modules/auth/session.ts';
import { fileProposal, getAgentPreferences } from '../../src/modules/proposals/proposals.ts';
import type { FileProposal } from '../../src/modules/proposals/proposals.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  sqlState,
  type TestDatabase,
} from '../support/database.ts';

const ORIGIN = 'http://localhost:3000';
const COOKIE = '__Host-nalara_session';
const SECRET = 'test-session-secret-'.padEnd(40, 'a');
const config: AppConfig = {
  logLevel: 'fatal',
  nodeEnv: 'test',
  appOrigin: ORIGIN,
  session: { cookieName: COOKIE, secret: SECRET },
  mfaEncryptionKey: Buffer.alloc(32, 7),
};

const SOURCE = {
  name: 'Berita Resmi Statistik',
  organization: 'Badan Pusat Statistik',
  type: 'statistics',
  officialUrl: 'https://www.bps.go.id/id/pressrelease',
  feedUrl: 'https://www.bps.go.id/rss',
};

describe.skipIf(!databaseAvailable)('proposals', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let token = '';
  let csrf = '';
  let userId = '';

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const user = await migrator.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
       VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
    );
    userId = user.rows[0]?.id ?? '';
    database = createDatabase(testDb.appUrl, { max: 5 });
    const session = await createSession(database.db, userId);
    token = session.token;
    csrf = csrfTokenFor(SECRET, session.sessionId);
    app = await buildApp(config, { readiness: () => Promise.resolve(true), database: database.db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
    await migrator.end();
    await testDb.drop();
  });

  const file = (proposal: Partial<FileProposal>) =>
    fileProposal(database.db, {
      role: 'periset',
      kind: 'sources.propose_create',
      payload: { source: SOURCE },
      reason: 'Rilis resmi inflasi bulanan.',
      ...proposal,
    });
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return 'accepted';
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      return `${error.code}:${error.fields?.map((field) => field.rule).join(',') ?? ''}`;
    }
  };
  const decide = (id: string, decision: string, withCsrf = true) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/os/proposals/${id}/decision`,
      payload: { decision },
      headers: {
        origin: ORIGIN,
        cookie: `${COOKIE}=${token}`,
        ...(withCsrf ? { 'x-csrf-token': csrf } : {}),
      },
    });
  const get = (url: string) =>
    app.inject({ method: 'GET', url, headers: { cookie: `${COOKIE}=${token}` } });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  const sourceRow = async (url: string) =>
    (
      await migrator.query<{ id: string; status: string; name: string; version: number }>(
        'SELECT id, status, name, version FROM sources WHERE official_url = $1',
        [url],
      )
    ).rows[0];

  it('applies an approved source proposal once, always as a candidate, and audits it', async () => {
    const proposal = await file({});
    const listed = parse<{ items: { id: string; status: string }[]; pendingCount: number }>(
      await get('/api/v1/os/proposals'),
    );
    expect(listed.pendingCount).toBe(1);
    expect(listed.items.map((item) => item.id)).toEqual([proposal.id]);
    expect(await sourceRow(SOURCE.officialUrl)).toBeUndefined(); // nothing until approved

    const response = await decide(proposal.id, 'approve');
    expect(response.statusCode, response.body).toBe(200);
    const result = parse<{ status: string; resultId: string }>(response);
    expect(result.status).toBe('approved');
    const created = await sourceRow(SOURCE.officialUrl);
    expect(created).toMatchObject({ id: result.resultId, status: 'candidate' });

    expect((await decide(proposal.id, 'approve')).statusCode).toBe(409);
    expect((await decide(proposal.id, 'reject')).statusCode).toBe(409);
    const detail = parse<{ proposal: { status: string; decision: { channel: string } } }>(
      await get(`/api/v1/os/proposals/${proposal.id}`),
    );
    expect(detail.proposal).toMatchObject({ status: 'approved', decision: { channel: 'os' } });
    const audit = await migrator.query<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action, metadata FROM audit_events
       WHERE action IN ('proposal.decide', 'source.create') ORDER BY created_at, id`,
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({ action: 'source.create' }),
      {
        action: 'proposal.decide',
        metadata: {
          kind: 'sources.propose_create',
          decision: 'approve',
          status: 'approved',
          channel: 'os',
        },
      },
    ]);
  });

  it('refuses malformed proposals when they are filed', async () => {
    expect(await refusal(file({ payload: { source: { ...SOURCE, status: 'verified' } } }))).toBe(
      'VALIDATION_FAILED:unknown_field',
    );
    expect(
      await refusal(file({ payload: { source: { ...SOURCE, officialUrl: 'http://x.example/' } } })),
    ).toMatch(/^VALIDATION_FAILED:/);
    expect(await refusal(file({ payload: { source: SOURCE, extra: 1 } }))).toMatch(
      /^VALIDATION_FAILED:/,
    );
    expect(await refusal(file({ kind: 'articles.publish' as FileProposal['kind'] }))).toMatch(
      /^VALIDATION_FAILED:/,
    );
    expect(await refusal(file({ role: 'founder' as FileProposal['role'] }))).toBe(
      'VALIDATION_FAILED:unknown',
    );
    expect(await refusal(file({ reason: '' }))).toMatch(/^VALIDATION_FAILED:/);
    expect(
      await refusal(
        file({ kind: 'sources.propose_update', payload: { changes: { name: 'Baru' } } }),
      ),
    ).toBe('VALIDATION_FAILED:required');
    expect(
      await refusal(
        file({
          kind: 'sources.propose_update',
          targetId: '01900000-0000-7000-8000-0000000000ff',
          payload: { changes: { name: 'Baru' } },
        }),
      ),
    ).toBe('VALIDATION_FAILED:not_found');
    expect(
      await refusal(
        file({ kind: 'inbox.propose_flag', payload: { topic: 'Ekonomi', relevance: 'urgent' } }),
      ),
    ).toMatch(/^VALIDATION_FAILED:/);
  });

  it('fails instead of overwriting when the target changed, and keeps the founder status', async () => {
    const url = 'https://www.bi.go.id/id/publikasi';
    await migrator.query(
      `INSERT INTO sources (name, organization, type, official_url, license_status, status, created_by)
       VALUES ('Siaran Pers BI', 'Bank Indonesia', 'central_bank', $1, 'open', 'verified', $2)`,
      [url, userId],
    );
    const source = await sourceRow(url);
    const stale = await file({
      kind: 'sources.propose_update',
      targetId: source?.id ?? '',
      payload: { changes: { name: 'Nama dari agent' } },
    });
    await migrator.query(`UPDATE sources SET version = version + 1, notes = 'x' WHERE id = $1`, [
      source?.id,
    ]);
    expect(parse<{ status: string; failure: string }>(await decide(stale.id, 'approve'))).toEqual(
      expect.objectContaining({ status: 'failed', failure: 'target:changed' }),
    );
    expect((await sourceRow(url))?.name).toBe('Siaran Pers BI');

    const fresh = await file({
      kind: 'sources.propose_update',
      targetId: source?.id ?? '',
      payload: { changes: { name: 'Siaran Pers Bank Indonesia' } },
    });
    expect(parse<{ status: string }>(await decide(fresh.id, 'approve')).status).toBe('approved');
    expect(await sourceRow(url)).toMatchObject({
      name: 'Siaran Pers Bank Indonesia',
      status: 'verified',
    });
  });

  it('rejects without applying, and updates preferences only from their current version', async () => {
    const rejected = await file({
      kind: 'preferences.propose_update',
      role: 'radar',
      payload: { topics: ['Energi'] },
    });
    expect(parse<{ status: string }>(await decide(rejected.id, 'reject')).status).toBe('rejected');
    expect((await getAgentPreferences(database.db)).topics).toEqual([
      'Ekonomi',
      'Teknologi',
      'Kebijakan',
    ]);

    const first = await file({
      kind: 'preferences.propose_update',
      role: 'radar',
      payload: { topics: ['Ekonomi', 'Energi'] },
    });
    const second = await file({
      kind: 'preferences.propose_update',
      role: 'radar',
      payload: { notes: 'Fokus data resmi.' },
    });
    expect(parse<{ status: string }>(await decide(first.id, 'approve')).status).toBe('approved');
    expect(parse<{ failure: string }>(await decide(second.id, 'approve')).failure).toBe(
      'target:changed',
    );
    expect(await getAgentPreferences(database.db)).toMatchObject({
      topics: ['Ekonomi', 'Energi'],
      notes: '',
      version: 2,
    });
  });

  it('expires old proposals and refuses to decide them', async () => {
    const old = await migrator.query<{ id: string }>(
      `INSERT INTO ai_action_proposals (kind, agent_role, payload, reason, created_at, expires_at)
       VALUES ('preferences.propose_update', 'radar', '{"notes":"x"}', 'lama',
               now() - interval '8 days', now() - interval '1 day') RETURNING id`,
    );
    const id = old.rows[0]?.id ?? '';
    const expired = parse<{ items: { id: string; status: string }[] }>(
      await get('/api/v1/os/proposals?status=expired'),
    );
    expect(expired.items).toEqual([expect.objectContaining({ id, status: 'expired' })]);
    expect(
      parse<{ items: { id: string }[] }>(await get('/api/v1/os/proposals')).items.map(
        (item) => item.id,
      ),
    ).not.toContain(id);
    expect((await decide(id, 'approve')).statusCode).toBe(409);
    const row = await migrator.query<{ status: string }>(
      'SELECT status FROM ai_action_proposals WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.status).toBe('expired');
    const approvalsFor = await migrator.query('SELECT 1 FROM approvals WHERE proposal_id = $1', [
      id,
    ]);
    expect(approvalsFor.rowCount).toBe(0);
  });

  it('keeps proposals and decisions immutable', async () => {
    const proposal = await file({
      payload: { source: { ...SOURCE, officialUrl: 'https://a.example/' } },
    });
    const app = await connect(testDb.appUrl);
    try {
      expect(
        await sqlState(
          app.query(`UPDATE ai_action_proposals SET payload = '{}' WHERE id = $1`, [proposal.id]),
        ),
      ).toBe('42501');
      expect(
        await sqlState(app.query('DELETE FROM ai_action_proposals WHERE id = $1', [proposal.id])),
      ).toBe('42501');
      await decide(proposal.id, 'reject');
      expect(
        await sqlState(
          app.query(`UPDATE ai_action_proposals SET status = 'approved' WHERE id = $1`, [
            proposal.id,
          ]),
        ),
      ).toBe('42501');
      expect(await sqlState(app.query(`UPDATE approvals SET decision = 'approve'`))).toBe('42501');
    } finally {
      await app.end();
    }
  });

  it('needs a founder session and CSRF', async () => {
    const proposal = await file({
      payload: { source: { ...SOURCE, officialUrl: 'https://b.example/' } },
    });
    expect((await app.inject({ method: 'GET', url: '/api/v1/os/proposals' })).statusCode).toBe(401);
    expect((await decide(proposal.id, 'approve', false)).statusCode).toBe(403);
    expect((await decide('not-a-uuid', 'approve')).statusCode).toBe(404);
    expect((await decide(proposal.id, 'maybe')).statusCode).toBe(400);
  });
});
