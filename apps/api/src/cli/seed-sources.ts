// Adds the starter source list as CANDIDATES (modules/sources/starter.ts).
//
//   pnpm --filter @nalara/api run sources:seed
//   In production: `sudo nalara sources-seed` (runs `node dist/cli/seed-sources.js` in the API image)
//
// - Created exactly as the founder would in the OS (same validation, audit entry "source.create").
// - Safe to run again: a source whose page or feed already exists is skipped, never changed.
// - Nothing is fetched until the founder verifies each source in NALARA OS → Sumber.
import { eq } from 'drizzle-orm';
import { ConfigError, loadAdminCliConfig } from '../config/env.ts';
import { createDatabase } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { seedStarterSources } from '../modules/sources/starter.ts';

function log(level: 'info' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra });
  if (level === 'error') console.error(line);
  else console.info(line);
}

async function main(): Promise<number> {
  const config = loadAdminCliConfig(process.env);
  const database = createDatabase(config.databaseUrl, {
    max: 1,
    applicationName: 'nalara-seed-sources',
  });
  try {
    const [founder] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'founder'));
    if (founder === undefined) {
      log('error', 'no founder account yet: run `sudo nalara founder <email>` first');
      return 1;
    }
    const { added, skipped } = await seedStarterSources(database.db, founder.id);
    log('info', 'starter sources', { added: added.length, skipped: skipped.length });
    for (const name of added) console.info(`+ ${name}`);
    for (const name of skipped) console.info(`= ${name} (sudah ada)`);
    console.info('Verifikasi tiap sumber di NALARA OS → Sumber, lalu tekan "Cek feed".');
    return 0;
  } finally {
    await database.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    log('error', error instanceof ConfigError ? 'invalid configuration' : 'seed failed', {
      code: (error as { code?: unknown }).code,
      issues: error instanceof ConfigError ? error.issues : undefined,
    });
    process.exitCode = 1;
  });
