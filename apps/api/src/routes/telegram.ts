// The founder's Telegram bot, receiving side (P3-04, PRD v4 §11 Fase 3):
//
//   POST /api/v1/telegram/webhook    (Telegram → NALARA, through the edge proxy)
//
// - Telegram must send the webhook secret in X-Telegram-Bot-Api-Secret-Token (compared in
//   constant time); anything else is 401.
// - Only the founder's numeric user id, in the configured chat, is acted on. Updates from anyone
//   else are answered with an empty 200 (no information) and audited as denied.
// - A button carries `a:<token>` or `r:<token>`. The token is consumed atomically (single use,
//   expiring, bound to its proposal and decision), then the proposal is decided exactly as in the
//   OS, with channel `telegram`. Replays, expired and foreign tokens are refused.
// - `/stop` is the kill switch; `/status` reports the switch and the pending count.
// - Fast edits (P5-04): "lihat N", "judul N: ...", "ringkas N: ...", "lewati N" (stories/chat.ts).
// - Replies go back in the webhook response itself (Telegram's "method in response"), so the API
//   still never makes an outbound request.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import type { TelegramWebhookConfig } from '../config/env.ts';
import { storyQueue, users } from '../db/schema.ts';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { recordAudit } from '../modules/audit/audit.ts';
import { getAiSettings, stopAi } from '../modules/agent/settings.ts';
import { countPendingProposals, decideProposal } from '../modules/proposals/proposals.ts';
import {
  editStory,
  parseChatCommand,
  skipStoryFromChat,
  viewStory,
} from '../modules/stories/chat.ts';
import { consumeStoryToken, decideStory } from '../modules/stories/telegram.ts';
import { consumeToken } from '../modules/telegram/tokens.ts';

type Db = NodePgDatabase<typeof schema>;

const id = z.number().int();
const updateSchema = z.object({
  callback_query: z
    .object({
      id: z.string().max(100),
      from: z.object({ id }),
      message: z.object({ chat: z.object({ id }) }).optional(),
      data: z.string().max(64).optional(),
    })
    .optional(),
  message: z
    .object({
      from: z.object({ id }).optional(),
      chat: z.object({ id }),
      text: z.string().max(4096).optional(),
    })
    .optional(),
});

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

const OUTCOME_TEXT: Readonly<Record<string, string>> = {
  approved: 'Disetujui dan diterapkan.',
  rejected: 'Ditolak.',
  failed: 'Disetujui, tapi gagal diterapkan (datanya sudah berubah). Cek di NALARA OS.',
};

const STORY_REFUSALS: Readonly<Record<string, string>> = {
  VERSION_CONFLICT: 'Draft sudah berubah sejak pesan dikirim. Cek dan terbitkan dari NALARA OS.',
  INVALID_TRANSITION: 'Cerita ini sudah diputuskan.',
  GATE_BLOCKED: 'Gerbang terbit menolak draft ini. Buka NALARA OS untuk melihat alasannya.',
  FORBIDDEN: 'Cerita ini harus dicek dan diterbitkan dari NALARA OS.',
};

const CHAT_REFUSALS: Readonly<Record<string, string>> = {
  NOT_FOUND: 'Nomor usulan itu tidak ada.',
  INVALID_TRANSITION:
    'Usulan itu sudah tidak bisa diubah dari chat (sudah terbit, dilewati, atau sedang diedit di OS).',
  VALIDATION_FAILED: 'Teksnya tidak diterima (kosong atau terlalu panjang). Coba lagi.',
  VERSION_CONFLICT: 'Draft baru saja berubah. Kirim ulang perintahnya.',
  NOT_EDITABLE: 'Draft ini sedang dalam alur terbit. Ubah dari NALARA OS.',
};

const HELP = [
  'Perintah:',
  '/status, /stop',
  'lihat 12 — lihat usulan #12',
  'judul 12: teks baru — ganti judul',
  'ringkas 12: teks baru — ganti ringkasan (juga pembuka caption IG)',
  'lewati 12 — lewati usulan',
  'Terbit tetap lewat tombol ✅ di pesan usulan.',
].join('\n');

export function telegramRoutes(
  app: FastifyInstance,
  options: {
    readonly db: Db;
    readonly telegram: TelegramWebhookConfig;
    /** Called after a story is published from the chat (queues its Kartu IG). Must not throw. */
    readonly onPublished?: (articleId: string) => void;
  },
): Promise<void> {
  const { db, telegram, onPublished } = options;
  const expected = digest(telegram.secret);

  const audit = (outcome: string, result: 'success' | 'denied' | 'failure', requestId: string) =>
    recordAudit(db, {
      action: 'telegram.update',
      actorType: 'system',
      result,
      requestId,
      metadata: { outcome },
    });

  async function founder(): Promise<{ userId: string }> {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'founder'));
    if (row === undefined) throw new AppError('NOT_READY');
    return { userId: row.id };
  }

  app.post('/webhook', async (request) => {
    const header = request.headers['x-telegram-bot-api-secret-token'];
    if (typeof header !== 'string' || !timingSafeEqual(digest(header), expected)) {
      throw new AppError('UNAUTHORIZED');
    }
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return {};
    const { callback_query: callback, message } = parsed.data;

    if (callback !== undefined) {
      if (
        callback.from.id !== telegram.founderUserId ||
        callback.message?.chat.id !== telegram.chatId
      ) {
        await audit('foreign_user', 'denied', request.id);
        return {};
      }
      const answer = (text: string) => ({
        method: 'answerCallbackQuery',
        callback_query_id: callback.id,
        text,
        show_alert: true,
      });
      // Story packages (P5-03, D-32): `p:` publishes the shown revision, `s:` skips the story.
      const story = /^([ps]):(.{1,62})$/.exec(callback.data ?? '');
      if (story !== null) {
        const decision = story[1] === 'p' ? 'publish' : 'skip';
        const usedStory = await consumeStoryToken(db, story[2] ?? '', decision);
        if (usedStory === null) {
          await audit('token_refused', 'denied', request.id);
          return answer('Tombol ini sudah tidak berlaku. Buka NALARA OS → Usulan.');
        }
        try {
          const actor = { ...(await founder()), requestId: request.id };
          const outcome = await decideStory(db, actor, usedStory);
          await audit(`story_${outcome}`, 'success', request.id);
          if (outcome === 'published' && onPublished !== undefined) {
            const [story] = await db
              .select({ articleId: storyQueue.articleId })
              .from(storyQueue)
              .where(eq(storyQueue.id, usedStory.storyId));
            if (story?.articleId != null) onPublished(story.articleId);
          }
          return answer(
            outcome === 'published'
              ? 'Terbit. Sumber tercatat sudah kamu cek.'
              : 'Cerita ini dilewati.',
          );
        } catch (error) {
          if (error instanceof AppError) {
            await audit(`story_${error.code.toLowerCase()}`, 'failure', request.id);
            return answer(STORY_REFUSALS[error.code] ?? 'Tidak bisa diproses. Cek di NALARA OS.');
          }
          throw error;
        }
      }
      const match = /^([ar]):(.{1,62})$/.exec(callback.data ?? '');
      const claimed = match?.[1] === 'a' ? 'approve' : 'reject';
      const used = match?.[2] === undefined ? null : await consumeToken(db, match[2], claimed);
      if (used === null) {
        await audit('token_refused', 'denied', request.id);
        return answer('Tombol ini sudah tidak berlaku. Buka NALARA OS → Usulan.');
      }
      try {
        const actor = { ...(await founder()), requestId: request.id };
        const result = await decideProposal(db, actor, used.proposalId, used.decision, 'telegram');
        return answer(OUTCOME_TEXT[result.status] ?? 'Tersimpan.');
      } catch (error) {
        if (error instanceof AppError && error.code === 'INVALID_TRANSITION') {
          return answer('Usulan ini sudah diputuskan atau kedaluwarsa.');
        }
        throw error;
      }
    }

    if (message !== undefined) {
      if (message.from?.id !== telegram.founderUserId || message.chat.id !== telegram.chatId) {
        await audit('foreign_user', 'denied', request.id);
        return {};
      }
      const reply = (text: string) => ({ method: 'sendMessage', chat_id: telegram.chatId, text });
      const command = (message.text ?? '').trim().split(/\s+/)[0]?.replace(/@.*$/, '');
      if (command === '/stop') {
        await stopAi(db, { ...(await founder()), requestId: request.id });
        await audit('stop', 'success', request.id);
        return reply('AI dimatikan. Nyalakan lagi dari NALARA OS → Agent AI.');
      }
      if (command === '/status') {
        const [settings, pending] = await Promise.all([
          getAiSettings(db),
          countPendingProposals(db),
        ]);
        return reply(
          `AI ${settings.aiEnabled ? 'menyala' : 'mati'}. Usulan menunggu: ${String(pending)}.`,
        );
      }
      // Fast edits (P5-04): plain commands; the text after ":" is data, never instructions.
      const chat = parseChatCommand(message.text ?? '');
      if (chat !== null) {
        try {
          if (chat.kind === 'view') return reply(await viewStory(db, chat.number));
          const actor = { ...(await founder()), requestId: request.id };
          if (chat.kind === 'skip') {
            await skipStoryFromChat(db, chat.number);
            await audit('story_chat_skip', 'success', request.id);
            return reply(`Usulan #${String(chat.number)} dilewati.`);
          }
          await editStory(db, actor, chat);
          await audit(`story_chat_${chat.field}`, 'success', request.id);
          return reply(
            `${chat.field === 'title' ? 'Judul' : 'Ringkasan'} usulan #${String(chat.number)} diganti. ` +
              'Paket baru dengan tombol baru menyusul sebentar lagi; tombol lama tidak berlaku.',
          );
        } catch (error) {
          if (error instanceof AppError) {
            await audit(`story_chat_${error.code.toLowerCase()}`, 'failure', request.id);
            return reply(CHAT_REFUSALS[error.code] ?? 'Tidak bisa diproses. Cek di NALARA OS.');
          }
          throw error;
        }
      }
      return reply(HELP);
    }
    return {};
  });
  return Promise.resolve();
}
