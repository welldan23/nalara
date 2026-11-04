// P1-09 media library: upload by magic bytes, metadata stripped, alt text required, licence and
// credit required to publish, public serving only for published articles (PRD v4 §7, §10.1 P1-09).
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { csrfTokenFor } from '../../src/modules/auth/csrf.ts';
import { createSession } from '../../src/modules/auth/session.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  sqlState,
  type TestDatabase,
} from '../support/database.ts';
import { PRIVATE_MARKER as PRIVATE_METADATA, jpeg, png, pngChunk } from '../support/images.ts';

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

const CITE = '01900000-0000-7000-8000-00000000000a';
const citation = (overrides: Record<string, unknown> = {}) => ({
  id: CITE,
  url: 'https://www.bps.go.id/id/pressrelease/2026/11/01/inflasi.html',
  publisher: 'Badan Pusat Statistik',
  title: 'Inflasi Oktober 2026',
  accessedAt: '2026-11-03',
  claimNote: '',
  primary: true,
  verified: true,
  ...overrides,
});
const STAT = [
  '## Data dan angka',
  '',
  ':::angka',
  'nilai: 2,8',
  'satuan: persen (yoy)',
  'periode: Oktober 2026',
  'label: Inflasi tahunan',
  'sumber: 1',
  ':::',
].join('\n');

describe.skipIf(!databaseAvailable)('media library', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let token = '';
  let csrf = '';
  let categoryId = '';

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const user = await migrator.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
       VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
    );
    categoryId =
      (await migrator.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'ekonomi'`))
        .rows[0]?.id ?? '';
    database = createDatabase(testDb.appUrl, { max: 5 });
    const session = await createSession(database.db, user.rows[0]?.id ?? '');
    token = session.token;
    csrf = csrfTokenFor(SECRET, session.sessionId);
    app = await buildApp(
      { ...config, publicSiteEnabled: true },
      { readiness: () => Promise.resolve(true), database: database.db },
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
    await migrator.end();
    await testDb.drop();
  });

  const post = (url: string, payload: unknown) =>
    app.inject({
      method: url.startsWith('PATCH ') ? 'PATCH' : 'POST',
      url: url.replace(/^PATCH /, ''),
      payload: payload as Record<string, unknown>,
      headers: { origin: ORIGIN, cookie: `${COOKIE}=${token}`, 'x-csrf-token': csrf },
    });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  const content = (overrides: Record<string, unknown> = {}) => ({
    title: 'Inflasi Oktober',
    dek: 'TEST fixture, bukan artikel nyata.',
    articleType: 'explainer',
    categoryId,
    methodNote: null,
    bodySource: STAT,
    citations: [citation()],
    ...overrides,
  });
  const createArticle = async (overrides: Record<string, unknown> = {}) => {
    const response = await post('/api/v1/os/articles', content(overrides));
    expect(response.statusCode).toBe(201);
    return parse<{ articleId: string }>(response).articleId;
  };
  const act = (id: string, action: string, body: Record<string, unknown> = {}) =>
    post(`/api/v1/os/articles/${id}/${action}`, { expectedVersion: 1, ...body });
  const errorOf = (response: LightMyRequestResponse) =>
    parse<{ error: { code: string; fields?: { path: string; rule: string }[] } }>(response).error;

  const patch = (url: string, payload: unknown) =>
    app.inject({
      method: 'PATCH',
      url,
      payload: payload as Record<string, unknown>,
      headers: { origin: ORIGIN, cookie: `${COOKIE}=${token}`, 'x-csrf-token': csrf },
    });
  const founderGet = (url: string) =>
    app.inject({ method: 'GET', url, headers: { cookie: `${COOKIE}=${token}` } });
  const publicGet = (url: string) => app.inject({ method: 'GET', url });
  interface Media {
    id: string;
    mime: string;
    width: number;
    height: number;
    byteSize: number;
    license: string | null;
    attribution: string | null;
    version: number;
  }
  const upload = async (file: Buffer, overrides: Record<string, unknown> = {}) =>
    post('/api/v1/os/media', {
      data: file.toString('base64'),
      altText: 'Grafik inflasi bulanan, TEST fixture',
      usageBasis: 'own_work',
      license: 'Milik NALARA',
      attribution: 'Grafik: NALARA',
      ...overrides,
    });
  const uploaded = async (file: Buffer, overrides: Record<string, unknown> = {}) => {
    const response = await upload(file, overrides);
    expect(response.statusCode, response.body).toBe(201);
    return parse<{ media: Media }>(response).media;
  };
  const imageBody = (mediaId: string) => `${STAT}\n\n:::gambar\nmedia: ${mediaId}\n:::`;
  const stored = async (id: string) =>
    (await migrator.query<{ data: Buffer }>('SELECT data FROM media_assets WHERE id = $1', [id]))
      .rows[0]?.data ?? Buffer.alloc(0);

  it('stores a stripped copy: no EXIF/GPS, no text chunks, no trailing data; audited by name', async () => {
    const photo = await uploaded(
      jpeg({ orientation: 6, trailing: Buffer.from(PRIVATE_METADATA) }),
      {
        usageBasis: 'licensed',
      },
    );
    expect(photo).toMatchObject({ mime: 'image/jpeg', width: 40, height: 30 });
    const bytes = await stored(photo.id);
    expect(bytes.includes(Buffer.from(PRIVATE_METADATA))).toBe(false);
    expect(bytes.length).toBe(photo.byteSize);

    const graphic = await uploaded(
      png(4, 3, [pngChunk('tEXt', Buffer.from(`Author\0${PRIVATE_METADATA}`, 'latin1'))]),
    );
    expect(graphic).toMatchObject({ mime: 'image/png', width: 4, height: 3 });
    expect((await stored(graphic.id)).includes(Buffer.from(PRIVATE_METADATA))).toBe(false);

    const audit = await migrator.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_events WHERE action = 'media.upload' AND resource_id = $1`,
      [photo.id],
    );
    expect(audit.rows[0]?.metadata).toMatchObject({
      mime: 'image/jpeg',
      licensed: true,
      removed: 'COM,EXIF,IPTC,XMP,trailing-data',
    });
    expect(JSON.stringify(audit.rows)).not.toContain(PRIVATE_METADATA);

    // The founder's preview gets the stripped bytes with safe headers.
    const file = await founderGet(`/api/v1/os/media/${photo.id}/file`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(file.rawPayload.equals(bytes)).toBe(true);
    expect((await publicGet(`/api/v1/os/media/${photo.id}/file`)).statusCode).toBe(401);
  });

  it('refuses anything that is not a PNG, JPEG or WebP, whatever it claims to be', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00');
    for (const file of [svg, html, gif, Buffer.from('%PDF-1.7')]) {
      const response = await upload(file);
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).fields).toEqual([{ path: 'data', rule: 'unsupported_type' }]);
    }
    const broken = png(4, 3).subarray(0, 40);
    expect(errorOf(await upload(broken)).fields).toEqual([{ path: 'data', rule: 'corrupt' }]);
    const bomb = png(9000, 9000, [], undefined, { pixels: false });
    expect(errorOf(await upload(bomb)).fields).toEqual([
      { path: 'data', rule: 'dimensions_too_large' },
    ]);
    expect(errorOf(await upload(png(4, 3), { data: 'not base64!' })).fields).toEqual([
      { path: 'data', rule: 'base64_invalid' },
    ]);
    // A declared type is not even accepted as a field.
    expect((await upload(png(4, 3), { mime: 'image/png' })).statusCode).toBe(400);
  });

  it('requires alt text; licence and credit may follow but are checked', async () => {
    expect(errorOf(await upload(png(4, 3), { altText: '' })).fields).toEqual([
      { path: 'altText', rule: 'too_small' },
    ]);
    const draft = await uploaded(png(4, 3), { license: null, attribution: '' });
    expect(draft).toMatchObject({ license: null, attribution: null });
    expect(errorOf(await upload(png(4, 3), { usageBasis: 'found_online' })).fields).toEqual([
      { path: 'usageBasis', rule: 'invalid_value' },
    ]);
  });

  it('blocks publishing an article with an unlicensed image until licence and credit exist', async () => {
    const image = await uploaded(png(4, 3), { license: null, attribution: null });
    const id = await createArticle({ title: 'Artikel bergambar', bodySource: imageBody(image.id) });
    expect((await act(id, 'submit')).statusCode).toBe(200);
    const blocked = await act(id, 'approve');
    expect(blocked.statusCode).toBe(422);
    expect(errorOf(blocked).fields).toEqual([{ path: 'gate', rule: 'image_license_missing' }]);
    const detail = parse<{ gate: string[]; media: Record<string, { licensed: boolean }> }>(
      await founderGet(`/api/v1/os/articles/${id}`),
    );
    expect(detail.gate).toEqual(['image_license_missing']);
    expect(detail.media[image.id]?.licensed).toBe(false);

    const described = await patch(`/api/v1/os/media/${image.id}`, {
      expectedVersion: 1,
      altText: 'Grafik inflasi bulanan, TEST fixture',
      usageBasis: 'own_work',
      license: 'Milik NALARA',
      attribution: 'Grafik: NALARA',
    });
    expect(described.statusCode, described.body).toBe(200);
    expect((await act(id, 'approve')).statusCode).toBe(200);
    expect((await act(id, 'publish')).statusCode).toBe(200);

    // Readers get the image only now, and the article carries its alt text and credit.
    const slug = (
      await migrator.query<{ slug: string }>('SELECT slug FROM articles WHERE id = $1', [id])
    ).rows[0]?.slug;
    const article = parse<{
      article: {
        body: { type: string }[];
        media: Record<string, { altText: string; attribution: string }>;
      };
    }>(await publicGet(`/api/v1/public/articles/${slug ?? ''}`)).article;
    expect(article.body.some((block) => block.type === 'image')).toBe(true);
    expect(article.media[image.id]).toMatchObject({ attribution: 'Grafik: NALARA' });
    const file = await publicGet(`/api/v1/public/media/${image.id}`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('serves nothing publicly that is not in a published article', async () => {
    const unused = await uploaded(png(4, 3));
    const inDraft = await uploaded(png(4, 3));
    await createArticle({ title: 'Draft bergambar', bodySource: imageBody(inDraft.id) });
    for (const id of [unused.id, inDraft.id, '01900000-0000-7000-8000-0000000000ff', 'nope']) {
      expect((await publicGet(`/api/v1/public/media/${id}`)).statusCode, id).toBe(404);
    }
  });

  it('refuses a body pointing at an image that is not in the library', async () => {
    const response = await post(
      '/api/v1/os/articles',
      content({ bodySource: imageBody('01900000-0000-7000-8000-0000000000ee') }),
    );
    expect(errorOf(response).fields).toEqual([{ path: 'bodySource', rule: 'image_media_unknown' }]);
    const malformed = await post(
      '/api/v1/os/articles',
      content({ bodySource: ':::gambar\nmedia: ../../etc/passwd\n:::' }),
    );
    expect(errorOf(malformed).fields).toEqual([
      { path: 'bodySource.line.1', rule: 'image_media_invalid' },
    ]);
  });

  it('keeps the bytes immutable and rows undeletable; descriptions use optimistic locking', async () => {
    const image = await uploaded(png(4, 3));
    const appClient = await connect(testDb.appUrl);
    try {
      expect(
        await sqlState(
          appClient.query(`UPDATE media_assets SET data = '\\x00' WHERE id = $1`, [image.id]),
        ),
      ).toBe('42501');
      expect(
        await sqlState(appClient.query(`UPDATE media_assets SET mime = 'image/svg+xml'`)),
      ).toBe('42501');
      expect(await sqlState(appClient.query('DELETE FROM media_assets'))).toBe('42501');
    } finally {
      await appClient.end();
    }
    const body = {
      altText: 'Teks alternatif yang lebih jelas',
      usageBasis: 'own_work',
      license: 'Milik NALARA',
      attribution: 'Grafik: NALARA',
    };
    expect(
      (await patch(`/api/v1/os/media/${image.id}`, { ...body, expectedVersion: 1 })).statusCode,
    ).toBe(200);
    expect(
      errorOf(await patch(`/api/v1/os/media/${image.id}`, { ...body, expectedVersion: 1 })).code,
    ).toBe('VERSION_CONFLICT');
    expect(
      errorOf(await patch(`/api/v1/os/media/${image.id}`, { ...body, expectedVersion: 2 })).fields,
    ).toEqual([{ path: 'media', rule: 'unchanged' }]);
    const list = parse<{ media: Media[] }>(await founderGet('/api/v1/os/media')).media;
    expect(list.some((entry) => entry.id === image.id)).toBe(true);
    expect(JSON.stringify(list)).not.toContain('"data"');
  });

  it('checks the session before reading an upload body', async () => {
    // Not even valid JSON: a 401 (not a 400 parse error) shows the body was never parsed.
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/v1/os/media',
      payload: '{"data": "' + 'A'.repeat(100_000),
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
    });
    expect(anonymous.statusCode).toBe(401);
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/os/media',
      payload: { data: png(4, 3).toString('base64') },
      headers: { origin: ORIGIN, cookie: `${COOKIE}=${token}` },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('labels AI-generated images for readers', async () => {
    const image = await uploaded(png(4, 3), {
      usageBasis: 'ai_generated',
      license: 'Dibuat dengan alat AI, tanpa batasan pemakaian',
      attribution: 'Ilustrasi: NALARA (AI)',
    });
    const id = await createArticle({ title: 'Ilustrasi AI', bodySource: imageBody(image.id) });
    for (const action of ['submit', 'approve', 'publish']) {
      expect((await act(id, action)).statusCode, action).toBe(200);
    }
    const slug = (
      await migrator.query<{ slug: string }>('SELECT slug FROM articles WHERE id = $1', [id])
    ).rows[0]?.slug;
    const article = parse<{ article: { media: Record<string, { aiGenerated: boolean }> } }>(
      await publicGet(`/api/v1/public/articles/${slug ?? ''}`),
    ).article;
    expect(article.media[image.id]?.aiGenerated).toBe(true);
  });
});
