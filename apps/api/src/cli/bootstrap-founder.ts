// One-time founder bootstrap (P0-007, PRD B §6.1).
//
//   FOUNDER_EMAIL=you@example.com pnpm --filter @nalara/api run founder:bootstrap
//
// - The password is read from the terminal without echo (or from stdin when piped), never from
//   argv or environment, which other processes and logs can see.
// - Refuses if a founder already exists (never overwrites). Exit code 2.
// - Refuses NODE_ENV=production unless --production is passed explicitly. Exit code 2.
// - There is no HTTP equivalent of this command.
import { stdin, stdout } from 'node:process';
import { ConfigError, loadBootstrapConfig } from '../config/env.ts';
import { createDatabase } from '../db/client.ts';
import { FounderExistsError, createFounder } from '../modules/auth/founder.ts';
import { hashPassword, passwordPolicyIssues } from '../modules/auth/password.ts';

const EXIT_ERROR = 1;
const EXIT_REFUSED = 2;
const ALLOWED_FLAGS = new Set(['--production']);

function log(level: 'info' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra });
  if (level === 'error') console.error(line);
  else console.info(line);
}

async function readHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('cancelled'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

async function readPiped(): Promise<string> {
  let data = '';
  stdin.setEncoding('utf8');
  for await (const chunk of stdin) data += String(chunk);
  return data.split(/\r?\n/)[0] ?? '';
}

async function readPassword(): Promise<string | undefined> {
  if (!stdin.isTTY) return readPiped();
  const first = await readHidden('Founder password: ');
  const second = await readHidden('Repeat password: ');
  return first === second ? first : undefined;
}

async function main(): Promise<number> {
  const flags = process.argv.slice(2);
  const unknown = flags.filter((flag) => !ALLOWED_FLAGS.has(flag));
  if (unknown.length > 0) {
    log('error', 'unknown arguments (the password is never accepted as an argument)', {
      count: unknown.length,
    });
    return EXIT_ERROR;
  }

  const config = loadBootstrapConfig(process.env);
  if (config.nodeEnv === 'production' && !flags.includes('--production')) {
    log('error', 'refusing to bootstrap in production without the explicit --production flag');
    return EXIT_REFUSED;
  }

  const password = await readPassword();
  if (password === undefined) {
    log('error', 'passwords did not match');
    return EXIT_ERROR;
  }
  const issues = passwordPolicyIssues(password, config.founderEmail);
  if (issues.length > 0) {
    log('error', 'password rejected by policy', { issues });
    return EXIT_ERROR;
  }

  const passwordHash = await hashPassword(password);
  const database = createDatabase(config.databaseUrl, {
    max: 1,
    applicationName: 'nalara-bootstrap',
  });
  try {
    const founder = await createFounder(database.db, { email: config.founderEmail, passwordHash });
    log('info', 'founder created; enrol MFA at first login', { userId: founder.id });
    return 0;
  } catch (error) {
    if (error instanceof FounderExistsError) {
      log('error', error.message);
      return EXIT_REFUSED;
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
      log('error', 'bootstrap failed', {
        error: error instanceof Error ? error.name : 'unknown',
        code: typeof code === 'string' ? code : undefined,
      });
    }
    process.exitCode = EXIT_ERROR;
  });
