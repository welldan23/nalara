// Fast edits from the founder's Telegram chat (P5-04). Plain commands, no AI:
//
//   lihat 12               the story as it stands (title, summary, status, sources)
//   judul 12: <text>       new title
//   ringkas 12: <text>     new summary (dek), which is also the Kartu IG caption lead
//   caption 12: <text>     same as ringkas
//   lewati 12              skip the story
//
// - Only the webhook calls this, after it checked the founder's user id and chat.
// - The text after ":" is data: it becomes a field of a new revision (validated like an edit in
//   the OS) and is never interpreted.
// - Every edit is a new revision. The buttons already sent act on the old revision, so they stop
//   working (decideStory refuses them). The story goes back to "drafted" with a fresh package, and
//   the worker sends it again with new buttons.
// - Only a draft that is still in the queue (drafted or sent, article in draft) can be edited
//   here; anything else is edited in the OS.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { articleRevisions, articles, storyQueue } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { saveRevision } from '../articles/articles.ts';
import type { Actor } from '../articles/articles.ts';
import { preparePackage } from './telegram.ts';

type Db = NodePgDatabase<typeof schema>;

export type ChatCommand =
  | { readonly kind: 'view'; readonly number: number }
  | { readonly kind: 'skip'; readonly number: number }
  | {
      readonly kind: 'edit';
      readonly number: number;
      readonly field: 'title' | 'dek';
      readonly value: string;
    };

const FIELDS: Readonly<Record<string, 'title' | 'dek'>> = {
  judul: 'title',
  ringkas: 'dek',
  ringkasan: 'dek',
  caption: 'dek',
};

/** Null when the text is not one of the commands (the webhook then shows the help). */
export function parseChatCommand(text: string): ChatCommand | null {
  const trimmed = text.trim();
  const simple = /^(lihat|lewati)\s+#?(\d{1,9})$/iu.exec(trimmed);
  if (simple !== null) {
    const number = Number(simple[2]);
    return { kind: simple[1]?.toLowerCase() === 'lihat' ? 'view' : 'skip', number };
  }
  const edit = /^(judul|ringkas|ringkasan|caption)\s+#?(\d{1,9})\s*:\s*([\s\S]*)$/iu.exec(trimmed);
  if (edit === null) return null;
  const field = FIELDS[edit[1]?.toLowerCase() ?? ''];
  if (field === undefined) return null;
  return {
    kind: 'edit',
    number: Number(edit[2]),
    field,
    // One line: a title or summary never needs line breaks, and this keeps pasted text tidy.
    value: (edit[3] ?? '').replace(/\s+/gu, ' ').trim(),
  };
}

const EDITABLE = ['drafted', 'sent'] as const;

async function load(db: Db, number: number) {
  const [story] = await db
    .select({
      id: storyQueue.id,
      number: storyQueue.number,
      status: storyQueue.status,
      score: storyQueue.score,
      articleId: storyQueue.articleId,
      route: storyQueue.route,
    })
    .from(storyQueue)
    .where(eq(storyQueue.number, number));
  if (story === undefined) throw new AppError('NOT_FOUND');
  return story;
}

async function current(db: Db, articleId: string) {
  const [row] = await db
    .select({
      status: articles.status,
      version: articles.currentVersion,
      revision: articleRevisions,
    })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(eq(articles.id, articleId));
  if (row === undefined) throw new AppError('NOT_FOUND');
  return row;
}

interface Citation {
  readonly url: string;
  readonly publisher: string;
  readonly primary?: boolean;
}

const STATUS_TEXT: Readonly<Record<string, string>> = {
  drafting: 'sedang ditulis agent',
  drafted: 'draft siap, menunggu bukti sumber diarsipkan',
  sent: 'menunggu keputusanmu',
  published: 'sudah terbit',
  skipped: 'dilewati',
  expired: 'kedaluwarsa',
};

/** "lihat N": plain text, so nothing the AI or anyone wrote turns into markup. */
export async function viewStory(db: Db, number: number): Promise<string> {
  const story = await load(db, number);
  const lines = [`Usulan #${String(number)}: ${STATUS_TEXT[story.status] ?? story.status}.`];
  if (story.articleId === null) return lines.join('\n');
  const { revision } = await current(db, story.articleId);
  const citations = revision.citations as Citation[];
  lines.push(
    '',
    `Judul: ${revision.title}`,
    `Ringkasan: ${revision.dek === '' ? '(kosong)' : revision.dek}`,
    '',
    'Sumber:',
    ...citations.map(
      (citation, index) =>
        `${String(index + 1)}. ${citation.publisher}${citation.primary === true ? ' (primer)' : ''}: ${citation.url}`,
    ),
  );
  return lines.join('\n');
}

/** "lewati N": the same as ❌, for a story still waiting. */
export async function skipStoryFromChat(db: Db, number: number): Promise<void> {
  const story = await load(db, number);
  const [updated] = await db
    .update(storyQueue)
    .set({
      status: 'skipped',
      note: 'Dilewati founder lewat chat Telegram.',
      updatedAt: sql`now()`,
    })
    .where(and(eq(storyQueue.id, story.id), inArray(storyQueue.status, [...EDITABLE])))
    .returning({ id: storyQueue.id });
  if (updated === undefined) throw new AppError('INVALID_TRANSITION');
}

/**
 * "judul N: ..." / "ringkas N: ...": a new revision with that one field changed, then a fresh
 * package for the worker to send. Validation is the editor's (length, empty title, ...).
 */
export async function editStory(
  db: Db,
  actor: Actor,
  command: Extract<ChatCommand, { kind: 'edit' }>,
): Promise<void> {
  const story = await load(db, command.number);
  if (!(EDITABLE as readonly string[]).includes(story.status) || story.articleId === null) {
    throw new AppError('INVALID_TRANSITION');
  }
  const { status, version, revision } = await current(db, story.articleId);
  if (status !== 'draft') throw new AppError('INVALID_TRANSITION');
  const citations = revision.citations as (Citation & Record<string, unknown>)[];
  const content = {
    title: revision.title,
    dek: revision.dek,
    articleType: revision.articleType,
    categoryId: revision.categoryId,
    body: revision.body,
    bodySource: revision.bodySource,
    methodNote: revision.methodNote,
    citations,
    [command.field]: command.value,
  };
  const saved = await saveRevision(db, actor, story.articleId, {
    expectedVersion: version,
    content,
    changeNote:
      command.field === 'title'
        ? 'Judul diganti founder lewat chat Telegram (P5-04).'
        : 'Ringkasan diganti founder lewat chat Telegram (P5-04).',
  });
  const [updated] = await db
    .update(storyQueue)
    .set({
      // Back to "drafted": the worker sends the new package with new buttons. The old buttons act
      // on the previous revision and are refused.
      status: 'drafted',
      sentAt: null,
      revisionId: saved.revisionId,
      ...preparePackage({
        number: command.number,
        title: content.title,
        dek: content.dek,
        score: story.score,
        bodySource: content.bodySource,
        citations: citations.map((citation) => ({
          url: citation.url,
          publisher: citation.publisher,
          primary: citation.primary === true,
        })),
      }),
      updatedAt: sql`now()`,
    })
    .where(and(eq(storyQueue.id, story.id), inArray(storyQueue.status, [...EDITABLE])))
    .returning({ id: storyQueue.id });
  if (updated === undefined) throw new AppError('INVALID_TRANSITION');
}
