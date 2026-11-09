// The founder's Telegram bot, sending side (P3-04). Runs in the worker (the only process with
// internet egress). Messages are plain text (no parse_mode), so agent-written text can never
// become markup or links that Telegram renders. The bot token is in the request path and never
// logged; failures surface as stable codes only.
import { randomBytes } from 'node:crypto';
import { and, asc, eq, notExists, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { aiActionProposals, approvalTokens } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { FetchBlocked, safeFetch } from '../fetch/safe-fetch.ts';
import type { SafeFetchOptions } from '../fetch/safe-fetch.ts';
import { issueTokens } from './tokens.ts';

type Db = NodePgDatabase<typeof schema>;

export interface BotOptions {
  readonly botToken: string;
  readonly chatId: number;
  /** Tests only: a local fake of api.telegram.org. */
  readonly apiBase?: string;
  readonly fetchOptions?: Pick<SafeFetchOptions, 'policy' | 'resolve' | 'ca' | 'ports'>;
}

export class TelegramError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`telegram: ${code}`);
    this.name = 'TelegramError';
    this.code = code;
  }
}

export async function callBot(
  options: BotOptions,
  method: string,
  body: unknown,
): Promise<unknown> {
  return send(options, method, { body, maxBytes: 256 * 1024, timeoutMs: 15_000 });
}

export interface BotFile {
  /** Form field name, referenced as attach://<field> in the JSON fields. Letters and digits. */
  readonly field: string;
  readonly filename: string;
  readonly contentType: string;
  readonly data: Buffer;
}

const FIELD = /^[A-Za-z0-9_]{1,64}$/;

/**
 * Uploads files (multipart/form-data) with plain fields, e.g. sendMediaGroup (P5-04b). Field
 * names and file names are this module's own constants, checked anyway so nothing can break out
 * of a part header.
 */
export async function callBotUpload(
  options: BotOptions,
  method: string,
  fields: Readonly<Record<string, string>>,
  files: readonly BotFile[],
): Promise<unknown> {
  const boundary = `nalara-${randomBytes(16).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (!FIELD.test(name)) throw new TelegramError('invalid_field');
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    );
  }
  for (const file of files) {
    if (!FIELD.test(file.field) || !/^[A-Za-z0-9_.-]{1,100}$/.test(file.filename)) {
      throw new TelegramError('invalid_field');
    }
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
      file.data,
      Buffer.from('\r\n', 'utf8'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return send(options, method, {
    rawBody: {
      data: Buffer.concat(parts),
      contentType: `multipart/form-data; boundary=${boundary}`,
    },
    maxBytes: 256 * 1024,
    timeoutMs: 60_000,
  });
}

async function send(
  options: BotOptions,
  method: string,
  request: Pick<SafeFetchOptions, 'body' | 'rawBody' | 'maxBytes' | 'timeoutMs'>,
): Promise<unknown> {
  let response;
  try {
    response = await safeFetch(
      `${options.apiBase ?? 'https://api.telegram.org'}/bot${options.botToken}/${method}`,
      {
        ...options.fetchOptions,
        ...request,
        method: 'POST',
        contentTypes: ['application/json'],
      },
    );
  } catch (error) {
    throw new TelegramError(error instanceof FetchBlocked ? `fetch:${error.reason}` : 'network');
  }
  let json: unknown;
  try {
    json = JSON.parse(response.body.toString('utf8'));
  } catch {
    throw new TelegramError('invalid_json');
  }
  if (response.status !== 200 || (json as { ok?: unknown }).ok !== true) {
    throw new TelegramError(`http_${String(response.status)}`);
  }
  return (json as { result?: unknown }).result;
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  'sources.propose_create': 'Tambah sumber baru (sebagai kandidat)',
  'sources.propose_update': 'Ubah data sumber',
  'preferences.propose_update': 'Ubah preferensi agent',
  'inbox.propose_flag': 'Tandai item inbox layak ditulis',
  'articles.propose_note': 'Catatan pemeriksaan draft',
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  radar: 'Radar',
  penulis: 'Penulis',
  pemeriksa: 'Pemeriksa',
  periset: 'Periset',
  pemantau: 'Pemantau',
};

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

export function proposalMessage(
  proposal: {
    kind: string;
    agentRole: string;
    reason: string;
  },
  expiresAt: Date,
): string {
  const reason =
    proposal.reason.length > 400 ? `${proposal.reason.slice(0, 400)}…` : proposal.reason;
  return [
    `Usulan baru dari agent ${ROLE_LABELS[proposal.agentRole] ?? proposal.agentRole}`,
    KIND_LABELS[proposal.kind] ?? proposal.kind,
    '',
    `Alasan agent (ditulis AI, baca dengan kritis): ${reason}`,
    '',
    `Tombol berlaku sampai ${dateFormat.format(expiresAt)} WIB. Detail lengkap ada di NALARA OS → Usulan.`,
  ].join('\n');
}

/**
 * Sends one message per pending proposal that has none yet (at most `limit` per run). The tokens
 * are stored in the same transaction as the send: if Telegram refuses, nothing is stored and the
 * proposal is tried again next run.
 */
export async function notifyPendingProposals(
  db: Db,
  options: BotOptions,
  limit = 5,
): Promise<{ sent: number; failed: string | null }> {
  const pending = await db
    .select({
      id: aiActionProposals.id,
      kind: aiActionProposals.kind,
      agentRole: aiActionProposals.agentRole,
      reason: aiActionProposals.reason,
      expiresAt: aiActionProposals.expiresAt,
    })
    .from(aiActionProposals)
    .where(
      and(
        eq(aiActionProposals.status, 'pending'),
        sql`${aiActionProposals.expiresAt} > now() + interval '10 minutes'`,
        notExists(
          db
            .select({ id: approvalTokens.proposalId })
            .from(approvalTokens)
            .where(eq(approvalTokens.proposalId, aiActionProposals.id)),
        ),
      ),
    )
    .orderBy(asc(aiActionProposals.createdAt))
    .limit(limit);
  let sent = 0;
  for (const proposal of pending) {
    try {
      await db.transaction(async (tx) => {
        const tokens = await issueTokens(tx, proposal.id, proposal.expiresAt);
        const day = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await callBot(options, 'sendMessage', {
          chat_id: options.chatId,
          text: proposalMessage(proposal, proposal.expiresAt < day ? proposal.expiresAt : day),
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Setujui', callback_data: `a:${tokens.approve}` },
                { text: 'Tolak', callback_data: `r:${tokens.reject}` },
              ],
            ],
          },
        });
      });
      sent += 1;
    } catch (error) {
      return { sent, failed: error instanceof TelegramError ? error.code : 'unexpected' };
    }
  }
  return { sent, failed: null };
}
