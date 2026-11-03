// Backup / restore drill (PRD §14 TEST-BACKUP-01..10) against throwaway containers.
//
//   pnpm run test:backup
//
// Needs docker, age and age-keygen on the host. Creates and removes its own containers, keys
// and files; never touches a real database.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scripts = join(root, 'infra', 'scripts');
const IMAGE =
  'postgres:18.6-alpine3.24@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5';
const tag = randomBytes(3).toString('hex');
const source = `nalara-backup-src-${tag}`;
const restored = `nalara-backup-restore-${tag}`;
const work = mkdtempSync(join(tmpdir(), 'nalara-backup-'));
const backupDir = join(work, 'backups');
const hex = () => randomBytes(24).toString('hex');
const migratorPassword = hex();
const port = String(20_000 + Math.floor(Math.random() * 20_000));
const FOUNDER = `founder-${tag}@nalara.test`;

const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...options });
const must = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...options }).trim();
const psql = (container, sql) =>
  must('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'nalara', '-At', '-c', sql]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scriptEnv = (extra) => ({ ...process.env, BACKUP_DIR: backupDir, ...extra });

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
  // Source database prepared exactly like production: db/init roles + migrations + data.
  must('docker', [
    'run',
    '-d',
    '--name',
    source,
    '-p',
    `127.0.0.1:${port}:5432`,
    '-e',
    `POSTGRES_PASSWORD=${hex()}`,
    '-e',
    `DB_MIGRATOR_PASSWORD=${migratorPassword}`,
    '-e',
    `DB_APP_PASSWORD=${hex()}`,
    '-v',
    `${join(root, 'db', 'init')}:/docker-entrypoint-initdb.d:ro`,
    IMAGE,
  ]);
  for (let i = 0; i < 60; i += 1) {
    if (
      run('docker', ['exec', source, 'psql', '-U', 'postgres', '-d', 'nalara', '-c', 'select 1'])
        .status === 0
    )
      break;
    await sleep(1_000);
  }
  const migrate = run(process.execPath, ['src/db/migrate-cli.ts'], {
    cwd: join(root, 'apps', 'api'),
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'test',
      DATABASE_MIGRATOR_URL: `postgres://nalara_migrator:${migratorPassword}@127.0.0.1:${port}/nalara`,
    },
  });
  if (migrate.status !== 0) throw new Error(`migrate failed: ${migrate.stdout}${migrate.stderr}`);
  psql(
    source,
    `INSERT INTO users (email, password_hash, role) VALUES ('${FOUNDER}', '$argon2id$fixture', 'founder')`,
  );
  psql(
    source,
    `INSERT INTO audit_events (actor_type, action, result) SELECT 'system', 'founder.bootstrap', 'success' FROM generate_series(1, 25)`,
  );

  for (const name of ['key', 'other'])
    must('age-keygen', ['-o', join(work, `${name}.txt`)], { stdio: 'pipe' });
  writeFileSync(join(work, 'key.pub'), must('age-keygen', ['-y', join(work, 'key.txt')]) + '\n');

  const backup = run('bash', [join(scripts, 'backup.sh')], {
    cwd: root,
    env: scriptEnv({
      AGE_RECIPIENTS_FILE: join(work, 'key.pub'),
      PG_EXEC: `docker exec -i ${source}`,
    }),
  });
  const archives = () => readdirSync(backupDir).filter((name) => name.endsWith('.dump.age'));
  const archive = join(backupDir, archives()[0] ?? 'missing');

  await check(
    'TEST-BACKUP-01',
    'backup is created atomically with a timestamped name',
    async () => {
      assert(backup.status === 0, `backup.sh failed: ${backup.stderr}`);
      assert(
        /^nalara-\d{8}T\d{6}Z\.dump\.age$/.test(archives()[0] ?? ''),
        `archives: ${archives().join(',')}`,
      );
      assert(
        !readdirSync(backupDir).some((name) => name.endsWith('.partial')),
        'partial file left behind',
      );
      assert(statSync(archive).size > 1_000, 'archive is suspiciously small');
    },
  );

  await check('TEST-BACKUP-02', 'archive is age-encrypted and contains no plaintext', async () => {
    const bytes = readFileSync(archive);
    assert(bytes.subarray(0, 21).toString() === 'age-encryption.org/v1', 'missing age header');
    for (const marker of ['PGDMP', 'audit_events', 'nalara_schema_migrations', FOUNDER]) {
      assert(!bytes.includes(Buffer.from(marker)), `plaintext marker found: ${marker}`);
    }
  });

  await check('TEST-BACKUP-09', 'archive is 0600 and the backup directory is 0700', async () => {
    assert(
      (statSync(archive).mode & 0o777) === 0o600,
      `archive mode ${(statSync(archive).mode & 0o777).toString(8)}`,
    );
    assert(
      (statSync(backupDir).mode & 0o777) === 0o700,
      `dir mode ${(statSync(backupDir).mode & 0o777).toString(8)}`,
    );
  });

  await check('TEST-BACKUP-03', 'the wrong key is rejected and nothing is created', async () => {
    const attempt = run('bash', [
      join(scripts, 'restore.sh'),
      archive,
      join(work, 'other.txt'),
      `${restored}-wrong`,
    ]);
    assert(attempt.status === 2, `exit ${String(attempt.status)}: ${attempt.stderr}`);
    assert(
      run('docker', ['inspect', `${restored}-wrong`]).status !== 0,
      'a restore container was created',
    );
  });

  await check(
    'TEST-BACKUP-07',
    'a corrupted archive is rejected before anything is restored',
    async () => {
      const corrupted = join(work, 'corrupted.dump.age');
      const bytes = Buffer.from(readFileSync(archive));
      bytes[bytes.length - 100] = (bytes[bytes.length - 100] ?? 0) ^ 0xff;
      writeFileSync(corrupted, bytes, { mode: 0o600 });
      const attempt = run('bash', [
        join(scripts, 'restore.sh'),
        corrupted,
        join(work, 'key.txt'),
        `${restored}-bad`,
      ]);
      assert(attempt.status === 2, `exit ${String(attempt.status)}: ${attempt.stderr}`);
      assert(
        run('docker', ['inspect', `${restored}-bad`]).status !== 0,
        'a restore container was created',
      );
    },
  );

  const sourceBefore = psql(source, 'SELECT count(*) FROM audit_events');
  const restore = run('bash', [
    join(scripts, 'restore.sh'),
    archive,
    join(work, 'key.txt'),
    restored,
  ]);

  await check(
    'TEST-BACKUP-04',
    'restore goes to a new isolated container and leaves the source untouched',
    async () => {
      assert(restore.status === 0, `restore.sh failed: ${restore.stderr}`);
      assert(
        must('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', restored]) === 'none',
        'restore container has a network',
      );
      assert(
        must('docker', ['inspect', '-f', '{{.Id}}', restored]) !==
          must('docker', ['inspect', '-f', '{{.Id}}', source]),
        'same container',
      );
      assert(
        psql(source, 'SELECT count(*) FROM audit_events') === sourceBefore,
        'source database changed',
      );
    },
  );

  await check(
    'TEST-BACKUP-05',
    'restored schema matches: tables, migrations, constraints, grants',
    async () => {
      const tables = psql(
        restored,
        `SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      assert(
        tables ===
          psql(
            source,
            `SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'public'`,
          ),
        `tables: ${tables}`,
      );
      assert(
        psql(restored, 'SELECT count(*) FROM nalara_schema_migrations') ===
          String(
            readdirSync(join(root, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).length,
          ),
        'migration rows differ',
      );
      assert(
        psql(
          restored,
          `SELECT count(*) FROM pg_indexes WHERE indexname = 'users_single_founder'`,
        ) === '1',
        'single-founder index missing',
      );
      assert(
        psql(
          restored,
          `SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE grantee = 'nalara_app' AND table_name = 'audit_events'`,
        ) === 'INSERT,SELECT',
        'audit grants differ',
      );
    },
  );

  await check('TEST-BACKUP-06', 'restored data matches the source', async () => {
    assert(psql(restored, `SELECT email FROM users`) === FOUNDER, 'founder missing');
    assert(
      psql(restored, 'SELECT count(*) FROM audit_events') === sourceBefore,
      'audit rows differ',
    );
  });

  await check(
    'TEST-BACKUP-08',
    'retention keeps 7 daily + 4 weekly; dry run deletes nothing',
    async () => {
      const dir = join(work, 'retention');
      mkdirSync(dir, { mode: 0o700 });
      const day = 24 * 60 * 60 * 1000;
      const base = Date.UTC(2026, 10, 3, 2, 0, 0);
      for (let i = 0; i < 60; i += 1) {
        const stamp = new Date(base - i * day)
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d+Z$/, 'Z');
        writeFileSync(join(dir, `nalara-${stamp}.dump.age`), 'x', { mode: 0o600 });
        if (i < 3)
          writeFileSync(join(dir, `nalara-${stamp.replace('T02', 'T01')}.dump.age`), 'x', {
            mode: 0o600,
          });
      }
      writeFileSync(join(dir, 'unrelated.txt'), 'keep me');
      const total = readdirSync(dir).length;
      const dry = run('bash', [join(scripts, 'prune.sh')], { env: scriptEnv({ BACKUP_DIR: dir }) });
      assert(dry.status === 0 && readdirSync(dir).length === total, 'dry run deleted files');
      assert(/would delete/.test(dry.stdout), 'dry run listed nothing');
      const applied = run('bash', [join(scripts, 'prune.sh'), '--apply'], {
        env: scriptEnv({ BACKUP_DIR: dir }),
      });
      const left = readdirSync(dir)
        .filter((name) => name.endsWith('.dump.age'))
        .sort();
      assert(applied.status === 0 && left.length === 11, `kept ${String(left.length)} archives`);
      assert(left.at(-1)?.startsWith('nalara-20261103T02'), 'newest backup was not kept');
      assert(readdirSync(dir).includes('unrelated.txt'), 'unrelated file deleted');
    },
  );

  await check('TEST-BACKUP-10', 'freshness check alerts on missing and stale backups', async () => {
    const empty = join(work, 'empty');
    mkdirSync(empty);
    assert(
      run('bash', [join(scripts, 'check-backup-age.sh')], { env: scriptEnv({ BACKUP_DIR: empty }) })
        .status === 1,
      'no alert for missing backups',
    );
    assert(
      run('bash', [join(scripts, 'check-backup-age.sh')], { env: scriptEnv({}) }).status === 0,
      'alert for a fresh backup',
    );
    must('touch', ['-d', '3 days ago', archive]);
    const stale = run('bash', [join(scripts, 'check-backup-age.sh')], { env: scriptEnv({}) });
    assert(stale.status === 1 && /ALERT/.test(stale.stderr), 'no alert for a stale backup');
  });
} finally {
  for (const name of [source, restored, `${restored}-wrong`, `${restored}-bad`])
    run('docker', ['rm', '-f', name]);
  rmSync(work, { recursive: true, force: true });
}

for (const result of results) {
  console.info(
    `${result.status.padEnd(4)} ${result.id.padEnd(15)} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`,
  );
}
const failed = results.filter((result) => result.status !== 'PASS').length;
console.info(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 && results.length === 10 ? 0 : 1);
