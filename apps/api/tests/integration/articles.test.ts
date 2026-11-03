// P1-01 article schema + revisions against a real PostgreSQL (PRD v4 §6.2, §10.1 P1-01).
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { AppError } from '../../src/lib/errors.ts';
import {
  createDraft,
  getArticle,
  listRevisions,
  saveRevision,
} from '../../src/modules/articles/articles.ts';
import { contentSha256 } from '../../src/modules/articles/content.ts';
import type { RevisionContent } from '../../src/modules/articles/content.ts';
import {
  adminUrl,
  connect,
  createTestDatabase,
  databaseAvailable,
  sqlState,
  type TestDatabase,
} from '../support/database.ts';

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, fields: error.fields };
    throw error;
  }
  return undefined;
};

describe.skipIf(!databaseAvailable)('articles and revisions', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let app: pg.Client;
  let superuser: pg.Client;
  let founderId = '';
  let categoryId = '';
  let otherCategoryId = '';

  const content = (overrides: Partial<RevisionContent> = {}): RevisionContent => ({
    title: 'Kenapa Harga Beras Naik',
    dek: 'Tiga penyebab utama, dengan angka resmi.',
    articleType: 'explainer',
    categoryId,
    body: [
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Apa yang terjadi' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'TEST fixture, bukan artikel nyata.' }],
      },
    ],
    bodySource: '## Apa yang terjadi\n\nTEST fixture, bukan artikel nyata.',
    methodNote: null,
    ...overrides,
  });

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    app = await connect(testDb.appUrl);
    const url = new URL(adminUrl ?? '');
    url.pathname = `/${testDb.name}`;
    superuser = await connect(url.toString());
    const user = await migrator.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role) VALUES ('founder@example.invalid', 'x', 'founder') RETURNING id`,
    );
    founderId = user.rows[0]?.id ?? '';
    const cats = await app.query<{ id: string; slug: string }>(
      'SELECT id, slug FROM categories ORDER BY slug',
    );
    categoryId = cats.rows.find((row) => row.slug === 'ekonomi')?.id ?? '';
    otherCategoryId = cats.rows.find((row) => row.slug === 'teknologi')?.id ?? '';
    database = createDatabase(testDb.appUrl, { max: 5 });
  });

  afterAll(async () => {
    await database.close();
    await app.end();
    await superuser.end();
    await migrator.end();
    await testDb.drop();
  });

  const actor = () => ({ userId: founderId, requestId: 'req-test' });

  it('seeds the three initial topics (D-17)', async () => {
    const rows = await app.query<{ slug: string; name: string }>(
      'SELECT slug, name FROM categories ORDER BY slug',
    );
    expect(rows.rows).toEqual([
      { slug: 'ekonomi', name: 'Ekonomi' },
      { slug: 'kebijakan', name: 'Kebijakan' },
      { slug: 'teknologi', name: 'Teknologi' },
    ]);
  });

  it('creates a draft with revision 1, a stable content hash and an audit event', async () => {
    const saved = await createDraft(database.db, actor(), { content: content() });
    expect(saved.version).toBe(1);
    expect(saved.slug).toBe('kenapa-harga-beras-naik');

    const article = await getArticle(database.db, saved.articleId);
    expect(article?.status).toBe('draft');
    expect(article?.currentVersion).toBe(1);
    expect(article?.current.id).toBe(saved.revisionId);
    expect(article?.current.contentSha256).toBe(contentSha256(content()).toString('hex'));

    const audit = await app.query<{ action: string; actor_id: string; metadata: unknown }>(
      `SELECT action, actor_id, metadata FROM audit_events WHERE resource_id = $1`,
      [saved.articleId],
    );
    expect(audit.rows).toEqual([
      { action: 'article.create', actor_id: founderId, metadata: { version: 1 } },
    ]);
  });

  it('every save is a new immutable revision with the next version', async () => {
    const saved = await createDraft(database.db, actor(), {
      content: content({ title: 'Inflasi Oktober' }),
    });
    const v2 = await saveRevision(database.db, actor(), saved.articleId, {
      expectedVersion: 1,
      content: content({ title: 'Inflasi Oktober 2026', categoryId: otherCategoryId }),
      changeNote: 'Perjelas judul',
    });
    const v3 = await saveRevision(database.db, actor(), saved.articleId, {
      expectedVersion: 2,
      content: content({ title: 'Inflasi Oktober 2026', dek: 'Ringkasan baru.' }),
      changeNote: 'Ganti ringkasan',
    });
    expect([v2.version, v3.version]).toEqual([2, 3]);

    const history = await listRevisions(database.db, saved.articleId);
    expect(history.map((revision) => [revision.version, revision.title])).toEqual([
      [1, 'Inflasi Oktober'],
      [2, 'Inflasi Oktober 2026'],
      [3, 'Inflasi Oktober 2026'],
    ]);
    expect(history[1]?.categoryId).toBe(otherCategoryId);
    expect(history[0]?.changeNote).toBe('Draft pertama');
    // The slug does not follow later title changes (ADR-016).
    expect((await getArticle(database.db, saved.articleId))?.slug).toBe('inflasi-oktober');
  });

  it('refuses a stale expected version and writes nothing', async () => {
    const saved = await createDraft(database.db, actor(), {
      content: content({ title: 'Stale version case' }),
    });
    await saveRevision(database.db, actor(), saved.articleId, {
      expectedVersion: 1,
      content: content({ title: 'Stale version case v2' }),
      changeNote: 'Edit tab A',
    });
    const stale = await code(
      saveRevision(database.db, actor(), saved.articleId, {
        expectedVersion: 1,
        content: content({ title: 'Stale version case from tab B' }),
        changeNote: 'Edit tab B',
      }),
    );
    expect(stale?.code).toBe('VERSION_CONFLICT');
    expect((await listRevisions(database.db, saved.articleId)).length).toBe(2);
  });

  it('lets exactly one of two concurrent editors win (T-11)', async () => {
    const saved = await createDraft(database.db, actor(), {
      content: content({ title: 'Race case' }),
    });
    const results = await Promise.allSettled(
      ['A', 'B', 'C'].map((tab) =>
        saveRevision(database.db, actor(), saved.articleId, {
          expectedVersion: 1,
          content: content({ title: `Race case from ${tab}` }),
          changeNote: `Edit ${tab}`,
        }),
      ),
    );
    const won = results.filter((result) => result.status === 'fulfilled');
    const lost = results.filter((result) => result.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost.map((result) => (result.reason as AppError).code)).toEqual([
      'VERSION_CONFLICT',
      'VERSION_CONFLICT',
    ]);
    expect((await getArticle(database.db, saved.articleId))?.currentVersion).toBe(2);
  });

  it('rejects an unchanged save, an unknown topic and invalid content before writing', async () => {
    const saved = await createDraft(database.db, actor(), {
      content: content({ title: 'Validation case' }),
    });
    const same = await code(
      saveRevision(database.db, actor(), saved.articleId, {
        expectedVersion: 1,
        content: content({ title: 'Validation case' }),
        changeNote: 'Tidak ada perubahan',
      }),
    );
    expect(same?.fields).toEqual([{ path: 'content', rule: 'unchanged' }]);

    const unknown = await code(
      createDraft(database.db, actor(), {
        content: content({ categoryId: '01900000-0000-7000-8000-000000000000' }),
      }),
    );
    expect(unknown?.fields).toEqual([{ path: 'categoryId', rule: 'unknown' }]);

    const script = await code(
      createDraft(database.db, actor(), {
        content: {
          ...content(),
          body: [{ type: 'html', html: '<script>alert(1)</script>' }],
        },
      }),
    );
    expect(script?.code).toBe('VALIDATION_FAILED');

    const missing = await code(
      saveRevision(database.db, actor(), '01900000-0000-7000-8000-000000000000', {
        expectedVersion: 1,
        content: content(),
        changeNote: 'x',
      }),
    );
    expect(missing?.code).toBe('NOT_FOUND');
    expect((await listRevisions(database.db, saved.articleId)).length).toBe(1);
  });

  it('picks a free slug automatically and refuses a taken or malformed explicit slug', async () => {
    const first = await createDraft(database.db, actor(), {
      content: content({ title: 'Slug Sama' }),
    });
    const second = await createDraft(database.db, actor(), {
      content: content({ title: 'Slug Sama!' }),
    });
    expect([first.slug, second.slug]).toEqual(['slug-sama', 'slug-sama-2']);
    expect(
      (await code(createDraft(database.db, actor(), { content: content(), slug: 'slug-sama' })))
        ?.code,
    ).toBe('SLUG_TAKEN');
    expect(
      (await code(createDraft(database.db, actor(), { content: content(), slug: 'Bukan Slug' })))
        ?.fields,
    ).toEqual([{ path: 'slug', rule: 'invalid_format' }]);
  });

  it('only allows edits while the article is a draft (state machine comes in P1-03)', async () => {
    const saved = await createDraft(database.db, actor(), {
      content: content({ title: 'Archived case' }),
    });
    await app.query(`UPDATE articles SET status = 'archived' WHERE id = $1`, [saved.articleId]);
    const result = await code(
      saveRevision(database.db, actor(), saved.articleId, {
        expectedVersion: 1,
        content: content({ title: 'Archived case edited' }),
        changeNote: 'x',
      }),
    );
    expect(result?.code).toBe('NOT_EDITABLE');
  });

  describe('database guarantees (S1-14)', () => {
    let articleId = '';
    let revisionId = '';

    beforeAll(async () => {
      const saved = await createDraft(database.db, actor(), {
        content: content({ title: 'Guarantees case' }),
      });
      articleId = saved.articleId;
      revisionId = saved.revisionId;
    });

    it('the app role can never change or remove a revision', async () => {
      expect(
        await sqlState(
          app.query(`UPDATE article_revisions SET title = 'x' WHERE id = $1`, [revisionId]),
        ),
      ).toBe('42501');
      expect(
        await sqlState(app.query(`DELETE FROM article_revisions WHERE id = $1`, [revisionId])),
      ).toBe('42501');
      expect(await sqlState(app.query('TRUNCATE article_revisions'))).toBe('42501');
      expect(await sqlState(app.query(`DELETE FROM articles WHERE id = $1`, [articleId]))).toBe(
        '42501',
      );
      expect(
        await sqlState(app.query(`INSERT INTO categories (slug, name) VALUES ('x-y', 'X')`)),
      ).toBe('42501');
    });

    it('even the migrator and the superuser are stopped by the immutability trigger', async () => {
      for (const client of [migrator, superuser]) {
        expect(
          await sqlState(
            client.query(`UPDATE article_revisions SET title = 'x' WHERE id = $1`, [revisionId]),
          ),
        ).toBe('42501');
        expect(
          await sqlState(client.query(`DELETE FROM article_revisions WHERE id = $1`, [revisionId])),
        ).toBe('42501');
        expect(await sqlState(client.query('TRUNCATE article_revisions CASCADE'))).toBe('42501');
      }
    });

    it('an article can only point at its own revisions', async () => {
      const other = await createDraft(database.db, actor(), {
        content: content({ title: 'Other article' }),
      });
      expect(
        await sqlState(
          app.query(`UPDATE articles SET current_revision_id = $1 WHERE id = $2`, [
            other.revisionId,
            articleId,
          ]),
        ),
      ).toBe('23503');
    });

    it('enforces state invariants: no approved/published state without a complete approval', async () => {
      expect(
        await sqlState(
          app.query(`UPDATE articles SET status = 'published' WHERE id = $1`, [articleId]),
        ),
      ).toBe('23514');
      expect(
        await sqlState(
          app.query(`UPDATE articles SET approved_revision_id = $1 WHERE id = $2`, [
            revisionId,
            articleId,
          ]),
        ),
      ).toBe('23514');
      const hash = createHash('sha256').update('x').digest();
      expect(
        await sqlState(
          app.query(
            `UPDATE articles SET status = 'approved', approved_revision_id = $1,
               approved_content_sha256 = $2, approved_by = $3, approved_at = now() WHERE id = $4`,
            [revisionId, hash, founderId, articleId],
          ),
        ),
      ).toBeUndefined();
      expect(
        await sqlState(
          app.query(`UPDATE articles SET slug = 'Bad Slug' WHERE id = $1`, [articleId]),
        ),
      ).toBe('23514');
    });
  });
});
