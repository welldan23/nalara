// Browser end-to-end checks for the Phase 0 web shell (PRD §14 TEST-WEB-01..10).
//
//   TEST_DATABASE_ADMIN_URL=postgres://postgres:<pw>@127.0.0.1:5432/postgres pnpm run test:e2e
//
// Starts the real API (fresh throwaway database) and a production build of the web app, then
// drives Chromium through them. Needs Playwright with Chromium installed on the machine.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, connect } from '../../apps/api/tests/support/database.ts';
import { migrate } from '../../apps/api/src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../apps/api/src/db/migrations-dir.ts';
import { hashPassword } from '../../apps/api/src/modules/auth/password.ts';
import { totpAt } from '../../apps/api/src/modules/auth/totp.ts';

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
};
const webEnv = {
  PATH: process.env.PATH ?? '',
  API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
  NEXT_TELEMETRY_DISABLED: '1',
};
const nextBin = join(root, 'apps/web/node_modules/next/dist/bin/next');

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
  stdio: 'ignore',
});
const web = spawn(process.execPath, [nextBin, 'start', '-p', String(WEB_PORT)], {
  cwd: join(root, 'apps/web'),
  env: webEnv,
  stdio: 'ignore',
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
  });

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
    await page.keyboard.press('Tab');
    assert(
      await page.evaluate(() => document.activeElement?.getAttribute('name') === 'email'),
      'second Tab is not the email field',
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

  await check('console', 'no unexpected browser console errors', async () => {
    // Expected only during TEST-WEB-10: the deliberate API outage makes the server render fail,
    // and React reports that (minified, without details) in the client console. Any console
    // error from any other check fails the run.
    const unexpected = consoleErrors.filter(
      (text) =>
        !(text.startsWith('TEST-WEB-10: ') && /Minified React error|Server Components/.test(text)),
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
process.exit(failed === 0 ? 0 : 1);
