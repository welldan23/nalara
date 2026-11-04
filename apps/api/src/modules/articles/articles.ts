// Article drafts and immutable revisions (P1-01, ADR-012). Every save inserts a new revision with
// the next version number; nothing ever updates a revision (the database refuses it too).
// Concurrent editors are serialised with a row lock plus expected_version, so a stale editor gets
// VERSION_CONFLICT instead of silently overwriting newer work.
import { and, asc, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { articleRevisions, articles, categories } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { parseOrThrow } from '../../lib/validation.ts';
import { recordAudit } from '../audit/audit.ts';
import { changeNoteSchema, contentSha256, revisionContentSchema } from './content.ts';
import type { RevisionContent } from './content.ts';

type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Actor {
  readonly userId: string;
  readonly requestId?: string;
  /**
   * Set when an AI agent creates a draft through the gateway (P3-02): the draft still belongs to
   * the founder (userId), and the audit log names the agent as the actor.
   */
  readonly agentRole?: string;
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 120;
/**
 * Statuses in which content may change. Editing an article under review or approved sends it
 * back to draft and voids the approval (PRD v4 §6.2, ADR-012); published articles change only
 * through corrections (P1-07).
 */
const EDITABLE_STATUSES = new Set(['draft', 'in_review', 'approved']);

/** Lowercase ASCII slug from a title: "Harga Beras Naik 10%!" -> "harga-beras-naik-10". */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' dan ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return slug.length >= SLUG_MIN ? slug : `artikel-${slug}`.replace(/-+$/g, '');
}

function isValidSlug(slug: string): boolean {
  return slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && SLUG_PATTERN.test(slug);
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const { code, constraint: name } = cause as { code?: unknown; constraint?: unknown };
  return code === '23505' && name === constraint;
}

async function assertCategoryExists(tx: Tx, categoryId: string): Promise<void> {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (row === undefined) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'categoryId', rule: 'unknown' }]);
  }
}

async function pickSlug(tx: Tx, requested: string | undefined, title: string): Promise<string> {
  if (requested !== undefined) {
    if (!isValidSlug(requested)) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'slug', rule: 'invalid_format' }]);
    }
    return requested;
  }
  const base = slugify(title);
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const suffix = attempt === 1 ? '' : `-${String(attempt)}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
    const [taken] = await tx
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.slug, candidate));
    if (taken === undefined) return candidate;
  }
  throw new AppError('SLUG_TAKEN');
}

export interface CreateDraftInput {
  readonly content: unknown;
  readonly slug?: string;
  readonly changeNote?: string;
}

export interface SavedRevision {
  readonly articleId: string;
  readonly revisionId: string;
  readonly version: number;
  readonly slug: string;
  /** True when this save sent the article back to draft and voided an approval or review. */
  readonly returnedToDraft?: boolean;
}

export async function insertRevision(
  tx: Tx,
  actor: Actor,
  articleId: string,
  version: number,
  content: RevisionContent,
  changeNote: string,
): Promise<string> {
  const [revision] = await tx
    .insert(articleRevisions)
    .values({
      articleId,
      version,
      title: content.title,
      dek: content.dek,
      articleType: content.articleType,
      categoryId: content.categoryId,
      body: content.body,
      bodySource: content.bodySource,
      methodNote: content.methodNote,
      citations: content.citations,
      changeNote,
      contentSha256: contentSha256(content),
      createdBy: actor.userId,
    })
    .returning({ id: articleRevisions.id });
  if (revision === undefined) throw new Error('revision insert returned no row');
  return revision.id;
}

/** New article in `draft` with revision 1. */
export async function createDraft(
  db: Db,
  actor: Actor,
  input: CreateDraftInput,
): Promise<SavedRevision> {
  const content = parseOrThrow(revisionContentSchema, input.content);
  const changeNote = parseOrThrow(changeNoteSchema, input.changeNote ?? 'Draft pertama');
  try {
    return await db.transaction(async (tx) => {
      await assertCategoryExists(tx, content.categoryId);
      const slug = await pickSlug(tx, input.slug, content.title);
      const [article] = await tx
        .insert(articles)
        .values({ slug, createdBy: actor.userId })
        .returning({ id: articles.id });
      if (article === undefined) throw new Error('article insert returned no row');
      const revisionId = await insertRevision(tx, actor, article.id, 1, content, changeNote);
      await tx
        .update(articles)
        .set({ currentVersion: 1, currentRevisionId: revisionId, updatedAt: new Date() })
        .where(eq(articles.id, article.id));
      await recordAudit(tx, {
        action: 'article.create',
        ...(actor.agentRole === undefined
          ? { actorType: 'founder' as const, actorId: actor.userId }
          : { actorType: 'agent' as const }),
        result: 'success',
        resourceType: 'article',
        resourceId: article.id,
        ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
        metadata: {
          version: 1,
          ...(actor.agentRole === undefined ? {} : { agent_role: actor.agentRole }),
        },
      });
      return { articleId: article.id, revisionId, version: 1, slug };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'articles_slug_unique')) throw new AppError('SLUG_TAKEN');
    throw error;
  }
}

export interface SaveRevisionInput {
  readonly expectedVersion: number;
  readonly content: unknown;
  readonly changeNote: string;
}

/** Next revision of an editable article. Stale expectedVersion -> VERSION_CONFLICT. */
export async function saveRevision(
  db: Db,
  actor: Actor,
  articleId: string,
  input: SaveRevisionInput,
): Promise<SavedRevision> {
  const content = parseOrThrow(revisionContentSchema, input.content);
  const changeNote = parseOrThrow(changeNoteSchema, input.changeNote);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'expectedVersion', rule: 'invalid' }]);
  }
  return db.transaction(async (tx) => {
    const [article] = await tx
      .select({
        id: articles.id,
        slug: articles.slug,
        status: articles.status,
        currentVersion: articles.currentVersion,
        currentRevisionId: articles.currentRevisionId,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .for('update');
    if (article === undefined) throw new AppError('NOT_FOUND');
    if (article.currentVersion !== input.expectedVersion) throw new AppError('VERSION_CONFLICT');
    if (!EDITABLE_STATUSES.has(article.status)) throw new AppError('NOT_EDITABLE');
    await assertCategoryExists(tx, content.categoryId);

    if (article.currentRevisionId === null) throw new Error('article has no current revision');
    const [current] = await tx
      .select({
        contentSha256: articleRevisions.contentSha256,
        bodySource: articleRevisions.bodySource,
      })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, article.currentRevisionId));
    if (
      current !== undefined &&
      current.contentSha256.equals(contentSha256(content)) &&
      current.bodySource === content.bodySource
    ) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'content', rule: 'unchanged' }]);
    }

    const version = article.currentVersion + 1;
    const revisionId = await insertRevision(tx, actor, article.id, version, content, changeNote);
    const returnedToDraft = article.status !== 'draft';
    const updated = await tx
      .update(articles)
      .set({
        currentVersion: version,
        currentRevisionId: revisionId,
        updatedAt: new Date(),
        // Any edit voids review and approval: the approved bytes no longer exist as current.
        status: 'draft',
        approvedRevisionId: null,
        approvedContentSha256: null,
        approvedBy: null,
        approvedAt: null,
        sourceException: null,
      })
      .where(and(eq(articles.id, article.id), eq(articles.currentVersion, input.expectedVersion)))
      .returning({ id: articles.id });
    if (updated.length !== 1) throw new AppError('VERSION_CONFLICT');
    await recordAudit(tx, {
      action: 'article.revise',
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'article',
      resourceId: article.id,
      ...(actor.requestId !== undefined ? { requestId: actor.requestId } : {}),
      metadata: { version, returned_to_draft: returnedToDraft },
    });
    return { articleId: article.id, revisionId, version, slug: article.slug, returnedToDraft };
  });
}

export interface RevisionView {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly dek: string;
  readonly articleType: RevisionContent['articleType'];
  readonly categoryId: string;
  readonly body: unknown[];
  readonly bodySource: string;
  readonly methodNote: string | null;
  readonly citations: unknown[];
  readonly changeNote: string;
  readonly contentSha256: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface ArticleView {
  readonly id: string;
  readonly slug: string;
  readonly status: (typeof articles.$inferSelect)['status'];
  readonly currentVersion: number;
  readonly approvedRevisionId: string | null;
  readonly approvedAt: Date | null;
  readonly sourceException: string | null;
  readonly publishedAt: Date | null;
  readonly firstPublishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly current: RevisionView;
}

function toRevisionView(row: typeof articleRevisions.$inferSelect): RevisionView {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    dek: row.dek,
    articleType: row.articleType,
    categoryId: row.categoryId,
    body: row.body,
    bodySource: row.bodySource,
    methodNote: row.methodNote,
    citations: row.citations,
    changeNote: row.changeNote,
    contentSha256: row.contentSha256.toString('hex'),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/** Article with its current revision (OS only: includes drafts). */
export async function getArticle(db: Db, articleId: string): Promise<ArticleView | null> {
  const [row] = await db
    .select({ article: articles, revision: articleRevisions })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(eq(articles.id, articleId));
  if (row === undefined) return null;
  return {
    id: row.article.id,
    slug: row.article.slug,
    status: row.article.status,
    currentVersion: row.article.currentVersion,
    approvedRevisionId: row.article.approvedRevisionId,
    approvedAt: row.article.approvedAt,
    sourceException: row.article.sourceException,
    publishedAt: row.article.publishedAt,
    firstPublishedAt: row.article.firstPublishedAt,
    createdAt: row.article.createdAt,
    updatedAt: row.article.updatedAt,
    current: toRevisionView(row.revision),
  };
}

/** Full revision history, oldest first. */
export async function listRevisions(db: Db, articleId: string): Promise<RevisionView[]> {
  const rows = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, articleId))
    .orderBy(asc(articleRevisions.version));
  return rows.map(toRevisionView);
}

export interface CategoryView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export async function listCategories(db: Db): Promise<CategoryView[]> {
  return db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .orderBy(asc(categories.name));
}

export interface ArticleSummary {
  readonly id: string;
  readonly slug: string;
  readonly status: ArticleView['status'];
  readonly currentVersion: number;
  readonly title: string;
  readonly categoryId: string;
  readonly updatedAt: Date;
}

export const LIST_LIMIT_MAX = 100;

/** OS newsroom list, most recently edited first. */
export async function listArticles(
  db: Db,
  options: { readonly status?: ArticleView['status']; readonly limit?: number } = {},
): Promise<ArticleSummary[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), LIST_LIMIT_MAX);
  return db
    .select({
      id: articles.id,
      slug: articles.slug,
      status: articles.status,
      currentVersion: articles.currentVersion,
      title: articleRevisions.title,
      categoryId: articleRevisions.categoryId,
      updatedAt: articles.updatedAt,
    })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(options.status === undefined ? undefined : eq(articles.status, options.status))
    .orderBy(desc(articles.updatedAt), desc(articles.id))
    .limit(limit);
}
