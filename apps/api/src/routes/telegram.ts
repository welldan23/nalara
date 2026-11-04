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
// - Replies go back in the webhook response itself (Telegram's "method in response"), so the API
//   still never makes an outbound request.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import type { TelegramWebhookConfig } from '../config/env.ts';
import { users } from '../db/schema.ts';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { recordAudit } from '../modules/audit/audit.ts';
import { getAiSettings, stopAi } from '../modules/agent/settings.ts';
import { countPendingProposals, decideProposal } from '../modules/proposals/proposals.ts';
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

export function telegramRoutes(
  app: FastifyInstance,
  options: { readonly db: Db; readonly telegram: TelegramWebhookConfig },
): Promise<void> {
  const { db, telegram } = options;
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
      return reply('Perintah: /status, /stop. Usulan diputuskan lewat tombol di pesannya.');
    }
    return {};
  });
  return Promise.resolve();
}
