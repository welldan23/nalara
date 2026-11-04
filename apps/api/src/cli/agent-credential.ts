// Agent gateway credentials (P3-02, ADR-020).
//
//   pnpm --filter @nalara/api run agent:credential create <label>   prints the token ONCE
//   pnpm --filter @nalara/api run agent:credential revoke <label>
//   pnpm --filter @nalara/api run agent:credential list
//
// In production (inside the API container): `node dist/cli/agent-credential.js create runner`.
// The token goes to the agent runner's AGENT_TOKEN and nowhere else: not into chat, git or logs.
// Only its SHA-256 is stored. Revoking is final; create a new credential to rotate.
import { ConfigError, loadAdminCliConfig } from '../config/env.ts';
import { createDatabase } from '../db/client.ts';
import {
  CredentialLabelError,
  createCredential,
  listCredentials,
  revokeCredential,
} from '../modules/agent/credentials.ts';

const EXIT_ERROR = 1;

function log(level: 'info' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra });
  if (level === 'error') console.error(line);
  else console.info(line);
}

async function main(): Promise<number> {
  const [command, label, ...rest] = process.argv.slice(2);
  if (rest.length > 0 || (command !== 'list' && label === undefined)) {
    log('error', 'usage: agent:credential create <label> | revoke <label> | list');
    return EXIT_ERROR;
  }
  const config = loadAdminCliConfig(process.env);
  const database = createDatabase(config.databaseUrl, {
    max: 1,
    applicationName: 'nalara-agent-credential',
  });
  try {
    switch (command) {
      case 'create': {
        const created = await createCredential(database.db, label ?? '');
        log('info', 'agent credential created; the token below is shown only now', {
          label: created.label,
        });
        // The token alone on its own line, so it can be piped straight into a secrets file.
        process.stdout.write(`${created.token}\n`);
        return 0;
      }
      case 'revoke':
        await revokeCredential(database.db, label ?? '');
        log('info', 'agent credential revoked', { label });
        return 0;
      case 'list':
        for (const row of await listCredentials(database.db)) {
          log('info', 'agent credential', {
            label: row.label,
            createdAt: row.createdAt.toISOString(),
            lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
            revoked: row.revokedAt !== null,
          });
        }
        return 0;
      default:
        log('error', 'usage: agent:credential create <label> | revoke <label> | list');
        return EXIT_ERROR;
    }
  } catch (error) {
    if (error instanceof CredentialLabelError) {
      log('error', error.message);
      return EXIT_ERROR;
    }
    throw error;
  } finally {
    await database.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof ConfigError) {
      log('error', 'invalid configuration', { issues: error.issues });
    } else {
      const code = (error as { code?: unknown }).code;
      log('error', 'agent credential command failed', {
        error: error instanceof Error ? error.name : 'unknown',
        code: typeof code === 'string' ? code : undefined,
      });
    }
    process.exitCode = EXIT_ERROR;
  });
