// Founder Telegram bot setup (P3-04, D-26). Run inside the worker container, which holds the bot
// token and has internet egress:
//
//   docker compose -f compose.prod.yaml exec worker node dist/cli/telegram-setup.js ids
//       After you send /start to your bot: prints the numeric user id and chat id to put in
//       TELEGRAM_FOUNDER_USER_ID and TELEGRAM_CHAT_ID (ids, not secrets).
//   ... telegram-setup.js set-webhook
//       Points the bot at https://<APP_BASE_URL>/api/v1/telegram/webhook with the webhook secret.
//   ... telegram-setup.js info
//       Shows the webhook state (URL, pending updates, last error), never the token.
import { loadTelegramBotConfig, ConfigError } from '../config/env.ts';
import { callBot } from '../modules/telegram/bot.ts';

function log(level: 'info' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra });
  if (level === 'error') console.error(line);
  else console.info(line);
}

async function main(): Promise<number> {
  const command = process.argv[2];
  // `ids` runs before the chat id is known, so a placeholder chat id is accepted there.
  const bot = loadTelegramBotConfig({
    ...process.env,
    // `ids` runs before the chat id is known; compose passes an empty value then.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty means unset
    TELEGRAM_CHAT_ID: process.env['TELEGRAM_CHAT_ID'] || '0',
  });
  if (bot === null) {
    log('error', 'TELEGRAM_BOT_TOKEN is not set');
    return 1;
  }
  switch (command) {
    case 'ids': {
      const updates = (await callBot(bot, 'getUpdates', { limit: 20 })) as {
        message?: { from?: { id: number; username?: string }; chat: { id: number } };
      }[];
      for (const update of updates) {
        if (update.message?.from !== undefined) {
          log('info', 'message seen', {
            userId: update.message.from.id,
            chatId: update.message.chat.id,
          });
        }
      }
      if (updates.length === 0) log('info', 'no messages yet: send /start to your bot, then retry');
      return 0;
    }
    case 'set-webhook': {
      const secret = process.env['TELEGRAM_WEBHOOK_SECRET'];
      const base = process.env['APP_BASE_URL'];
      if (secret === undefined || !base?.startsWith('https://')) {
        log('error', 'needs TELEGRAM_WEBHOOK_SECRET and an https APP_BASE_URL');
        return 1;
      }
      await callBot(bot, 'setWebhook', {
        url: `${new URL(base).origin}/api/v1/telegram/webhook`,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      });
      log('info', 'webhook set');
      return 0;
    }
    case 'info': {
      const info = (await callBot(bot, 'getWebhookInfo', {})) as Record<string, unknown>;
      log('info', 'webhook info', {
        url: info['url'],
        pending: info['pending_update_count'],
        lastError: info['last_error_message'] ?? null,
      });
      return 0;
    }
    default:
      log('error', 'usage: telegram-setup ids | set-webhook | info');
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    log('error', error instanceof ConfigError ? 'invalid configuration' : 'telegram setup failed', {
      code: (error as { code?: unknown }).code,
      issues: error instanceof ConfigError ? error.issues : undefined,
    });
    process.exitCode = 1;
  });
