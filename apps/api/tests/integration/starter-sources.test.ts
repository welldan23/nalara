// Starter source list: every entry passes the Source Registry's own validation, goes in as a
// candidate with an unchecked feed (nothing is fetched before the founder verifies it), is audited,
// and a second run changes nothing.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { sourceInputSchema } from '../../src/modules/sources/sources.ts';
import { STARTER_SOURCES, seedStarterSources } from '../../src/modules/sources/starter.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  type TestDatabase,
} from '../support/database.ts';

describe('starter sources', () => {
  it('each entry is valid input, with https pages and distinct feeds', () => {
    for (const source of STARTER_SOURCES) {
      expect(sourceInputSchema.safeParse({ ...source, status: 'candidate' }).success).toBe(true);
      expect(source.officialUrl.startsWith('https://')).toBe(true);
      expect(source.licenseStatus).not.toBe('unknown');
    }
    const feeds = STARTER_SOURCES.map((source) => source.feedUrl.toLowerCase());
    expect(new Set(feeds).size).toBe(feeds.length);
    // Media are leads only: never marked open.
    for (const source of STARTER_SOURCES.filter((entry) => entry.type === 'media')) {
      expect(source.licenseStatus).toBe('restricted');
    }
  });
});

describe.skipIf(!databaseAvailable)('starter sources in the registry', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let founderId = '';

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
    database = createDatabase(testDb.appUrl, { max: 2 });
  });

  afterAll(async () => {
    await database.close();
    await migrator.end();
    await testDb.drop();
  });

  it('adds every source as a candidate with an unchecked feed, audited, and is idempotent', async () => {
    const first = await seedStarterSources(database.db, founderId);
    expect(first.added).toHaveLength(STARTER_SOURCES.length);
    expect(first.skipped).toHaveLength(0);

    const rows = await migrator.query<{ status: string; feed_status: string; n: string }>(
      'SELECT status, feed_status, count(*) AS n FROM sources GROUP BY 1, 2',
    );
    expect(rows.rows).toEqual([
      { status: 'candidate', feed_status: 'unchecked', n: String(STARTER_SOURCES.length) },
    ]);
    const audits = await migrator.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit_events WHERE action = 'source.create'`,
    );
    expect(audits.rows[0]?.n).toBe(String(STARTER_SOURCES.length));

    const second = await seedStarterSources(database.db, founderId);
    expect(second.added).toHaveLength(0);
    expect(second.skipped).toHaveLength(STARTER_SOURCES.length);
    const total = await migrator.query<{ n: string }>('SELECT count(*) AS n FROM sources');
    expect(total.rows[0]?.n).toBe(String(STARTER_SOURCES.length));
  });
});
