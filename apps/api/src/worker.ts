// Worker process entry point (P2-02, PRD v4 §5). Separate from the API: its own database role
// (nalara_worker), no HTTP port, no session or MFA secrets. Handlers: feed_check (P2-03b) and
// feed_fetch with its scheduler (P2-04). SIGTERM/SIGINT stop claiming and let the job in hand
// finish.
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { ConfigError, loadTelegramBotConfig, loadWorkerConfig } from './config/env.ts';
import { notifyPendingProposals } from './modules/telegram/bot.ts';
import { createDatabase } from './db/client.ts';
import { evidenceSnapshotHandler } from './worker/handlers/evidence-snapshot.ts';
import { feedCheckHandler } from './worker/handlers/feed-check.ts';
import { feedFetchHandler, scheduleDueFeeds } from './worker/handlers/feed-fetch.ts';
import { startWorker } from './worker/runner.ts';
import type { WorkerLog } from './worker/runner.ts';

/** The container healthcheck looks at this file's age (it lives on the /tmp tmpfs). */
export const HEARTBEAT_FILE = '/tmp/nalara-worker.alive';

function line(level: string, fields: Record<string, unknown>, msg: string): void {
  process.stdout.write(
    `${JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields })}\n`,
  );
}

const log: WorkerLog = {
  info: (fields, msg) => {
    line('info', fields, msg);
  },
  warn: (fields, msg) => {
    line('warn', fields, msg);
  },
};

function main(): void {
  let config;
  let telegram;
  try {
    config = loadWorkerConfig(process.env);
    telegram = loadTelegramBotConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      line('fatal', { issues: error.issues }, 'invalid configuration, refusing to start');
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  const database = createDatabase(config.databaseUrl, { max: 2 });
  const workerId = `${hostname()}-${String(process.pid)}`.slice(0, 100);
  const worker = startWorker(database.db, {
    workerId,
    handlers: {
      feed_check: feedCheckHandler(database.db),
      feed_fetch: feedFetchHandler(database.db),
      evidence_snapshot: evidenceSnapshotHandler(database.db),
    },
    onBeat: () => {
      try {
        writeFileSync(HEARTBEAT_FILE, new Date().toISOString());
      } catch {
        // No writable /tmp: the healthcheck reports it.
      }
    },
    log,
  });
  line('info', { worker: workerId }, 'worker started');

  // Feed scheduler (P2-04): queue due feeds every minute. Several workers may run this; the
  // queue's one-active-job rule keeps each feed queued at most once.
  const scheduler = setInterval(() => {
    scheduleDueFeeds(database.db)
      .then((queued) => {
        if (queued > 0) line('info', { queued }, 'feeds queued');
      })
      .catch(() => {
        line('warn', {}, 'feed scheduling failed; database unavailable?');
      });
  }, 60_000);

  // Founder Telegram bot (P3-04): a message with Setujui/Tolak buttons per new agent proposal.
  // Off until TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set (D-26).
  let notifying = false;
  const notifier =
    telegram === null
      ? undefined
      : setInterval(() => {
          if (notifying) return;
          notifying = true;
          notifyPendingProposals(database.db, telegram)
            .then(({ sent, failed }) => {
              if (sent > 0 || failed !== null) line('info', { sent, failed }, 'telegram notify');
            })
            .catch(() => {
              line('warn', {}, 'telegram notify failed; database unavailable?');
            })
            .finally(() => {
              notifying = false;
            });
        }, 60_000);
  line('info', { telegram: telegram === null ? 'off' : 'on' }, 'telegram notifications');

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    line('info', { signal }, 'shutting down');
    clearInterval(scheduler);
    if (notifier !== undefined) clearInterval(notifier);
    void worker
      .stop()
      .then(() => database.close())
      .then(() => {
        process.exitCode = 0;
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main();
