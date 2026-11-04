// Browser end-to-end checks for the Phase 0 web shell (PRD §14 TEST-WEB-01..10).
//
//   TEST_DATABASE_ADMIN_URL=postgres://postgres:<pw>@127.0.0.1:5432/postgres pnpm run test:e2e
//
// Starts the real API (fresh throwaway database) and a production build of the web app, then
// drives Chromium through them. Needs Playwright with Chromium installed on the machine.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, connect } from '../../apps/api/tests/support/database.ts';
import { migrate } from '../../apps/api/src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../apps/api/src/db/migrations-dir.ts';
import { hashPassword } from '../../apps/api/src/modules/auth/password.ts';
import { totpAt } from '../../apps/api/src/modules/auth/totp.ts';
import {
  PRIVATE_MARKER as PRIVATE_METADATA,
  exif,
  segment,
} from '../../apps/api/tests/support/images.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = createRequire(import.meta.url)('playwright');

const API_PORT = 4455;
const WEB_PORT = 3455;
const WEB = `http://localhost:${WEB_PORT}`;
const EMAIL = 'founder@example.invalid';
const PASSWORD = 'e2e founder passphrase 2026';

// Optional: E2E_SCREENSHOT_DIR=<dir> saves full-page screenshots of the main screens.
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

const results = [];
let currentCheck = 'setup';
async function check(id, name, fn) {
  currentCheck = id;
  try {
    await fn();
    results.push({ id, name, status: 'PASS' });
  } catch (error) {
    results.push({
      id,
      name,
      status: 'FAIL',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of text) {
    value = ((value << 5) | alphabet.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

async function waitFor(url, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not start`);
}

async function awayFromStepBoundary() {
  const intoStep = (Date.now() / 1000) % 30;
  if (intoStep > 26)
    await new Promise((resolve) => setTimeout(resolve, (30 - intoStep + 0.3) * 1000));
}

if (!process.env.TEST_DATABASE_ADMIN_URL) {
  console.error('NOT RUN: TEST_DATABASE_ADMIN_URL is not set');
  process.exit(2);
}

const database = await createTestDatabase();
const migrator = await connect(database.migratorUrl);
await migrate(migrator, MIGRATIONS_DIR);
await migrator.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'founder')`, [
  EMAIL,
  await hashPassword(PASSWORD),
]);
await migrator.end();

const apiEnv = {
  PATH: process.env.PATH ?? '',
  NODE_ENV: 'test',
  APP_BASE_URL: WEB,
  DATABASE_URL: database.appUrl,
  SESSION_SECRET: 'e2e-session-secret-'.padEnd(48, 'x'),
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
  PORT: String(API_PORT),
  PUBLIC_SITE_ENABLED: 'true',
  // Every page, browser call and server render of this run reaches the API from 127.0.0.1, so
  // the whole suite shares one rate-limit bucket. Real readers each get their own (see R-12).
  RATE_LIMIT_MAX: '2000',
};
const webEnv = {
  PATH: process.env.PATH ?? '',
  API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
  // Public origin for canonical URLs, sitemap and RSS (P1-08); without it the web app fails
  // closed and asks search engines not to index anything.
  APP_BASE_URL: WEB,
  NEXT_TELEMETRY_DISABLED: '1',
};
const nextBin = join(root, 'apps/web/node_modules/next/dist/bin/next');
// Set E2E_LOG_DIR to keep the API and web server output for debugging (it holds no secrets
// beyond these throwaway test values); by default it is discarded.
const serverOutput = (name) => {
  const dir = process.env.E2E_LOG_DIR;
  if (!dir) return 'ignore';
  const fd = openSync(join(dir, `${name}.log`), 'w');
  return ['ignore', fd, fd];
};

console.info('building web with the e2e API origin…');
const build = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: join(root, 'apps/web'),
  env: webEnv,
  encoding: 'utf8',
});
if (build.status !== 0) {
  console.error(build.stdout, build.stderr);
  process.exit(1);
}

const api = spawn(process.execPath, ['src/main.ts'], {
  cwd: join(root, 'apps/api'),
  env: apiEnv,
  stdio: serverOutput('api'),
});
const web = spawn(process.execPath, [nextBin, 'start', '-p', String(WEB_PORT)], {
  cwd: join(root, 'apps/web'),
  env: webEnv,
  stdio: serverOutput('web'),
});
const browser = await chromium.launch();

try {
  await waitFor(`http://127.0.0.1:${API_PORT}/health/live`, 'API');
  await waitFor(`${WEB}/`, 'web');

  const consoleErrors = [];
  const newPage = async (options = {}) => {
    const context = await browser.newContext({ deviceScaleFactor: SHOTS ? 2 : 1, ...options });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
        consoleErrors.push(`${currentCheck}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(`${currentCheck}: ${error.message}`));
    return page;
  };

  await check('TEST-WEB-01', 'public landing', async () => {
    const page = await newPage();
    const response = await page.goto(`${WEB}/`);
    assert(response?.status() === 200, `status ${response?.status()}`);
    assert((await page.getAttribute('html', 'lang')) === 'id', 'html lang is not id');
    assert((await page.textContent('h1'))?.includes('Biar semua paham.'), 'headline missing');
    assert((await response.headerValue('x-powered-by')) === null, 'x-powered-by leaked');
    await shot(page, '1-landing');
  });

  await check('TEST-WEB-02', 'private route redirect for anonymous visitors', async () => {
    const page = await newPage();
    for (const path of ['/os', '/os/anything']) {
      await page.goto(`${WEB}${path}`);
      assert(new URL(page.url()).pathname === '/os/login', `${path} ended at ${page.url()}`);
    }
  });

  let secret = Buffer.alloc(0);
  /** Signed-in page from TEST-WEB-03b, reused because a TOTP step can be used only once. */
  let signedIn = null;
  let publishedEditorUrl = null;
  await check('TEST-WEB-03', 'first login with MFA enrolment, private shell, logout', async () => {
    const page = await newPage();
    await page.goto(`${WEB}/os/login`);
    await shot(page, '2-login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Lanjut' }).click();
    await page.getByTestId('totp-secret').waitFor({ timeout: 10_000 });
    await shot(page, '3-mfa-enrolment');
    const secretText = await page.getByTestId('totp-secret').textContent({ timeout: 10_000 });
    secret = base32Decode(secretText ?? '');
    await awayFromStepBoundary();
    await page.getByLabel('Kode 6 digit').fill(totpAt(secret, new Date()));
    await page.getByRole('button', { name: 'Aktifkan & masuk' }).click();
    await page.getByTestId('recovery-codes').waitFor({ timeout: 10_000 });
    await shot(page, '4-recovery-codes');
    const codes = await page.getByTestId('recovery-codes').locator('li').count();
    assert(codes === 10, `expected 10 recovery codes, saw ${codes}`);
    await page.getByRole('button', { name: 'Sudah saya simpan, lanjut' }).click();
    await page.waitForURL(`${WEB}/os`);
    await shot(page, '5-os');
    assert((await page.textContent('main'))?.includes(EMAIL), 'founder email not shown on /os');
    await page.getByRole('button', { name: 'Keluar' }).click();
    await page.waitForURL(`${WEB}/os/login`);
    await page.goto(`${WEB}/os`);
    assert(new URL(page.url()).pathname === '/os/login', 'session still valid after logout');
  });

  await check('TEST-WEB-03b', 'returning login with TOTP', async () => {
    const page = await newPage();
    await page.goto(`${WEB}/os/login`);
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Lanjut' }).click();
    await awayFromStepBoundary();
    // The enrolment code used the current step; the next step is still inside the drift window.
    await page
      .getByLabel('Kode 6 digit dari authenticator')
      .fill(totpAt(secret, new Date(Date.now() + 30_000)));
    await page.getByRole('button', { name: 'Masuk', exact: true }).click();
    await page.waitForURL(`${WEB}/os`);
    signedIn = page;
  });

  await check('TEST-P1-02', 'newsroom: draft, preview, no HTML, revisions, stale tab', async () => {
    assert(signedIn !== null, 'needs the signed-in page from TEST-WEB-03b');
    const page = signedIn;
    await page.goto(`${WEB}/os/newsroom`);
    await page.getByRole('link', { name: 'Draft baru' }).click();
    await page.waitForURL(`${WEB}/os/newsroom/baru`);
    const title = '<img src=x onerror="window.__pwned=1">Harga Beras';
    await page.getByLabel('Judul').fill(title);
    await page.getByLabel('Ringkasan (dek)').fill('TEST fixture, bukan artikel nyata.');
    const body = page.getByLabel('Isi', { exact: true });
    await body.fill(
      [
        '## Apa yang terjadi',
        '',
        'Harga naik **tajam**, lihat [rilis](https://www.bps.go.id/id/pressrelease).',
        '',
        '<script>window.__pwned=1</script>',
      ].join('\n'),
    );
    await page.getByRole('button', { name: 'Pratinjau' }).click();
    const preview = page.locator('.editor-preview');
    await preview.locator('h2', { hasText: 'Apa yang terjadi' }).waitFor({ timeout: 10_000 });
    assert(
      (await preview.textContent())?.includes('Baris 5: HTML tidak didukung'),
      'preview did not flag the HTML line',
    );
    assert(
      (await preview.locator('a[href="https://www.bps.go.id/id/pressrelease"]').count()) === 1,
      'link not rendered',
    );
    await shot(page, '6-editor-preview');

    // Saving with the HTML line is refused, with the line number.
    await page.getByRole('button', { name: 'Simpan draft' }).click();
    await page.getByText('Baris 5: HTML tidak didukung').first().waitFor({ timeout: 10_000 });
    assert(page.url().endsWith('/os/newsroom/baru'), 'invalid draft was saved');

    await body.fill('## Apa yang terjadi\n\nHarga naik **tajam**.');
    await page.getByRole('button', { name: 'Simpan draft' }).click();
    await page.waitForURL(/\/os\/newsroom\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    const articleUrl = page.url();
    assert((await page.locator('h1').first().textContent()) === title, 'title not shown as text');
    assert((await page.evaluate(() => window.__pwned)) === undefined, 'injected script ran');
    assert(
      (await page.locator('h1 img, .os-content img').count()) === 0,
      'injected markup rendered',
    );

    // A second save is version 2, listed in the history.
    await page.getByLabel('Judul').fill('Harga Beras Naik');
    await page.getByLabel('Catatan perubahan').fill('Rapikan judul');
    await page.getByRole('button', { name: 'Simpan versi 2' }).click();
    await page.getByText('Tersimpan sebagai versi 2.').waitFor({ timeout: 10_000 });
    await page.locator('.revision-list', { hasText: 'Rapikan judul' }).waitFor({ timeout: 10_000 });
    await shot(page, '7-editor-saved');

    // Stale tab: tab B still holds version 2 when tab A saves version 3.
    const stale = await page.context().newPage();
    await stale.goto(articleUrl);
    await page.getByLabel('Judul').fill('Harga Beras Naik dari tab A');
    await page.getByRole('button', { name: 'Simpan versi 3' }).click();
    await page.getByText('Tersimpan sebagai versi 3.').waitFor({ timeout: 10_000 });
    await stale.getByLabel('Judul').fill('Harga Beras Naik dari tab B');
    await stale.getByRole('button', { name: 'Simpan versi 3' }).click();
    const conflict = await stale.locator('ul.error[role="alert"]').textContent({ timeout: 10_000 });
    assert(conflict?.includes('sudah diubah'), `no conflict message: ${conflict}`);

    // The newsroom list and the editor stay usable at 320 px.
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ['/os/newsroom', new URL(articleUrl).pathname]) {
      await page.goto(`${WEB}${path}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert(overflow <= 0, `${path} overflows by ${overflow}px`);
    }
    await stale.close();
  });

  await check(
    'TEST-P1-04',
    'sources: aggregator refused, number linked, computed label',
    async () => {
      assert(signedIn !== null, 'needs the signed-in page from TEST-WEB-03b');
      const page = signedIn;
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${WEB}/os/newsroom/baru`);
      await page.getByLabel('Judul').fill('Inflasi Oktober');
      await page.getByLabel('Ringkasan (dek)').fill('TEST fixture, bukan artikel nyata.');
      await page
        .getByLabel('Isi', { exact: true })
        .fill(
          [
            '## Data dan angka',
            '',
            ':::angka',
            'nilai: 2,8',
            'satuan: persen (yoy)',
            'periode: Oktober 2026',
            'label: Inflasi tahunan',
            'sumber: 1',
            ':::',
          ].join('\n'),
        );
      await page.getByRole('button', { name: 'Tambah sumber' }).click();
      await page.getByLabel('Sumber 1: URL').fill('https://news.google.com/rss/articles/abc');
      await page.getByLabel('Penerbit').fill('Badan Pusat Statistik');
      await page.getByRole('button', { name: 'Simpan draft' }).click();
      await page
        .getByText('Sumber 1, URL: Pakai URL penerbit aslinya')
        .waitFor({ timeout: 10_000 });
      assert(page.url().endsWith('/os/newsroom/baru'), 'aggregator citation was saved');

      await page
        .getByLabel('Sumber 1: URL')
        .fill('https://www.bps.go.id/id/pressrelease/2026/11/01/inflasi.html');
      await page.getByLabel('Judul halaman').fill('Inflasi Oktober 2026');
      await page.getByLabel('Sumber primer').check();
      await page.getByLabel('Sudah dicek').check();
      await page.getByRole('button', { name: 'Pratinjau' }).click();
      const label = page.getByTestId('verification');
      await label.waitFor({ timeout: 10_000 });
      assert((await label.textContent())?.includes('Terverifikasi'), 'label not TERVERIFIKASI');
      const preview = page.locator('.editor-preview');
      assert(
        (await preview.locator('.stat-source').textContent())?.includes(
          '[1] Badan Pusat Statistik',
        ),
        'number block does not show its source',
      );
      assert(
        (await preview.locator('#sumber-1 a').getAttribute('rel'))?.includes('noopener'),
        'link rel',
      );
      await shot(page, '8-sources-preview');

      await page.getByRole('button', { name: 'Simpan draft' }).click();
      await page.waitForURL(/\/os\/newsroom\/[0-9a-f-]{36}$/, { timeout: 10_000 });
      assert(
        (await page.getByTestId('verification').textContent())?.includes('Terverifikasi'),
        'label lost',
      );

      // Un-checking the only source drops the label (computed server-side, never sent).
      await page.getByLabel('Sudah dicek').uncheck();
      await page.getByLabel('Catatan perubahan').fill('Sumber belum dicek ulang');
      await page.getByRole('button', { name: 'Simpan versi 2' }).click();
      await page.getByText('Tersimpan sebagai versi 2.').waitFor({ timeout: 10_000 });
      assert(
        (await page.getByTestId('verification').textContent())?.includes('Belum terverifikasi'),
        'label did not drop',
      );
    },
  );

  await check('TEST-P1-03', 'review → approve → publish, edit voids approval, gate', async () => {
    assert(signedIn !== null, 'needs the signed-in page from TEST-WEB-03b');
    const page = signedIn;
    await page.setViewportSize({ width: 1280, height: 900 });
    const statusText = async () =>
      (await page.locator('.os-content > p.muted').first().textContent()) ?? '';
    // Match the status word at the start of the line: the slug (e.g. "alur-terbit") must not count.
    const waitStatus = async (label) => {
      await page
        .locator('.os-content > p.muted', { hasText: new RegExp(`^${label} ·`) })
        .first()
        .waitFor({ timeout: 10_000 });
    };

    // A sourced article goes all the way.
    await page.goto(`${WEB}/os/newsroom/baru`);
    await page.getByLabel('Judul', { exact: true }).fill('Alur terbit');
    await page.getByLabel('Ringkasan (dek)').fill('TEST fixture, bukan artikel nyata.');
    await page.getByLabel('Isi', { exact: true }).fill('## Konteks\n\nIsi TEST fixture.');
    await page.getByRole('button', { name: 'Tambah sumber' }).click();
    await page
      .getByLabel('Sumber 1: URL')
      .fill('https://www.bps.go.id/id/pressrelease/2026/11/01/alur.html');
    await page.getByLabel('Penerbit').fill('Badan Pusat Statistik');
    await page.getByLabel('Sumber primer').check();
    await page.getByLabel('Sudah dicek').check();
    await page.getByRole('button', { name: 'Simpan draft' }).click();
    await page.waitForURL(/\/os\/newsroom\/[0-9a-f-]{36}$/, { timeout: 10_000 });

    await page.getByRole('button', { name: 'Ajukan untuk review' }).click();
    await waitStatus('Ditinjau');

    // Editing under review sends it back to draft.
    await page.getByLabel('Judul', { exact: true }).fill('Alur terbit (revisi)');
    await page.getByRole('button', { name: 'Simpan versi 2' }).click();
    await page.getByText('Artikel kembali ke draft').waitFor({ timeout: 10_000 });
    await waitStatus('Draft');

    await page.getByRole('button', { name: 'Ajukan untuk review' }).click();
    await waitStatus('Ditinjau');
    await page.getByRole('button', { name: 'Setujui revisi ini' }).click();
    await waitStatus('Disetujui');
    await page.getByRole('button', { name: 'Terbitkan' }).click();
    await waitStatus('Terbit');
    const history =
      (await page.locator('section', { hasText: 'Riwayat status' }).textContent()) ?? '';
    for (const label of ['Diajukan untuk review', 'Disetujui', 'Diterbitkan']) {
      assert(history.includes(label), `history missing ${label}`);
    }
    assert(
      (await page.getByText('Artikel kembali ke draft').count()) === 0,
      'a stale "back to draft" notice is still shown after publishing',
    );
    // Published: no plain edits any more, only "publish a correction" (P1-07).
    assert(
      (await page.getByRole('button', { name: /^Simpan versi/ }).count()) === 0,
      'published article still offers a plain save',
    );
    assert(
      (await page.getByRole('button', { name: 'Terbitkan koreksi' }).count()) === 1,
      'published article does not offer a correction',
    );
    publishedEditorUrl = page.url();
    await shot(page, '9-published');

    // An unsourced article is blocked by the gate until the founder writes an exception.
    await page.goto(`${WEB}/os/newsroom/baru`);
    await page.getByLabel('Judul', { exact: true }).fill('Tanpa sumber');
    await page.getByLabel('Isi', { exact: true }).fill('## Konteks\n\nOpini TEST fixture.');
    await page.getByRole('button', { name: 'Simpan draft' }).click();
    await page.waitForURL(/\/os\/newsroom\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    assert(
      (await page.getByTestId('gate').textContent())?.includes('Belum ada sumber yang sudah dicek'),
      'gate not shown',
    );
    await page.getByRole('button', { name: 'Ajukan untuk review' }).click();
    await waitStatus('Ditinjau');
    await page.getByRole('button', { name: 'Setujui revisi ini' }).click();
    const blocked = await page
      .locator('.workflow ul.error[role="alert"]')
      .textContent({ timeout: 10_000 });
    assert(blocked?.includes('Belum ada sumber'), `gate did not block: ${blocked}`);
    assert((await statusText()).includes('Ditinjau'), 'status changed despite the gate');
    await page
      .getByLabel('Alasan terbit tanpa sumber terverifikasi (opsional, tampil ke pembaca)')
      .fill('Tulisan opini founder, tanpa klaim faktual.');
    await page.getByRole('button', { name: 'Setujui revisi ini' }).click();
    await waitStatus('Disetujui');
  });

  await check('TEST-P1-06', 'public pages: home, topic, article; unpublished is 404', async () => {
    // A fresh anonymous visitor: no cookies at all.
    const page = await newPage();
    const home = await page.goto(`${WEB}/`);
    assert(home?.status() === 200, `home status ${home?.status()}`);
    await page.getByRole('link', { name: 'Alur terbit (revisi)' }).click();
    await page.waitForURL(`${WEB}/artikel/alur-terbit`);
    assert((await page.locator('h1').textContent()) === 'Alur terbit (revisi)', 'article title');
    const reading = (await page.locator('article.reading').textContent()) ?? '';
    for (const text of ['Terverifikasi.', 'Sumber', 'Badan Pusat Statistik', 'Isi TEST fixture.']) {
      assert(reading.includes(text), `article page missing "${text}"`);
    }
    assert(
      (await page.locator('#sumber-1 a').getAttribute('href')) ===
        'https://www.bps.go.id/id/pressrelease/2026/11/01/alur.html',
      'source link',
    );
    await shot(page, '10-public-article');

    await page.goto(`${WEB}/topik/ekonomi`);
    assert(
      (await page.getByRole('link', { name: 'Alur terbit (revisi)' }).count()) === 1,
      'topic page does not list the article',
    );
    await page.goto(`${WEB}/tentang`);
    assert((await page.locator('#verifikasi').count()) === 1, 'about page');

    // Approved-but-unpublished, unknown and malformed slugs are all plain 404 pages.
    for (const path of [
      '/artikel/tanpa-sumber',
      '/artikel/tidak-ada',
      '/artikel/Bad%20Slug',
      '/topik/tidak-ada',
    ]) {
      const response = await page.goto(`${WEB}${path}`);
      assert(response?.status() === 404, `${path} answered ${response?.status()}`);
      assert(!((await page.textContent('main')) ?? '').includes('Tanpa sumber'), `${path} leaked`);
    }

    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ['/', '/artikel/alur-terbit', '/topik/ekonomi', '/tentang']) {
      await page.goto(`${WEB}${path}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert(overflow <= 0, `${path} overflows by ${overflow}px`);
    }
  });

  await check(
    'TEST-P1-07',
    'corrections: substantial is public, minor stays internal',
    async () => {
      assert(signedIn !== null && publishedEditorUrl !== null, 'needs the article from TEST-P1-03');
      const page = signedIn;
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(publishedEditorUrl);
      const substantial = 'Sebelumnya tertulis isi lama; kini diperbarui sesuai rilis resmi.';
      const minor = 'Perbaikan salah ketik di ringkasan artikel.';

      // Without a description the API refuses and nothing is published.
      await page
        .getByLabel('Isi', { exact: true })
        .fill('## Konteks\n\nIsi TEST fixture, dikoreksi.');
      await page.getByRole('button', { name: 'Terbitkan koreksi' }).click();
      const refused = await page.locator('.editor-form ul.error').textContent({ timeout: 10_000 });
      assert(refused?.includes('Tulis apa yang dikoreksi'), `no description error: ${refused}`);

      await page.getByLabel('Apa yang dikoreksi').fill(substantial);
      await page.getByRole('button', { name: 'Terbitkan koreksi' }).click();
      await page.getByText('Catatan koreksi tampil ke pembaca').waitFor({ timeout: 10_000 });
      await page.getByTestId('corrections').waitFor({ timeout: 10_000 });

      await page
        .getByLabel('Ringkasan (dek)')
        .fill('TEST fixture, bukan artikel nyata (dikoreksi).');
      await page.getByLabel('Apa yang dikoreksi').fill(minor);
      await page.getByLabel(/^Koreksi substansial/).uncheck();
      await page.getByRole('button', { name: 'Terbitkan koreksi' }).click();
      await page.getByText('Koreksi kecil: hanya tercatat').waitFor({ timeout: 10_000 });
      await page.getByTestId('corrections').getByText(minor).waitFor({ timeout: 10_000 });
      const history =
        (await page.locator('section', { hasText: 'Riwayat status' }).textContent()) ?? '';
      assert(history.includes('Koreksi diterbitkan'), 'status history misses the correction');
      await shot(page, '11-correction-os');

      // Readers: the article shows the substantial correction, never the minor one.
      const reader = await newPage();
      await reader.goto(`${WEB}/artikel/alur-terbit`);
      const box = (await reader.getByTestId('corrections').textContent()) ?? '';
      assert(box.includes(substantial), 'article misses the substantial correction');
      assert(!box.includes(minor), 'article shows a minor correction');
      assert(
        ((await reader.locator('article.reading').textContent()) ?? '').includes('dikoreksi.'),
        'article does not show the corrected body',
      );
      await shot(reader, '12-correction-public');
      const list = await reader.goto(`${WEB}/koreksi`);
      assert(list?.status() === 200, `/koreksi answered ${list?.status()}`);
      const listed = (await reader.locator('main').textContent()) ?? '';
      assert(listed.includes(substantial), '/koreksi misses the substantial correction');
      assert(!listed.includes(minor), '/koreksi shows a minor correction');
      await reader.setViewportSize({ width: 320, height: 640 });
      for (const path of ['/koreksi', '/artikel/alur-terbit']) {
        await reader.goto(`${WEB}${path}`);
        const overflow = await reader.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert(overflow <= 0, `${path} overflows by ${overflow}px`);
      }
    },
  );

  await check(
    'TEST-P1-08',
    'SEO after launch: robots, sitemap, RSS, canonical, Open Graph',
    async () => {
      const text = async (path) => {
        const response = await fetch(`${WEB}${path}`);
        return {
          status: response.status,
          type: response.headers.get('content-type') ?? '',
          body: await response.text(),
        };
      };
      const robots = await text('/robots.txt');
      assert(robots.status === 200, `robots.txt ${robots.status}`);
      assert(
        /Allow: \/\n/.test(robots.body),
        `robots.txt does not allow the site: ${JSON.stringify(robots.body)}`,
      );
      assert(robots.body.includes('Disallow: /os'), 'robots.txt does not disallow /os');
      assert(robots.body.includes(`Sitemap: ${WEB}/sitemap.xml`), 'robots.txt misses the sitemap');

      const sitemap = await text('/sitemap.xml');
      assert(sitemap.status === 200, `sitemap ${sitemap.status}`);
      for (const path of ['/', '/artikel/alur-terbit', '/topik/ekonomi', '/koreksi', '/tentang']) {
        assert(sitemap.body.includes(`<loc>${WEB}${path}</loc>`), `sitemap misses ${path}`);
      }
      // Approved-but-unpublished and private pages never appear.
      for (const leak of ['tanpa-sumber', '/os']) {
        assert(!sitemap.body.includes(leak), `sitemap leaks ${leak}`);
      }

      const rss = await text('/rss.xml');
      assert(
        rss.status === 200 && rss.type.startsWith('application/rss+xml'),
        `rss ${rss.status} ${rss.type}`,
      );
      assert(
        rss.body.includes(`<link>${WEB}/artikel/alur-terbit</link>`),
        'rss misses the article',
      );
      assert(!rss.body.includes('Tanpa sumber'), 'rss leaks an unpublished article');

      const page = await newPage();
      await page.goto(`${WEB}/artikel/alur-terbit`);
      const meta = (selector) => page.locator(selector).first().getAttribute('content');
      assert(
        (await page.locator('link[rel="canonical"]').getAttribute('href')) ===
          `${WEB}/artikel/alur-terbit`,
        'canonical',
      );
      assert((await meta('meta[property="og:type"]')) === 'article', 'og:type');
      assert((await meta('meta[property="og:title"]')) === 'Alur terbit (revisi)', 'og:title');
      assert((await meta('meta[property="og:site_name"]')) === 'NALARA', 'og:site_name');
      assert(
        (await meta('meta[property="og:image"]')) === `${WEB}/brand/nalara-beringin-512.png`,
        'og:image',
      );
      assert((await meta('meta[name="robots"]')) === 'index, follow', 'article robots');
      assert(
        (await page.locator('link[type="application/rss+xml"]').getAttribute('href')) ===
          `${WEB}/rss.xml`,
        'rss alternate link',
      );
      // A tampered cursor or an older topic page is not indexed on its own.
      await page.goto(`${WEB}/topik/ekonomi?setelah=x`);
      assert((await meta('meta[name="robots"]')) === 'noindex, follow', 'paged topic robots');

      // Private pages: noindex in the page and in the header, launched or not.
      const login = await page.goto(`${WEB}/os/login`);
      assert(
        (login?.headers()['x-robots-tag'] ?? '').includes('noindex'),
        'X-Robots-Tag missing on /os',
      );
      assert(
        (await meta('meta[name="robots"]'))?.startsWith('noindex, nofollow'),
        '/os robots meta',
      );
    },
  );

  await check(
    'TEST-P1-05',
    'source registry: add, licence rule, verify, filter, edit',
    async () => {
      assert(signedIn !== null, 'needs the signed-in page from TEST-WEB-03b');
      const page = signedIn;
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${WEB}/os`);
      await page.getByRole('link', { name: 'Sumber', exact: true }).click();
      await page.waitForURL(`${WEB}/os/sources`);
      await page.getByRole('link', { name: 'Tambah sumber' }).click();
      await page.getByLabel('Nama sumber').fill('Berita Resmi Statistik');
      await page.getByLabel('Lembaga').fill('Badan Pusat Statistik');
      await page.getByLabel('URL resmi').fill('https://www.bps.go.id/id/pressrelease');
      // "Verified" with an unknown licence is refused.
      await page.getByLabel('Status').selectOption('verified');
      await page.getByRole('button', { name: 'Simpan sumber' }).click();
      const refused = await page.locator('ul.error[role="alert"]').textContent({ timeout: 10_000 });
      assert(refused?.includes('isi lisensinya dulu'), `licence rule not shown: ${refused}`);

      await page.getByLabel('Lisensi', { exact: true }).selectOption('attribution_required');
      await page.getByLabel(/^Atribusi/).fill('Sumber: Badan Pusat Statistik');
      await page.getByRole('button', { name: 'Simpan sumber' }).click();
      await page.waitForURL(/\/os\/sources\/[0-9a-f-]{36}$/, { timeout: 10_000 });
      assert(
        ((await page.locator('.os-content > p.muted').first().textContent()) ?? '').startsWith(
          'Terverifikasi · versi 1',
        ),
        'new source is not verified v1',
      );

      await page.getByLabel('Status').selectOption('paused');
      await page.getByRole('button', { name: 'Simpan perubahan' }).click();
      await page.getByText('Tersimpan (versi 2).').waitFor({ timeout: 10_000 });
      await shot(page, '13-source');

      await page.goto(`${WEB}/os/sources?status=paused`);
      assert(
        ((await page.getByTestId('sources').textContent()) ?? '').includes(
          'Berita Resmi Statistik',
        ),
        'paused filter misses the source',
      );
      await page.goto(`${WEB}/os/sources?status=verified`);
      assert(
        (await page.getByText('Berita Resmi Statistik').count()) === 0,
        'verified filter shows a paused source',
      );

      // P2-03b: a feed URL shows the feed panel; a paused source is never checked.
      await page.goto(`${WEB}/os/sources?status=paused`);
      await page.getByRole('link', { name: 'Berita Resmi Statistik' }).click();
      await page
        .getByLabel(/^URL feed RSS\/Atom/)
        .fill('https://www.bps.go.id/id/pressrelease/rss');
      await page.getByRole('button', { name: 'Simpan perubahan' }).click();
      await page.getByText('Tersimpan (versi 3).').waitFor({ timeout: 10_000 });
      await page.getByTestId('feed').getByText('Belum dicek').waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Cek feed sekarang' }).click();
      await page
        .getByText('Feed hanya dicek untuk sumber berstatus Terverifikasi.')
        .waitFor({ timeout: 10_000 });
    },
  );

  await check(
    'TEST-P1-09',
    'media: strip metadata, alt required, licence gate, public image',
    async () => {
      assert(signedIn !== null, 'needs the signed-in page from TEST-WEB-03b');
      const page = signedIn;
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${WEB}/os/media`);
      // A real, decodable JPEG drawn by the browser, then a fake camera EXIF block (with the
      // "GPS" marker) inserted after SOI and junk appended after the end of the image.
      const dataUrl = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 200;
        const context = canvas.getContext('2d');
        context.fillStyle = '#1f3a2e';
        context.fillRect(0, 0, 320, 200);
        context.fillStyle = '#c9a96e';
        context.fillRect(40, 60, 240, 80);
        return canvas.toDataURL('image/jpeg', 0.9);
      });
      const plain = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      const photo = Buffer.concat([
        plain.subarray(0, 2),
        segment(0xe1, exif(1)),
        plain.subarray(2),
        Buffer.from(PRIVATE_METADATA),
      ]);
      assert(photo.includes(Buffer.from(PRIVATE_METADATA)), 'fixture lacks the metadata marker');

      const input = page.getByLabel(/^Berkas gambar/);
      await input.setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: photo });
      // Alt text is required: the browser stops the form, then the API would too.
      await page
        .getByLabel('Teks alternatif (wajib)')
        .fill('Kotak emas di atas latar hijau tua, TEST fixture');
      await page.getByRole('button', { name: 'Unggah gambar' }).click();
      await page.waitForURL(/\/os\/media\/[0-9a-f-]{36}$/, { timeout: 10_000 });
      const mediaId = page.url().split('/').at(-1);
      const snippet = (await page.getByTestId('snippet').textContent()) ?? '';
      assert(snippet.includes(`media: ${mediaId}`), `snippet: ${snippet}`);
      const stored = await page.request.get(`${WEB}/api/v1/os/media/${mediaId}/file`);
      const storedBytes = Buffer.from(await stored.body());
      assert(stored.headers()['content-type'] === 'image/jpeg', 'stored type');
      assert(!storedBytes.includes(Buffer.from(PRIVATE_METADATA)), 'metadata survived the upload');
      assert(!storedBytes.includes(Buffer.from('Exif')), 'EXIF block survived the upload');
      assert(
        await page
          .locator('.media-preview img')
          .evaluate((img) => img.complete && img.naturalWidth === 320),
        'stripped JPEG does not decode in the browser',
      );

      // An article with the image cannot be approved while the licence is missing.
      await page.goto(`${WEB}/os/newsroom/baru`);
      await page.getByLabel('Judul', { exact: true }).fill('Artikel bergambar');
      await page.getByLabel('Ringkasan (dek)').fill('TEST fixture dengan gambar.');
      await page
        .getByLabel('Isi', { exact: true })
        .fill(`## Konteks\n\nIsi TEST fixture.\n\n${snippet}`);
      await page.getByRole('button', { name: 'Tambah sumber' }).click();
      await page
        .getByLabel('Sumber 1: URL')
        .fill('https://www.bps.go.id/id/pressrelease/2026/11/01/gambar.html');
      await page.getByLabel('Penerbit').fill('Badan Pusat Statistik');
      await page.getByLabel('Sumber primer').check();
      await page.getByLabel('Sudah dicek').check();
      await page.getByRole('button', { name: 'Pratinjau' }).click();
      await page.locator('.preview-article .article-image img').waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Simpan draft' }).click();
      await page.waitForURL(/\/os\/newsroom\/[0-9a-f-]{36}$/, { timeout: 10_000 });
      const articleUrl = page.url();
      assert(
        ((await page.getByTestId('gate').textContent()) ?? '').includes('lisensi atau atribusinya'),
        'gate does not mention the image licence',
      );
      await page.getByRole('button', { name: 'Ajukan untuk review' }).click();
      await page.getByRole('button', { name: 'Setujui revisi ini' }).waitFor();
      await page.getByRole('button', { name: 'Setujui revisi ini' }).click();
      const blocked = await page
        .locator('.workflow ul.error[role="alert"]')
        .textContent({ timeout: 10_000 });
      assert(blocked?.includes('lisensi atau atribusinya'), `image gate did not block: ${blocked}`);

      await page.goto(`${WEB}/os/media/${mediaId}`);
      await page.getByLabel('Lisensi (wajib sebelum terbit)').fill('Milik NALARA');
      await page.getByLabel('Atribusi (wajib sebelum terbit)').fill('Ilustrasi: NALARA');
      await page.getByRole('button', { name: 'Simpan perubahan' }).click();
      await page.getByText('Tersimpan (versi 2).').waitFor({ timeout: 10_000 });

      await page.goto(articleUrl);
      await page.getByRole('button', { name: 'Setujui revisi ini' }).click();
      await page.getByRole('button', { name: 'Terbitkan' }).waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Terbitkan' }).click();
      await page.getByRole('button', { name: 'Terbitkan koreksi' }).waitFor({ timeout: 10_000 });

      // Readers see the image with its alt text and credit, served by the public route.
      const reader = await newPage();
      await reader.goto(`${WEB}/artikel/artikel-bergambar`);
      const image = reader.locator('article.reading .article-image img');
      await image.waitFor({ timeout: 10_000 });
      assert(
        (await image.getAttribute('alt')) === 'Kotak emas di atas latar hijau tua, TEST fixture',
        'alt text',
      );
      assert(
        (await image.getAttribute('src')) === `/api/v1/public/media/${mediaId}`,
        'public image route',
      );
      assert(
        await image.evaluate((img) => img.complete && img.naturalWidth === 320),
        'public image does not load',
      );
      assert(
        ((await reader.locator('.article-image figcaption').textContent()) ?? '').includes(
          'Ilustrasi: NALARA',
        ),
        'credit line missing',
      );
      const publicFile = await reader.request.get(`${WEB}/api/v1/public/media/${mediaId}`);
      assert(
        !Buffer.from(await publicFile.body()).includes(Buffer.from(PRIVATE_METADATA)),
        'public bytes leak',
      );
      await shot(reader, '14-article-image');
      await reader.setViewportSize({ width: 320, height: 640 });
      await reader.goto(`${WEB}/artikel/artikel-bergambar`);
      const overflow = await reader.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert(overflow <= 0, `article with image overflows by ${overflow}px`);
    },
  );

  await check(
    'TEST-P1-10b',
    'nonce CSP: page scripts run, injected inline script is blocked',
    async () => {
      // The policy: a fresh nonce per response, no 'unsafe-inline' for scripts.
      const nonces = [];
      for (const path of ['/', '/tentang']) {
        const response = await fetch(`${WEB}${path}`);
        const policy = response.headers.get('content-security-policy') ?? '';
        const script = /script-src ([^;]+)/.exec(policy)?.[1] ?? '';
        const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(script)?.[1];
        assert(nonce !== undefined, `${path}: no nonce in ${policy}`);
        assert(!script.includes('unsafe-inline'), `${path}: script-src allows inline: ${script}`);
        assert(script.includes("'strict-dynamic'"), `${path}: no strict-dynamic`);
        // Every script tag Next.js renders carries this response's nonce.
        const html = await response.text();
        const tags = html.match(/<script\b[^>]*>/g) ?? [];
        assert(tags.length > 0, `${path}: no scripts rendered`);
        const missing = tags.filter((tag) => !tag.includes(`nonce="${nonce}"`));
        assert(missing.length === 0, `${path}: scripts without the nonce: ${missing.join(' ')}`);
        nonces.push(nonce);
      }
      assert(new Set(nonces).size === nonces.length, 'nonce reused across responses');

      // An inline script injected into the HTML (as an XSS would) must not run; the page's own
      // scripts must, so the founder's forms still work.
      const page = await newPage();
      await page.addInitScript(() => {
        window.__violations = [];
        document.addEventListener('securitypolicyviolation', (event) => {
          window.__violations.push(event.violatedDirective);
        });
      });
      await page.route(`${WEB}/os/login`, async (route) => {
        const original = await route.fetch();
        const body = (await original.text()).replace(
          '</body>',
          '<script>window.__pwned = true</script></body>',
        );
        await route.fulfill({ response: original, body });
      });
      await page.goto(`${WEB}/os/login`);
      await page.waitForFunction(() => window.__violations.length > 0, null, { timeout: 10_000 });
      assert((await page.evaluate(() => window.__pwned)) === undefined, 'injected script ran');
      assert(
        (await page.evaluate(() => window.__violations)).every((d) => d.startsWith('script-src')),
        'unexpected CSP violation kind',
      );
      // Next.js's own inline bootstrap scripts (nonced) did run. Every other check in this
      // suite drives hydrated forms under the same policy.
      const bootstrap = await page.evaluate(() => typeof self.__next_f);
      assert(bootstrap === 'object', `Next.js inline bootstrap scripts did not run (${bootstrap})`);
    },
  );

  await check(
    'TEST-WEB-04',
    'invalid or expired session cookie redirects (server-side check)',
    async () => {
      const page = await newPage();
      await page.context().addCookies([
        {
          name: '__Host-nalara_session',
          value: 'A'.repeat(43),
          domain: 'localhost',
          path: '/',
          sameSite: 'Lax',
          secure: true,
          httpOnly: true,
        },
      ]);
      await page.goto(`${WEB}/os`);
      assert(new URL(page.url()).pathname === '/os/login', `ended at ${page.url()}`);
    },
  );

  await check('TEST-WEB-05/07', 'keyboard navigation with visible focus', async () => {
    const page = await newPage();
    await page.goto(`${WEB}/os/login`);
    await page.keyboard.press('Tab');
    assert(
      await page.evaluate(() => document.activeElement?.classList.contains('skip-link')),
      'first Tab is not the skip link',
    );
    // The skip link jumps over the masthead and navigation straight into the content.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    assert(
      await page.evaluate(() => document.activeElement?.getAttribute('name') === 'email'),
      'Tab after the skip link is not the email field',
    );
    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    assert(
      outline.style !== 'none' && outline.width >= 2,
      `focus outline not visible: ${JSON.stringify(outline)}`,
    );
    await page.keyboard.type(EMAIL);
    await page.keyboard.press('Tab');
    await page.keyboard.type('a wrong password for keyboard test');
    await page.keyboard.press('Enter');
    const alert = await page.locator('p.error[role="alert"]').textContent({ timeout: 10_000 });
    assert(alert?.includes('salah'), `unexpected alert: ${alert}`);
  });

  await check('TEST-WEB-06', 'no horizontal scrolling at 320 px', async () => {
    const page = await newPage({ viewport: { width: 320, height: 640 } });
    for (const path of ['/', '/os/login']) {
      await page.goto(`${WEB}${path}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert(overflow <= 0, `${path} overflows by ${overflow}px`);
    }
  });

  await check('TEST-WEB-09', 'user input is never rendered as HTML', async () => {
    const page = await newPage();
    await page.goto(`${WEB}/os/login`);
    await page.getByLabel('Email').fill('<img src=x onerror="window.__pwned=1">');
    await page.getByLabel('Password').fill('<script>window.__pwned=1</script>');
    await page.getByRole('button', { name: 'Lanjut' }).click();
    await page.locator('p.error[role="alert"]').waitFor({ timeout: 10_000 });
    assert((await page.evaluate(() => window.__pwned)) === undefined, 'injected script ran');
    assert((await page.locator('main img').count()) === 0, 'injected markup rendered');
  });

  await check('TEST-WEB-10', 'error boundary hides internals when the API is down', async () => {
    api.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const page = await newPage();
    await page.context().addCookies([
      {
        name: '__Host-nalara_session',
        value: 'B'.repeat(43),
        domain: 'localhost',
        path: '/',
        sameSite: 'Lax',
        secure: true,
        httpOnly: true,
      },
    ]);
    await page.goto(`${WEB}/os`);
    const text = (await page.textContent('main')) ?? '';
    assert(text.includes('Ada gangguan'), `error page not shown: ${text.slice(0, 120)}`);
    assert(
      !/ECONNREFUSED|fetch failed|at .*\.(js|ts):\d+|API_BASE_URL/.test(text),
      'internal details leaked',
    );
  });

  await check('TEST-P1-08b', 'SEO fails closed: API down means noindex everywhere', async () => {
    // The API was stopped by TEST-WEB-10: nothing can confirm launch.
    const robots = await (await fetch(`${WEB}/robots.txt`)).text();
    assert(/Disallow: \/\n/.test(robots) && !robots.includes('Allow: /'), `robots: ${robots}`);
    const sitemap = await (await fetch(`${WEB}/sitemap.xml`)).text();
    assert(!sitemap.includes('<loc>'), 'sitemap lists pages while launch is unconfirmed');
    const page = await newPage();
    await page.goto(`${WEB}/tentang`);
    assert(
      (await page.locator('meta[name="robots"]').first().getAttribute('content')) ===
        'noindex, nofollow',
      'page robots while launch is unconfirmed',
    );
  });

  await check('console', 'no unexpected browser console errors', async () => {
    // Expected only during TEST-WEB-10: the deliberate API outage makes the server render fail,
    // and React reports that (minified, without details) in the client console. Any console
    // error from any other check fails the run.
    const unexpected = consoleErrors.filter(
      (text) =>
        !(
          text.startsWith('TEST-WEB-10: ') && /Minified React error|Server Components/.test(text)
        ) &&
        // TEST-P1-10b injects a script without a nonce on purpose; the browser reports the block.
        !(text.startsWith('TEST-P1-10b: ') && /Content Security Policy/.test(text)),
    );
    assert(unexpected.length === 0, unexpected.join(' | '));
  });
} finally {
  await browser.close();
  api.kill('SIGTERM');
  web.kill('SIGTERM');
  await database.drop();
}

for (const result of results) {
  console.info(
    `${result.status.padEnd(4)} ${result.id.padEnd(13)} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  );
}
const failed = results.filter((result) => result.status !== 'PASS').length;
console.info(`\n${results.length - failed}/${results.length} passed`);
// Every check must have run: a crash that skips some is a failure, never a partial pass.
process.exit(failed === 0 && results.length === 20 ? 0 : 1);
