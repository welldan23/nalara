// Worker side of Kartu IG to Telegram (P5-04b). Sends each queued post as an album (the cards, in
// order), then the caption as its own plain-text message so the founder can copy it in one tap.
// Two steps, each recorded: if the caption fails after the album went out, the next run sends
// only the caption, never the album twice. After a few failures a post is left for the OS.
import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { cardOutbox } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { TelegramError, callBot, callBotUpload } from '../telegram/bot.ts';
import type { BotOptions } from '../telegram/bot.ts';

type Db = NodePgDatabase<typeof schema>;

export const MAX_ATTEMPTS = 10;
/** A post older than this is stale: the founder has the cards in the OS anyway. */
const FRESH_FOR = sql`interval '3 days'`;

export function albumCaption(title: string, count: number): string {
  return [
    `Kartu IG siap posting: ${title}`,
    `${String(count)} gambar. Simpan semuanya, lalu salin caption di pesan berikutnya.`,
  ].join('\n');
}

export async function notifyCardPosts(
  db: Db,
  options: BotOptions,
  limit = 2,
): Promise<{ sent: number; failed: string | null }> {
  const rows = await db
    .select({
      id: cardOutbox.id,
      title: cardOutbox.title,
      caption: cardOutbox.caption,
      slides: cardOutbox.slides,
      albumSentAt: cardOutbox.albumSentAt,
      attempts: cardOutbox.attempts,
    })
    .from(cardOutbox)
    .where(
      and(
        isNull(cardOutbox.sentAt),
        lt(cardOutbox.attempts, MAX_ATTEMPTS),
        gt(cardOutbox.createdAt, sql`now() - ${FRESH_FOR}`),
      ),
    )
    .orderBy(asc(cardOutbox.createdAt))
    .limit(limit);

  let sent = 0;
  let failed: string | null = null;
  for (const row of rows) {
    try {
      if (row.albumSentAt === null && row.slides.length > 0) {
        await sendAlbum(options, row.title, row.slides);
        await db
          .update(cardOutbox)
          .set({ albumSentAt: sql`now()` })
          .where(eq(cardOutbox.id, row.id));
      }
      await callBot(options, 'sendMessage', {
        chat_id: options.chatId,
        text: row.caption,
        disable_web_page_preview: true,
      });
      // The images are not kept once delivered: the OS renders them again on demand.
      await db
        .update(cardOutbox)
        .set({ sentAt: sql`now()`, slides: [] })
        .where(eq(cardOutbox.id, row.id));
      sent += 1;
    } catch (error) {
      if (!(error instanceof TelegramError)) throw error;
      failed = error.code;
      await db
        .update(cardOutbox)
        .set({ attempts: row.attempts + 1, lastError: error.code.slice(0, 100) })
        .where(eq(cardOutbox.id, row.id));
    }
  }
  return { sent, failed };
}

async function sendAlbum(
  options: BotOptions,
  title: string,
  slides: readonly Buffer[],
): Promise<void> {
  const files = slides.map((data, index) => ({
    field: `card${String(index + 1)}`,
    filename: `nalara-${String(index + 1).padStart(2, '0')}.png`,
    contentType: 'image/png',
    data,
  }));
  const caption = albumCaption(title, slides.length);
  if (files.length === 1) {
    await callBotUpload(
      options,
      'sendPhoto',
      { chat_id: String(options.chatId), photo: 'attach://card1', caption },
      files,
    );
    return;
  }
  // A Telegram album holds 2 to 10 items; the deck has at most 7.
  const media = files.slice(0, 10).map((file, index) => ({
    type: 'photo',
    media: `attach://${file.field}`,
    ...(index === 0 ? { caption } : {}),
  }));
  await callBotUpload(
    options,
    'sendMediaGroup',
    { chat_id: String(options.chatId), media: JSON.stringify(media) },
    files.slice(0, 10),
  );
}
