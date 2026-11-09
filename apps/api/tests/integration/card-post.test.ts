// Kartu IG to Telegram (P5-04b, "Opsi A"): publishing from the OS queues the article's cards; the
// worker sends them as one album, then the caption alone (easy to copy), once. A failed caption is
// retried without sending the album twice. Without a bot, nothing is queued. Fake api.telegram.org
// over local HTTPS; TEST data only.
import { createServer } from 'node:https';
import type { Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { createDraft } from '../../src/modules/articles/articles.ts';
import { parseMarkdown } from '../../src/modules/articles/markdown.ts';
import { transition } from '../../src/modules/articles/workflow.ts';
import { csrfTokenFor } from '../../src/modules/auth/csrf.ts';
import { createSession } from '../../src/modules/auth/session.ts';
import { notifyCardPosts } from '../../src/modules/cards/telegram-post.ts';
import { onlyAddresses } from '../../src/modules/fetch/address-policy.ts';
import type { BotOptions } from '../../src/modules/telegram/bot.ts';
import { testCertificate } from '../support/tls.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
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
const CHAT = 444_555_666;
const CITE = '01900000-0000-7000-8000-00000000000a';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Received {
  readonly method: string;
  readonly contentType: string;
  readonly raw: Buffer;
}

function countOf(haystack: Buffer, needle: Buffer): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

describe.skipIf(!databaseAvailable)('Kartu IG to Telegram', { timeout: 120_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let workerDb: Database;
  let migrator: pg.Client;
  let withBot: FastifyInstance;
  let withoutBot: FastifyInstance;
  let telegram: Server;
  let bot: BotOptions;
  let founderId = '';
  let categoryId = '';
  let token = '';
  let csrf = '';
  const received: Received[] = [];
  /** Methods the fake answers with an error, once each. */
  const failNext = new Set<string>();
  const tls = testCertificate(['api.telegram.test']);

  // A draft taken to "approved"; the publish itself goes over HTTP.
  const approved = async (title: string) => {
    const bodySource = [
      ':::angka',
      'nilai: 2,8',
      'satuan: persen',
      'periode: Oktober 2026',
      'label: Inflasi TEST',
      'sumber: 1',
      ':::',
      '',
      '## Konteks',
      '',
      `Isi ${title}. TEST fixture.`,
    ].join('\n');
    const saved = await createDraft(
      database.db,
      { userId: founderId },
      {
        content: {
          title,
          dek: `Ringkasan ${title}`,
          articleType: 'explainer',
          categoryId,
          body: parseMarkdown(bodySource, { citationIds: [CITE] }).blocks,
          bodySource,
          methodNote: null,
          citations: [
            {
              id: CITE,
              url: 'https://www.bps.go.id/id/pressrelease/x.html',
              publisher: 'Badan Pusat Statistik',
              title: 'Rilis TEST',
              accessedAt: '2026-11-03',
              claimNote: 'CATATAN-INTERNAL',
              primary: true,
              verified: true,
            },
          ],
        },
      },
    );
    for (const step of ['submit', 'approve'] as const) {
      await transition(database.db, { userId: founderId }, saved.articleId, step, {
        expectedVersion: 1,
      });
    }
    return saved.articleId;
  };
  const publish = (app: FastifyInstance, articleId: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/os/articles/${articleId}/publish`,
      payload: { expectedVersion: 1 },
      headers: { origin: ORIGIN, cookie: `${COOKIE}=${token}`, 'x-csrf-token': csrf },
    });
  const outbox = async (articleId: string) =>
    (
      await migrator.query<{
        caption: string;
        slides: number;
        album_sent_at: Date | null;
        sent_at: Date | null;
        attempts: number;
        last_error: string | null;
      }>(
        `SELECT caption, cardinality(slides) AS slides, album_sent_at, sent_at, attempts, last_error
         FROM card_outbox WHERE article_id = $1`,
        [articleId],
      )
    ).rows;
  // Rendering runs after the answer; wait for it.
  const queued = async (articleId: string) => {
    for (let tries = 0; tries < 120; tries += 1) {
      const rows = await outbox(articleId);
      if (rows.length > 0) return rows;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return [];
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    founderId =
      (
        await migrator.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
           VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
        )
      ).rows[0]?.id ?? '';
    categoryId =
      (await migrator.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'ekonomi'`))
        .rows[0]?.id ?? '';
    database = createDatabase(testDb.appUrl, { max: 5 });
    workerDb = createDatabase(testDb.workerUrl, { max: 2 });
    const session = await createSession(database.db, founderId);
    token = session.token;
    csrf = csrfTokenFor(SECRET, session.sessionId);
    const deps = { readiness: () => Promise.resolve(true), database: database.db };
    withBot = await buildApp(config, {
      ...deps,
      telegram: {
        secret: 'fixture-webhook-secret-'.padEnd(40, 'x'),
        founderUserId: 1,
        chatId: CHAT,
      },
    });
    withoutBot = await buildApp(config, deps);
    await withBot.ready();
    await withoutBot.ready();

    telegram = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const method = (req.url ?? '').split('/').at(-1) ?? '';
        received.push({
          method,
          contentType: req.headers['content-type'] ?? '',
          raw: Buffer.concat(chunks),
        });
        if (failNext.delete(method)) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, description: 'TEST failure' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { message_id: received.length } }));
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
    await withBot.close();
    await withoutBot.close();
    await workerDb.close();
    await database.close();
    await migrator.end();
    await testDb.drop();
  });

  it('queues the cards and the caption when an article is published from the OS', async () => {
    const articleId = await approved('Inflasi turun TEST');
    expect((await publish(withBot, articleId)).statusCode).toBe(200);
    const rows = await queued(articleId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slides).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.sent_at).toBeNull();
    expect(rows[0]?.caption).toContain('Inflasi turun TEST');
    // Editor notes never reach a caption.
    expect(rows[0]?.caption).not.toContain('CATATAN-INTERNAL');
  });

  it('sends one album of PNGs, then the caption alone in plain text, exactly once', async () => {
    const before = received.length;
    expect(await notifyCardPosts(workerDb.db, bot)).toEqual({ sent: 1, failed: null });
    const [album, caption] = received.slice(before);
    expect(album?.method).toBe('sendMediaGroup');
    expect(album?.contentType).toMatch(/^multipart\/form-data; boundary=nalara-[0-9a-f]{32}$/);
    const raw = album?.raw ?? Buffer.alloc(0);
    const slideCount = countOf(raw, PNG_MAGIC);
    expect(slideCount).toBeGreaterThanOrEqual(2);
    const text = raw.toString('latin1');
    expect(text).toContain('attach://card1');
    expect(text).toContain('Kartu IG siap posting');
    expect(text).toContain(`name="chat_id"\r\n\r\n${String(CHAT)}\r\n`);

    expect(caption?.method).toBe('sendMessage');
    const body = JSON.parse(caption?.raw.toString('utf8') ?? '{}') as Record<string, unknown>;
    expect(body['chat_id']).toBe(CHAT);
    expect(body['parse_mode']).toBeUndefined();
    expect(body['text']).toContain('Inflasi turun TEST');

    const rows = await migrator.query<{ slides: number; sent: boolean }>(
      'SELECT cardinality(slides) AS slides, sent_at IS NOT NULL AS sent FROM card_outbox',
    );
    // Delivered images are not kept.
    expect(rows.rows).toEqual([{ slides: 0, sent: true }]);
    expect(await notifyCardPosts(workerDb.db, bot)).toEqual({ sent: 0, failed: null });
    expect(received.length).toBe(before + 2);
  });

  it('retries a failed caption without sending the album again', async () => {
    const articleId = await approved('Rupiah menguat TEST');
    expect((await publish(withBot, articleId)).statusCode).toBe(200);
    await queued(articleId);
    failNext.add('sendMessage');
    const before = received.length;
    expect(await notifyCardPosts(workerDb.db, bot)).toEqual({ sent: 0, failed: 'http_500' });
    expect((await outbox(articleId))[0]).toMatchObject({ attempts: 1, last_error: 'http_500' });
    expect((await outbox(articleId))[0]?.album_sent_at).not.toBeNull();

    expect(await notifyCardPosts(workerDb.db, bot)).toEqual({ sent: 1, failed: null });
    expect(received.slice(before).map((request) => request.method)).toEqual([
      'sendMediaGroup',
      'sendMessage',
      'sendMessage',
    ]);
  });

  it('queues nothing when the bot is not set up', async () => {
    const articleId = await approved('Tanpa bot TEST');
    expect((await publish(withoutBot, articleId)).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await outbox(articleId)).toEqual([]);
  });

  it('keeps article links and ids out of the worker’s reach', async () => {
    const worker = await connect(testDb.workerUrl);
    try {
      await expect(worker.query('SELECT article_id FROM card_outbox')).rejects.toThrow(
        /permission denied/,
      );
      await expect(worker.query('DELETE FROM card_outbox')).rejects.toThrow(/permission denied/);
      await expect(worker.query('UPDATE card_outbox SET caption = $1', ['x'])).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await worker.end();
    }
  });
});
