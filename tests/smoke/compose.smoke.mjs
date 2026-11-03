// Runtime checks for the production Compose topology (PRD §14 TEST-COMPOSE-01..10).
//
//   pnpm run test:compose            # builds images, starts a throwaway stack, checks, removes it
//   SMOKE_SKIP_BUILD=1 pnpm run test:compose   # reuse nalara-api:local / nalara-web:local
//
// Uses a random env file with generated secrets and its own Compose project name and volumes,
// so it never touches a real deployment.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const project = `nalara-smoke-${randomBytes(3).toString('hex')}`;
const workDir = mkdtempSync(join(tmpdir(), 'nalara-smoke-'));
const envFile = join(workDir, 'smoke.env');
const hex = () => randomBytes(24).toString('hex');
const secrets = {
  POSTGRES_PASSWORD: hex(),
  DB_MIGRATOR_PASSWORD: hex(),
  DB_APP_PASSWORD: hex(),
  APP_BASE_URL: 'https://nalara.test',
  SESSION_SECRET: randomBytes(48).toString('base64'),
  MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};
// Not secrets: kept apart so TEST-COMPOSE-10 does not hunt for common words in image metadata.
const SITE = 'nalara.test';
const settings = { ...secrets, SITE_ADDRESS: SITE, CADDY_TLS: 'internal' };
writeFileSync(
  envFile,
  Object.entries(settings)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n',
  { mode: 0o600 },
);

const compose = (...args) => [
  'compose',
  '-f',
  join(root, 'compose.prod.yaml'),
  '--env-file',
  envFile,
  '-p',
  project,
  ...args,
];
const docker = (args, options = {}) =>
  execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
const tryDocker = (args) => spawnSync('docker', args, { cwd: root, encoding: 'utf8' });
// -a: include stopped containers (TEST-COMPOSE-07 inspects a stopped api).
const containerId = (service) => docker(compose('ps', '-a', '-q', service));
const inspect = (service, format) => docker(['inspect', '-f', format, containerId(service)]);
const exec = (service, ...cmd) => tryDocker(compose('exec', '-T', service, ...cmd));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Local checks must hit this host directly, never an outbound proxy configured in the shell.
const directEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(https?|all|no)_proxy$/i.test(key)),
);

async function waitHealthy(services, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = services.map((service) => {
      try {
        return inspect(service, '{{.State.Health.Status}}');
      } catch {
        return 'missing';
      }
    });
    if (states.every((state) => state === 'healthy')) return;
    await sleep(1_000);
  }
  throw new Error(`not healthy in time: ${services.join(', ')}`);
}

const results = [];
async function check(id, name, fn) {
  try {
    await fn();
    results.push({ id, name, status: 'PASS' });
  } catch (error) {
    results.push({
      id,
      name,
      status: 'FAIL',
      detail: error instanceof Error ? error.message.split('\n')[0] : String(error),
    });
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  if (process.env.SMOKE_SKIP_BUILD !== '1') {
    console.info('building images…');
    docker(compose('build', 'api', 'web'), { stdio: 'inherit' });
  }

  await check(
    'TEST-COMPOSE-01',
    'config valid; a missing secret is refused by name, not value',
    async () => {
      docker(compose('config', '--quiet'));
      const missingFile = join(workDir, 'missing.env');
      writeFileSync(missingFile, `POSTGRES_PASSWORD=${secrets.POSTGRES_PASSWORD}\n`, {
        mode: 0o600,
      });
      const result = tryDocker([
        'compose',
        '-f',
        join(root, 'compose.prod.yaml'),
        '--env-file',
        missingFile,
        'config',
        '--quiet',
      ]);
      assert(result.status !== 0, 'config accepted missing secrets');
      assert(
        /DB_MIGRATOR_PASSWORD|DB_APP_PASSWORD|SESSION_SECRET/.test(result.stderr),
        'error does not name the variable',
      );
      assert(!result.stderr.includes(secrets.POSTGRES_PASSWORD), 'error echoed a secret value');
    },
  );

  docker(compose('up', '-d', 'db'));
  await waitHealthy(['db']);
  const migrate = tryDocker(compose('run', '--rm', 'migrate'));
  if (migrate.status !== 0) throw new Error(`migrate failed: ${migrate.stderr}`);
  docker(compose('up', '-d', 'api', 'web', 'caddy'));

  await check('TEST-COMPOSE-05', 'every service becomes healthy', async () => {
    await waitHealthy(['db', 'api', 'web']);
  });

  await check(
    'TEST-COMPOSE-02',
    'database is private: no published ports, internal network, unreachable from web',
    async () => {
      for (const service of ['db', 'api', 'web']) {
        assert(docker(['port', containerId(service)]) === '', `${service} publishes ports`);
      }
      const networks = JSON.parse(inspect('db', '{{json .NetworkSettings.Networks}}'));
      const names = Object.keys(networks);
      assert(
        names.length === 1 && names[0].endsWith('_backend'),
        `db networks: ${names.join(',')}`,
      );
      assert(
        docker(['network', 'inspect', '-f', '{{.Internal}}', names[0]]) === 'true',
        'backend network is not internal',
      );
      const probe =
        "require('net').connect(5432,'db').on('connect',()=>process.exit(0)).on('error',()=>process.exit(3));setTimeout(()=>process.exit(4),3000)";
      assert(exec('web', 'node', '-e', probe).status !== 0, 'web can reach the database');
      assert(exec('api', 'node', '-e', probe).status === 0, 'api cannot reach the database');
      assert(
        exec('web', 'wget', '-q', '-O', '-', 'http://api:4000/health/live').stdout.includes('ok'),
        'web cannot reach api',
      );
    },
  );

  await check('TEST-COMPOSE-03', 'application processes run as non-root', async () => {
    for (const service of ['api', 'web']) {
      const uid = exec(service, 'id', '-u').stdout.trim();
      assert(uid !== '' && uid !== '0', `${service} runs as uid ${uid}`);
    }
    // PID 1 is the database server itself once the entrypoint has dropped privileges.
    const dbUid = /^Uid:\s+(\d+)/m.exec(exec('db', 'cat', '/proc/1/status').stdout)?.[1];
    assert(dbUid !== undefined && dbUid !== '0', `db PID 1 runs as uid ${String(dbUid)}`);
  });

  await check('TEST-COMPOSE-06', 'restart policy and hardening are applied', async () => {
    for (const service of ['db', 'api', 'web']) {
      assert(
        inspect(service, '{{.HostConfig.RestartPolicy.Name}}') === 'unless-stopped',
        `${service} restart policy`,
      );
      assert(
        inspect(service, '{{.HostConfig.ReadonlyRootfs}}') === 'true',
        `${service} root fs writable`,
      );
      assert(
        inspect(service, '{{json .HostConfig.CapDrop}}').includes('ALL'),
        `${service} keeps capabilities`,
      );
      assert(
        inspect(service, '{{json .HostConfig.SecurityOpt}}').includes('no-new-privileges'),
        `${service} allows new privileges`,
      );
    }
  });

  await check('TEST-COMPOSE-09', 'read-only filesystems with writable /tmp only', async () => {
    for (const [service, path] of [
      ['api', '/app/apps/api/dist/x'],
      ['web', '/app/x'],
      ['db', '/x'],
    ]) {
      assert(exec(service, 'touch', path).status !== 0, `${service} could write ${path}`);
      assert(exec(service, 'touch', '/tmp/ok').status === 0, `${service} cannot write /tmp`);
    }
  });

  await check(
    'TEST-COMPOSE-10',
    'images contain no secrets, proxy settings or env files',
    async () => {
      for (const image of ['nalara-api:local', 'nalara-web:local']) {
        const metadata =
          docker(['history', '--no-trunc', image]) + docker(['image', 'inspect', image]);
        for (const value of Object.values(secrets))
          assert(!metadata.includes(value), `${image} metadata contains a secret`);
        assert(
          !/PROXY=|127\.0\.0\.1:\d{4,5}/.test(metadata),
          `${image} metadata contains proxy settings`,
        );
        const found = tryDocker([
          'run',
          '--rm',
          '--entrypoint',
          'sh',
          image,
          '-c',
          "find /app -name '.env*' -o -name '*.pem' -o -name 'ca-bundle*' | head -5",
        ]);
        assert(found.stdout.trim() === '', `${image} contains: ${found.stdout.trim()}`);
      }
    },
  );

  // --- Edge proxy (P0-013): HTTPS rehearsal with Caddy's local CA. ---
  const caFile = join(workDir, 'caddy-root.crt');
  const curl = (...args) =>
    spawnSync(
      'curl',
      [
        '-sS',
        '--max-time',
        '10',
        '--resolve',
        `${SITE}:443:127.0.0.1`,
        '--resolve',
        `${SITE}:80:127.0.0.1`,
        ...args,
      ],
      {
        encoding: 'utf8',
        env: directEnv,
      },
    );
  {
    const deadline = Date.now() + 60_000;
    let ca = '';
    while (Date.now() < deadline) {
      ca = exec('caddy', 'cat', '/data/caddy/pki/authorities/local/root.crt').stdout;
      if (
        ca.includes('BEGIN CERTIFICATE') &&
        curl('-k', '-o', '/dev/null', `https://${SITE}/health/live`).status === 0
      )
        break;
      await sleep(1_000);
    }
    writeFileSync(caFile, ca);
  }

  await check('TEST-OPS-01', 'HTTP redirects to HTTPS', async () => {
    const result = curl(
      '-o',
      '/dev/null',
      '-w',
      '%{http_code} %{redirect_url}',
      `http://${SITE}/os?x=1`,
    );
    assert(
      result.stdout === `308 https://${SITE}/os?x=1`,
      `got "${result.stdout}" ${result.stderr}`,
    );
  });

  await check(
    'TEST-OPS-02',
    'TLS certificate validates against the issuing CA and names the site',
    async () => {
      const trusted = curl(
        '--cacert',
        caFile,
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        `https://${SITE}/health/live`,
      );
      assert(
        trusted.status === 0 && trusted.stdout === '200',
        `with CA: ${trusted.stdout} ${trusted.stderr}`,
      );
      const untrusted = curl('-o', '/dev/null', `https://${SITE}/health/live`);
      assert(untrusted.status !== 0, 'an unknown CA was accepted');
      const wrongName = spawnSync(
        'curl',
        [
          '-sS',
          '--max-time',
          '10',
          '--cacert',
          caFile,
          '--resolve',
          'evil.test:443:127.0.0.1',
          'https://evil.test/',
        ],
        { encoding: 'utf8', env: directEnv },
      );
      assert(wrongName.status !== 0, 'a certificate was served for an unconfigured host name');
    },
  );

  await check(
    'TEST-OPS-03',
    'security headers, hidden readiness, proxy-owned request IDs, clean logs',
    async () => {
      const page = curl(
        '--cacert',
        caFile,
        '-D',
        '-',
        '-o',
        '/dev/null',
        `https://${SITE}/`,
      ).stdout.toLowerCase();
      for (const header of [
        'strict-transport-security: max-age=31536000',
        'x-content-type-options: nosniff',
        'x-frame-options: deny',
        'referrer-policy: strict-origin-when-cross-origin',
        "frame-ancestors 'none'",
      ]) {
        assert(page.includes(header), `missing ${header}`);
      }
      assert(
        !/^server:/m.test(page) && !/^x-powered-by:/m.test(page),
        'server identification header leaked',
      );
      const ready = curl(
        '--cacert',
        caFile,
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        `https://${SITE}/health/ready`,
      );
      assert(ready.stdout === '404', `/health/ready via proxy answered ${ready.stdout}`);
      const spoofed = curl(
        '--cacert',
        caFile,
        '-H',
        'X-Request-ID: attacker-chosen-id-123',
        `https://${SITE}/api/v1/nope`,
      );
      const requestId = JSON.parse(spoofed.stdout).error.requestId;
      assert(
        /^[0-9a-f-]{36}$/.test(requestId),
        `request id ${requestId} was not generated by the proxy`,
      );
      const login = curl(
        '--cacert',
        caFile,
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        '-H',
        `Origin: https://${SITE}`,
        '-H',
        'content-type: application/json',
        '-H',
        'Cookie: probe-cookie-secret=abc123',
        '--data',
        '{"email":"nobody@example.invalid","password":"wrong password here"}',
        `https://${SITE}/api/v1/auth/login`,
      );
      assert(
        login.stdout === '401',
        `same-origin login through the proxy answered ${login.stdout} (expected 401)`,
      );
      const logs = docker(compose('logs', 'caddy'));
      assert(logs.includes('/api/v1/auth/login'), 'proxy access log is missing');
      assert(!logs.includes('probe-cookie-secret'), 'proxy access log contains cookies');
    },
  );

  await check(
    'TEST-OPS-04',
    'only 80/443 are exposed; API, web and Postgres ports are closed on the host',
    async () => {
      const published = docker(['port', containerId('caddy')]);
      assert(
        /^80\/tcp -> /m.test(published) && /^443\/tcp -> /m.test(published),
        `caddy ports: ${published}`,
      );
      for (const port of [3000, 4000, 5432]) {
        const probe = spawnSync(
          'curl',
          ['-sS', '--noproxy', '*', '--max-time', '3', `http://127.0.0.1:${port}/`],
          {
            encoding: 'utf8',
            env: directEnv,
          },
        );
        assert(probe.status !== 0, `host port ${port} is open`);
      }
    },
  );

  await check(
    'RUNBOOK',
    'founder bootstrap works in the production image (Argon2 on musl, read-only FS)',
    async () => {
      const password = `smoke ${randomBytes(12).toString('hex')} passphrase`;
      const run = (email) =>
        spawnSync(
          'docker',
          compose(
            'run',
            '--rm',
            '-T',
            '-e',
            `FOUNDER_EMAIL=${email}`,
            'api',
            'node',
            'dist/cli/bootstrap-founder.js',
            '--production',
          ),
          { cwd: root, encoding: 'utf8', input: `${password}\n` },
        );
      const first = run('founder@nalara.test');
      assert(
        first.status === 0 && first.stdout.includes('founder created'),
        `bootstrap failed: ${first.stdout}${first.stderr}`,
      );
      assert(!`${first.stdout}${first.stderr}`.includes(password), 'password printed');
      const second = run('other@nalara.test');
      assert(second.status === 2, `second bootstrap exit ${String(second.status)}`);
      const login = spawnSync(
        'curl',
        [
          '-sS',
          '--max-time',
          '10',
          '--resolve',
          `${SITE}:443:127.0.0.1`,
          '--cacert',
          caFile,
          '-o',
          '/dev/null',
          '-w',
          '%{http_code}',
          '-H',
          `Origin: https://${SITE}`,
          '-H',
          'content-type: application/json',
          '--data',
          JSON.stringify({ email: 'founder@nalara.test', password }),
          `https://${SITE}/api/v1/auth/login`,
        ],
        { encoding: 'utf8', env: directEnv },
      );
      assert(login.stdout === '200', `login through the proxy answered ${login.stdout}`);
    },
  );

  await check('TEST-COMPOSE-07', 'container stop is graceful', async () => {
    docker(compose('stop', 'api'));
    assert(
      inspect('api', '{{.State.ExitCode}}') === '0',
      `api exit code ${inspect('api', '{{.State.ExitCode}}')}`,
    );
    assert(
      docker(compose('logs', 'api')).includes('shutting down'),
      'api did not log a graceful shutdown',
    );
    assert(
      inspect('web', '{{.State.Health.Status}}') === 'healthy',
      'web unhealthy while api stopped',
    );
    docker(compose('start', 'api'));
    await waitHealthy(['api']);
  });

  await check('TEST-COMPOSE-08', 'a crashed process is restarted automatically', async () => {
    const before = Number(inspect('api', '{{.RestartCount}}'));
    exec('api', 'kill', '1');
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && Number(inspect('api', '{{.RestartCount}}')) === before)
      await sleep(500);
    assert(Number(inspect('api', '{{.RestartCount}}')) === before + 1, 'api was not restarted');
    await waitHealthy(['api']);
  });
} finally {
  tryDocker(compose('down', '-v', '--remove-orphans'));
  rmSync(workDir, { recursive: true, force: true });
}

for (const result of results) {
  console.info(
    `${result.status.padEnd(4)} ${result.id.padEnd(16)} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  );
}
const failed = results.filter((result) => result.status !== 'PASS').length;
console.info(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 && results.length > 0 ? 0 : 1);
