// Proposal queue (P5-02): radar stories handed to the Penulis agent within quotas; drafts cite
// only the story's numbered materials and need enough independent support. TEST data only.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { AppError } from '../../src/lib/errors.ts';
import {
  MAX_PER_HOUR,
  nextStory,
  skipStory,
  submitDraft,
} from '../../src/modules/stories/queue.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  type TestDatabase,
} from '../support/database.ts';

// 12:00 WIB, outside the quiet hours.
const NOON = new Date('2026-11-06T05:00:00Z');
const CONTEXT = { requestId: 'test-request', role: 'penulis' };
const BODY = [
  '## Apa yang terjadi',
  '',
  'Teks TEST yang ditulis agent tiruan.',
  '',
  ':::angka',
  'nilai: 6',
  'satuan: persen',
  'periode: November 2026',
  'label: Suku bunga acuan TEST',
  'sumber: 1',
  ':::',
].join('\n');

describe.skipIf(!databaseAvailable)('proposal queue', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  const sourceIds: Record<string, string> = {};

  const addItem = async (sourceKey: string, title: string, hoursAgo: number) => {
    const run = await migrator.query<{ id: string }>(
      'INSERT INTO ingestion_runs (source_id, http_status) VALUES ($1, 200) RETURNING id',
      [sourceIds[sourceKey]],
    );
    const at = new Date(NOON.getTime() - hoursAgo * 3_600_000);
    const url = `https://${sourceKey}.example/${encodeURIComponent(title)}`;
    await migrator.query(
      `INSERT INTO discovered_items (source_id, run_id, canonical_url, guid, title, summary, fingerprint, published_at, first_seen_at)
       VALUES ($1, $2, $3, $3, $4, 'Ringkasan TEST.', sha256(convert_to(lower($4), 'UTF8')), $5, $5)`,
      [sourceIds[sourceKey], run.rows[0]?.id, url, title, at],
    );
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const userId =
      (
        await migrator.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
           VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
        )
      ).rows[0]?.id ?? '';
    for (const [key, organization, type] of [
      ['bi', 'Bank Indonesia', 'central_bank'],
      ['media-a', 'Media A', 'media'],
      ['media-b', 'Media B', 'media'],
    ] as const) {
      sourceIds[key] =
        (
          await migrator.query<{ id: string }>(
            `INSERT INTO sources (name, organization, type, official_url, license_status, status, created_by)
             VALUES ($1, $2, $3, $4, 'open', 'verified', $5) RETURNING id`,
            [organization, organization, type, `https://${key}.example/`, userId],
          )
        ).rows[0]?.id ?? '';
    }
    // Story 1 (strong): BI's own release plus two media. Story 2: one medium only.
    await addItem('bi', 'BI menahan suku bunga acuan untuk menjaga rupiah TEST', 1);
    await addItem('media-a', 'BI tahan suku bunga acuan demi rupiah TEST', 1);
    await addItem('media-b', 'Suku bunga acuan BI ditahan, rupiah menguat TEST', 1);
    await addItem('media-a', 'Harga beras naik di pasar tradisional menjelang akhir tahun TEST', 2);
    database = createDatabase(testDb.appUrl, { max: 5 });
    // The agent's daily draft quota must allow drafts.
    await migrator.query('UPDATE system_settings SET daily_draft_quota = 10');
  });

  afterAll(async () => {
    await database.close();
    await migrator.end();
    await testDb.drop();
  });

  let queueId = '';

  it('hands out the best story with numbered materials, official source first', async () => {
    const next = await nextStory(database.db, NOON);
    expect(next.story).not.toBeNull();
    queueId = next.story?.queueId ?? '';
    expect(next.story?.materials[0]?.official).toBe(true);
    expect(next.story?.materials.map((material) => material.number)).toEqual([1, 2, 3]);
    // Asked again, the agent gets the same story back rather than a second one.
    expect((await nextStory(database.db, NOON)).story?.queueId).toBe(queueId);
  });

  it('refuses citations outside the materials and drafts without enough support', async () => {
    const reject = async (input: Record<string, unknown>, rule: string) => {
      await expect(
        submitDraft(database.db, CONTEXT, {
          queueId,
          categorySlug: 'ekonomi',
          title: 'BI menahan suku bunga (TEST)',
          dek: 'Ringkasan TEST.',
          bodySource: BODY,
          ...input,
        }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof AppError && JSON.stringify(error.fields ?? []).includes(rule),
      );
    };
    await reject({ sources: [9] }, 'unknown_material');
    // A medium claimed as primary is refused; one medium alone is not enough support.
    await reject({ sources: [2], primary: [2] }, 'not_official');
    await reject({ sources: [2] }, 'insufficient');
  });

  it('drafts from the story: unchecked citations, items used, queue updated', async () => {
    const saved = await submitDraft(database.db, CONTEXT, {
      queueId,
      categorySlug: 'ekonomi',
      title: 'BI menahan suku bunga (TEST)',
      dek: 'Ringkasan TEST.',
      bodySource: BODY,
      sources: [1, 2],
      primary: [1],
    });
    expect(saved.articleId).toMatch(/[0-9a-f-]{36}/);
    const revision = await migrator.query<{ citations: { verified: boolean; primary: boolean }[] }>(
      `SELECT r.citations FROM article_revisions r JOIN articles a ON a.current_revision_id = r.id
       WHERE a.id = $1`,
      [saved.articleId],
    );
    const citations = revision.rows[0]?.citations ?? [];
    expect(citations).toHaveLength(2);
    expect(citations.every((citation) => !citation.verified)).toBe(true);
    expect(citations[0]?.primary).toBe(true);
    const queue = await migrator.query<{ status: string; article_id: string }>(
      'SELECT status, article_id FROM story_queue WHERE id = $1',
      [queueId],
    );
    expect(queue.rows[0]).toEqual({ status: 'drafted', article_id: saved.articleId });
    const used = await migrator.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM discovered_items WHERE status = 'used'`,
    );
    expect(used.rows[0]?.n).toBe(3);
    // A finished story cannot be submitted again.
    await expect(
      submitDraft(database.db, CONTEXT, {
        queueId,
        categorySlug: 'ekonomi',
        title: 'Lagi (TEST)',
        dek: '',
        bodySource: BODY,
        sources: [1],
        primary: [1],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('skips a weak story with a reason, and keeps the hourly quota', async () => {
    const next = await nextStory(database.db, NOON);
    if (next.story !== null) {
      await skipStory(database.db, {
        queueId: next.story.queueId,
        reason: 'Sumber hanya satu media.',
      });
    }
    // Fill the hour up with synthetic entries; the next request is refused by the quota.
    for (let n = 0; n < MAX_PER_HOUR; n += 1) {
      await migrator.query(
        `INSERT INTO story_queue (story_key, title, item_ids, score, status, queued_at)
         VALUES (uuidv7(), 'Isian TEST', ARRAY[uuidv7()], 60, 'skipped', $1)`,
        [new Date(NOON.getTime() - 60_000)],
      );
    }
    const blocked = await nextStory(database.db, NOON);
    expect(blocked).toEqual({ story: null, reason: 'quota_hour' });
  });

  it('only hands out breaking stories during the quiet hours', async () => {
    const quiet = new Date('2026-11-07T19:30:00Z'); // 02:30 WIB, a day later: quotas are clear
    await addItem('media-b', 'Pameran mobil listrik dibuka di Jakarta TEST', -38);
    const result = await nextStory(database.db, quiet);
    expect(result.story).toBeNull();
  });

  it('never deletes queue rows', async () => {
    await expect(migrator.query('DELETE FROM story_queue')).rejects.toThrow();
  });
});
