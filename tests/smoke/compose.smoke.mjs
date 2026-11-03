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
writeFileSync(
  envFile,
  Object.entries(secrets)
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
  docker(compose('up', '-d', 'api', 'web'));

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
