// P3-04 founder Telegram bot: the worker sends one message per proposal with single-use buttons
// (fake api.telegram.org over local HTTPS); the API webhook accepts only the founder, in the
// founder's chat, with the webhook secret, and each token once (PRD v4 §11: replay, expired and
// foreign users are refused). `/stop` is the kill switch.
import { createServer } from 'node:https';
import type { Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { onlyAddresses } from '../../src/modules/fetch/address-policy.ts';
import { fileProposal } from '../../src/modules/proposals/proposals.ts';
import { notifyPendingProposals } from '../../src/modules/telegram/bot.ts';
import type { BotOptions } from '../../src/modules/telegram/bot.ts';
import { issueTokens } from '../../src/modules/telegram/tokens.ts';
import { testCertificate } from '../support/tls.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  sqlState,
  type TestDatabase,
} from '../support/database.ts';

const config: AppConfig = {
  logLevel: 'fatal',
  nodeEnv: 'test',
  appOrigin: 'http://localhost:3000',
  session: { cookieName: '__Host-nalara_session', secret: 'test-session-secret-'.padEnd(40, 'a') },
  mfaEncryptionKey: Buffer.alloc(32, 7),
};
const WEBHOOK_SECRET = 'fixture-webhook-secret-'.padEnd(40, 'x');
const FOUNDER = 111_222_333;
const CHAT = 444_555_666;
const STRANGER = 999_888_777;

interface Sent {
  readonly method: string;
  readonly body: {
    chat_id: number;
    text: string;
    parse_mode?: string;
    reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] };
  };
}

describe.skipIf(!databaseAvailable)('telegram bot', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let workerDb: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let telegram: Server;
  let bot: BotOptions;
  let failNext = false;
  const sent: Sent[] = [];
  const tls = testCertificate(['api.telegram.test']);

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    await migrator.query(
      `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
       VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00')`,
    );
    database = createDatabase(testDb.appUrl, { max: 5 });
    workerDb = createDatabase(testDb.workerUrl, { max: 2 });
    app = await buildApp(config, {
      readiness: () => Promise.resolve(true),
      database: database.db,
      telegram: { secret: WEBHOOK_SECRET, founderUserId: FOUNDER, chatId: CHAT },
    });
    await app.ready();
    telegram = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => (raw += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (failNext) {
          failNext = false;
          res.end(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }));
          return;
        }
        sent.push({
          method: (req.url ?? '').split('/').at(-1) ?? '',
          body: JSON.parse(raw) as Sent['body'],
        });
        res.end(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
      });
    });
    await new Promise<void>((resolve) => telegram.listen(0, '127.0.0.1', resolve));
    const port = (telegram.address() as AddressInfo).port;
    bot = {
      botToken: '12345678:fixture-bot-token-not-real-aaaaaaaaaa',
      chatId: CHAT,
      apiBase: `https://api.telegram.test:${String(port)}`,
      fetchOptions: {
        policy: onlyAddresses(['127.0.0.1']),
        resolve: (host: string) =>
          host === 'api.telegram.test'
            ? Promise.resolve([{ address: '127.0.0.1', family: 4 as const }])
            : Promise.reject(new Error('NXDOMAIN')),
        ports: { 'http:': [80], 'https:': [port] },
        ca: tls.cert,
      },
    };
  });

  afterAll(async () => {
    telegram.closeAllConnections();
    await new Promise((resolve) => telegram.close(resolve));
    await app.close();
    await workerDb.close();
    await database.close();
    await migrator.end();
    await testDb.drop();
  });

  const propose = (topic: string) =>
    fileProposal(database.db, {
      role: 'radar',
      kind: 'preferences.propose_update',
      payload: { topics: [topic] },
      reason: `Tambah topik ${topic} <b>tebal</b> [tautan](https://evil.example/)`,
    });
  const webhook = (update: unknown, secret: string | null = WEBHOOK_SECRET) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/telegram/webhook',
      payload: update as Record<string, unknown>,
      headers: secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
    });
  const tap = (data: string, from = FOUNDER, chat = CHAT) =>
    webhook({
      update_id: 1,
      callback_query: { id: 'cb-1', from: { id: from }, message: { chat: { id: chat } }, data },
    });
  const say = (text: string, from = FOUNDER, chat = CHAT) =>
    webhook({ update_id: 2, message: { from: { id: from }, chat: { id: chat }, text } });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  const status = async (id: string) =>
    (
      await migrator.query<{ status: string }>(
        'SELECT status FROM ai_action_proposals WHERE id = $1',
        [id],
      )
    ).rows[0]?.status;
  const buttons = (message: Sent | undefined) =>
    message?.body.reply_markup?.inline_keyboard[0]?.map((button) => button.callback_data) ?? [];

  it('sends one plain-text message per pending proposal, and retries only what failed', async () => {
    const first = await propose('Energi');
    const second = await propose('Pangan');
    failNext = true;
    expect(await notifyPendingProposals(workerDb.db, bot)).toEqual({
      sent: 0,
      failed: 'http_200',
    });
    expect(
      (await migrator.query('SELECT 1 FROM approval_tokens WHERE proposal_id = $1', [first.id]))
        .rowCount,
    ).toBe(0);
    expect(await notifyPendingProposals(workerDb.db, bot)).toEqual({ sent: 2, failed: null });
    expect(await notifyPendingProposals(workerDb.db, bot)).toEqual({ sent: 0, failed: null });
    const [message] = sent;
    expect(message?.method).toBe('sendMessage');
    expect(message?.body.chat_id).toBe(CHAT);
    expect(message?.body.parse_mode).toBeUndefined();
    expect(message?.body.text).toContain('Ubah preferensi agent');
    expect(message?.body.text).toContain('<b>tebal</b> [tautan](https://evil.example/)');
    const [approve, reject] = buttons(message);
    expect(approve).toMatch(/^a:[A-Za-z0-9_-]{22}$/);
    expect(reject).toMatch(/^r:[A-Za-z0-9_-]{22}$/);
    expect(second.id).not.toBe(first.id);
  });

  it('refuses updates without the webhook secret', async () => {
    expect((await webhook({ update_id: 1 }, null)).statusCode).toBe(401);
    expect((await webhook({ update_id: 1 }, 'wrong-secret')).statusCode).toBe(401);
    expect((await webhook({ update_id: 1 }, `${WEBHOOK_SECRET}x`)).statusCode).toBe(401);
  });

  it('decides a proposal once for the founder, and refuses replays and strangers', async () => {
    const [approve, reject] = buttons(sent[0]);
    const proposalId =
      (
        await migrator.query<{ id: string }>(
          `SELECT id FROM ai_action_proposals WHERE payload->'topics' ? 'Energi'`,
        )
      ).rows[0]?.id ?? '';
    // Someone else, or the founder in another chat: no answer, nothing changes, token unspent.
    expect(parse<object>(await tap(approve ?? '', STRANGER))).toEqual({});
    expect(parse<object>(await tap(approve ?? '', FOUNDER, STRANGER))).toEqual({});
    expect(await status(proposalId)).toBe('pending');
    // A token used with the other button's prefix is refused.
    expect(parse<{ text: string }>(await tap(`r:${(approve ?? '').slice(2)}`)).text).toMatch(
      /tidak berlaku/,
    );

    const answer = parse<{ method: string; text: string }>(await tap(approve ?? ''));
    expect(answer).toMatchObject({
      method: 'answerCallbackQuery',
      text: 'Disetujui dan diterapkan.',
    });
    expect(await status(proposalId)).toBe('approved');
    const decision = await migrator.query<{ channel: string }>(
      'SELECT channel FROM approvals WHERE proposal_id = $1',
      [proposalId],
    );
    expect(decision.rows).toEqual([{ channel: 'telegram' }]);

    // Replay of the same button, and the sibling button: both dead.
    expect(parse<{ text: string }>(await tap(approve ?? '')).text).toMatch(/tidak berlaku/);
    expect(parse<{ text: string }>(await tap(reject ?? '')).text).toMatch(/tidak berlaku/);
    expect(parse<{ text: string }>(await tap('a:not-a-token')).text).toMatch(/tidak berlaku/);
  });

  it('refuses expired buttons, and buttons for proposals already decided in the OS', async () => {
    const proposal = await propose('Transportasi');
    const tokens = await issueTokens(workerDb.db, proposal.id, new Date(Date.now() + 1_000));
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(parse<{ text: string }>(await tap(`a:${tokens.approve}`)).text).toMatch(/tidak berlaku/);
    expect(await status(proposal.id)).toBe('pending');

    // Rejected through the OS first: the Telegram button then reports it as decided.
    const [, rejectSecond] = buttons(sent[1]);
    const secondId =
      (
        await migrator.query<{ id: string }>(
          `SELECT id FROM ai_action_proposals WHERE payload->'topics' ? 'Pangan'`,
        )
      ).rows[0]?.id ?? '';
    await migrator.query(
      `INSERT INTO approvals (proposal_id, decision, channel, decided_by)
       SELECT $1, 'reject', 'os', id FROM users LIMIT 1`,
      [secondId],
    );
    await migrator.query(
      `UPDATE ai_action_proposals SET status = 'rejected', decided_at = now() WHERE id = $1`,
      [secondId],
    );
    expect(parse<{ text: string }>(await tap(rejectSecond ?? '')).text).toMatch(/sudah diputuskan/);
  });

  it('/stop is the kill switch for the founder only; /status reports', async () => {
    await migrator.query('UPDATE system_settings SET ai_enabled = true');
    expect(parse<object>(await say('/stop', STRANGER))).toEqual({});
    expect(
      (await migrator.query<{ ai: boolean }>('SELECT ai_enabled AS ai FROM system_settings'))
        .rows[0]?.ai,
    ).toBe(true);
    const stopped = parse<{ method: string; text: string }>(await say('/stop'));
    expect(stopped.method).toBe('sendMessage');
    expect(stopped.text).toMatch(/AI dimatikan/);
    expect(
      (await migrator.query<{ ai: boolean }>('SELECT ai_enabled AS ai FROM system_settings'))
        .rows[0]?.ai,
    ).toBe(false);
    expect(parse<{ text: string }>(await say('/status@nalara_bot')).text).toMatch(/^AI mati\./);
    const audit = await migrator.query<{ outcome: string; result: string }>(
      `SELECT metadata->>'outcome' AS outcome, result FROM audit_events
       WHERE action = 'telegram.update' ORDER BY created_at, id`,
    );
    expect(audit.rows).toContainEqual({ outcome: 'foreign_user', result: 'denied' });
    expect(audit.rows).toContainEqual({ outcome: 'stop', result: 'success' });
  });

  it('keeps tokens single-use in the database and out of the worker’s hands', async () => {
    const worker = await connect(testDb.workerUrl);
    const appRole = await connect(testDb.appUrl);
    try {
      expect(await sqlState(worker.query('UPDATE approval_tokens SET consumed_at = now()'))).toBe(
        '42501',
      );
      expect(await sqlState(worker.query('SELECT token_hash FROM approval_tokens'))).toBe('42501');
      expect(await sqlState(worker.query('SELECT payload FROM ai_action_proposals'))).toBe('42501');
      expect(
        await sqlState(
          appRole.query(
            `UPDATE approval_tokens SET consumed_at = NULL WHERE consumed_at IS NOT NULL`,
          ),
        ),
      ).toBe('42501');
      expect(await sqlState(appRole.query('DELETE FROM approval_tokens'))).toBe('42501');
    } finally {
      await worker.end();
      await appRole.end();
    }
  });
});
