// The Pemeriksa agent's source check (P5-09). The agent reads a drafted story and the archived copy
// of each source, then quotes pairs: a sentence from the draft and the passage of the source that
// backs it. The model's word is never trusted on its own; the API checks:
//   - the draft quote really is in the draft, the source quote really is in that source's archive;
//   - every number in the draft (years aside) appears in a supporting source quote;
//   - at least one supporting quote comes from a primary official source;
//   - the agent found nothing sensitive (crime allegations against named people, SARA, children…).
// All of it holds → "passed". Anything else → "held" with the reasons, and the founder decides.
// The outcome is bound to the revision that was checked and is shown in the Telegram package.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { articleRevisions, articles, evidenceSnapshots, storyQueue } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { parseOrThrow } from '../../lib/validation.ts';
import type { Block } from '../articles/content.ts';
import { plainText } from '../articles/content.ts';
import { htmlToText } from '../feeds/feed.ts';
import { preparePackage } from './telegram.ts';

type Db = NodePgDatabase<typeof schema>;

/** How much of each archived page the agent reads. */
export const EVIDENCE_TEXT_MAX = 20_000;

interface Citation {
  readonly url: string;
  readonly publisher: string;
  readonly primary?: boolean;
}

// ---------- text helpers (pure) ----------

/** For matching quotes: case, quote marks, dashes and whitespace do not matter. */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const inlineText = (content: readonly { readonly text: string }[]) =>
  content.map((part) => part.text).join('');

/** What a reader sees of the draft, as text (charts aside: they come from NALARA Data). */
export function draftText(title: string, dek: string, body: readonly Block[]): string {
  const parts = [title, dek];
  for (const block of body) {
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        parts.push(inlineText(block.content));
        break;
      case 'quote':
        parts.push(`${inlineText(block.content)} ${block.attribution}`);
        break;
      case 'list':
        for (const item of block.items) parts.push(inlineText(item));
        break;
      case 'stat':
        parts.push(`${block.label}: ${block.value} ${block.unit} (${block.period})`);
        break;
      default:
        break;
    }
  }
  return parts.join('\n');
}

/**
 * Numbers as values: "2,8" and "2.8" are both 2.8, "1.250" (Indonesian thousands) is 1250.
 * Years (1900-2100 written as four digits) are left out: dates are not what goes wrong.
 */
export function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const token = match[0];
    if (/^(19|20)\d\d$/.test(token) || token === '2100') continue;
    let value: string;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(token)) {
      value = token.replaceAll('.', '').replace(',', '.');
    } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(token) && token.includes('.')) {
      value = token.replaceAll(',', ''); // 1,250.5 (English)
    } else {
      value = token.replace(',', '.');
    }
    const number = Number(value);
    if (Number.isFinite(number)) found.add(String(number));
  }
  return found;
}

// ---------- what the agent reads ----------

/** Latest captured snapshot per URL, as plain text (HTML only; anything else reads as empty). */
async function evidenceTexts(db: Db, urls: readonly string[]) {
  const texts = new Map<string, string>();
  if (urls.length === 0) return texts;
  const rows = await db
    .select({
      url: evidenceSnapshots.url,
      status: evidenceSnapshots.status,
      contentType: evidenceSnapshots.contentType,
      body: evidenceSnapshots.body,
    })
    .from(evidenceSnapshots)
    .where(inArray(evidenceSnapshots.url, [...urls]))
    .orderBy(sql`${evidenceSnapshots.id} DESC`);
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    if (row.status !== 'captured' || row.body === null) continue;
    const type = (row.contentType ?? '').toLowerCase();
    const readable = type === '' || type.includes('html') || type.startsWith('text/');
    texts.set(row.url, readable ? htmlToText(row.body.toString('utf8'), EVIDENCE_TEXT_MAX) : '');
  }
  return texts;
}

/** Drafted stories, not sent, never checked, whose sources are all archived. */
export async function storiesToCheck(db: Db, limit: number) {
  const rows = await db
    .select({
      queueId: storyQueue.id,
      number: storyQueue.number,
      revisionId: storyQueue.revisionId,
      sourceUrls: storyQueue.sourceUrls,
      title: articleRevisions.title,
      dek: articleRevisions.dek,
      body: articleRevisions.body,
      citations: articleRevisions.citations,
    })
    .from(storyQueue)
    .innerJoin(articles, eq(articles.id, storyQueue.articleId))
    .innerJoin(articleRevisions, eq(articleRevisions.id, storyQueue.revisionId))
    .where(
      and(
        eq(storyQueue.status, 'drafted'),
        isNull(storyQueue.sentAt),
        isNull(storyQueue.checkRevisionId),
        eq(articles.status, 'draft'),
        eq(articles.currentRevisionId, storyQueue.revisionId),
      ),
    )
    .orderBy(storyQueue.queuedAt)
    .limit(20);

  const ready = [];
  for (const row of rows) {
    if (ready.length >= limit) break;
    const citations = row.citations as Citation[];
    const texts = await evidenceTexts(
      db,
      citations.map((citation) => citation.url),
    );
    if (citations.some((citation) => !texts.has(citation.url))) continue; // not archived yet
    ready.push({
      queueId: row.queueId,
      revisionId: row.revisionId ?? '',
      number: row.number,
      draft: draftText(row.title, row.dek, row.body as Block[]),
      sources: citations.map((citation, index) => ({
        number: index + 1,
        publisher: citation.publisher,
        primary: citation.primary === true,
        url: citation.url,
        text: texts.get(citation.url) ?? '',
      })),
    });
  }
  return ready;
}

// ---------- what the agent submits ----------

const quote = (max: number) => plainText(max).trim().min(3);

export const checkSchema = z.strictObject({
  queueId: z.uuid(),
  revisionId: z.uuid(),
  claims: z
    .array(
      z.strictObject({
        claim: quote(500),
        source: z.int().min(1).max(12),
        evidence: quote(600),
        supported: z.boolean(),
      }),
    )
    .max(30),
  sensitive: z.boolean(),
  reason: plainText(1000).trim().min(1),
});
export type CheckInput = z.infer<typeof checkSchema>;

export interface CheckOutcome {
  readonly status: 'passed' | 'held';
  readonly problems: readonly string[];
}

/** Pure: decides the outcome from the draft, the sources and the agent's quotes. */
export function judgeCheck(
  draft: string,
  sources: readonly { readonly primary: boolean; readonly text: string }[],
  input: Pick<CheckInput, 'claims' | 'sensitive' | 'reason'>,
): CheckOutcome {
  const problems: string[] = [];
  const normalDraft = normalize(draft);
  const normalSources = sources.map((source) => normalize(source.text));
  const backed = new Set<string>();
  let primaryBacked = false;

  if (input.sensitive) problems.push(`Topik sensitif menurut Pemeriksa: ${input.reason}`);
  if (input.claims.length === 0)
    problems.push('Pemeriksa tidak mengirim satu pun pasangan kutipan.');
  for (const [index, claim] of input.claims.entries()) {
    const label = `Klaim ${String(index + 1)}`;
    const source = sources[claim.source - 1];
    const sourceText = normalSources[claim.source - 1];
    if (source === undefined || sourceText === undefined) {
      problems.push(`${label}: sumber nomor ${String(claim.source)} tidak ada.`);
      continue;
    }
    if (!claim.supported) {
      problems.push(`${label} tidak didukung sumber: "${claim.claim}"`);
      continue;
    }
    if (!normalDraft.includes(normalize(claim.claim))) {
      problems.push(`${label}: kalimatnya tidak ada di draft.`);
      continue;
    }
    if (!sourceText.includes(normalize(claim.evidence))) {
      problems.push(
        `${label}: kutipan sumber ${String(claim.source)} tidak ditemukan di arsipnya.`,
      );
      continue;
    }
    const evidenceNumbers = numbersIn(claim.evidence);
    const missing = [...numbersIn(claim.claim)].filter((value) => !evidenceNumbers.has(value));
    if (missing.length > 0) {
      problems.push(`${label}: angka ${missing.join(', ')} tidak ada di kutipan sumbernya.`);
      continue;
    }
    for (const value of evidenceNumbers) backed.add(value);
    if (source.primary) primaryBacked = true;
  }

  const unbacked = [...numbersIn(draft)].filter((value) => !backed.has(value));
  if (unbacked.length > 0) {
    problems.push(`Angka di draft yang belum dicocokkan ke sumber: ${unbacked.join(', ')}.`);
  }
  if (!primaryBacked) problems.push('Tidak ada klaim yang dicocokkan ke sumber resmi primer.');
  return { status: problems.length === 0 ? 'passed' : 'held', problems };
}

export function checkNote(outcome: CheckOutcome): string {
  if (outcome.status === 'passed') {
    return 'LOLOS: semua angka dan klaim cocok dengan arsip sumber, termasuk sumber resmi primer.';
  }
  const lines = ['DITAHAN, perlu kamu cek:', ...outcome.problems.map((problem) => `- ${problem}`)];
  const note = lines.join('\n');
  return note.length > 2000 ? `${note.slice(0, 1999)}…` : note;
}

/** Records the outcome for the revision that was checked and refreshes the Telegram package. */
export async function submitCheck(db: Db, raw: unknown): Promise<CheckOutcome> {
  const input = parseOrThrow(checkSchema, raw);
  const [story] = await db
    .select({
      number: storyQueue.number,
      score: storyQueue.score,
      status: storyQueue.status,
      sentAt: storyQueue.sentAt,
      revisionId: storyQueue.revisionId,
      checkRevisionId: storyQueue.checkRevisionId,
      currentRevisionId: articles.currentRevisionId,
      articleStatus: articles.status,
    })
    .from(storyQueue)
    .innerJoin(articles, eq(articles.id, storyQueue.articleId))
    .where(eq(storyQueue.id, input.queueId));
  if (story === undefined) throw new AppError('NOT_FOUND');
  if (
    story.status !== 'drafted' ||
    story.sentAt !== null ||
    story.checkRevisionId !== null ||
    story.articleStatus !== 'draft'
  ) {
    throw new AppError('INVALID_TRANSITION');
  }
  if (story.revisionId !== input.revisionId || story.currentRevisionId !== input.revisionId) {
    throw new AppError('VERSION_CONFLICT');
  }
  const [revision] = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, input.revisionId));
  if (revision === undefined) throw new AppError('NOT_FOUND');
  const citations = revision.citations as Citation[];
  const texts = await evidenceTexts(
    db,
    citations.map((citation) => citation.url),
  );
  const outcome = judgeCheck(
    draftText(revision.title, revision.dek, revision.body as Block[]),
    citations.map((citation) => ({
      primary: citation.primary === true,
      text: texts.get(citation.url) ?? '',
    })),
    input,
  );
  const note = checkNote(outcome);
  const updated = await db
    .update(storyQueue)
    .set({
      checkStatus: outcome.status,
      checkRevisionId: input.revisionId,
      checkNote: note,
      checkedAt: sql`now()`,
      ...preparePackage({
        number: story.number,
        title: revision.title,
        dek: revision.dek,
        score: story.score,
        bodySource: revision.bodySource,
        citations: citations.map((citation) => ({
          url: citation.url,
          publisher: citation.publisher,
          primary: citation.primary === true,
        })),
        check: note,
      }),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(storyQueue.id, input.queueId),
        eq(storyQueue.status, 'drafted'),
        isNull(storyQueue.sentAt),
        isNull(storyQueue.checkRevisionId),
        eq(storyQueue.revisionId, input.revisionId),
      ),
    )
    .returning({ id: storyQueue.id });
  if (updated.length === 0) throw new AppError('VERSION_CONFLICT');
  return outcome;
}
