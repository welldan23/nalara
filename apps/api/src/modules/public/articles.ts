// Public reading API data (P1-06, ADR-013, S1-02/S1-03). Every public query goes through
// `publishedOnly`: status = 'published' and the content of the APPROVED revision. Nothing here
// can return a draft, a review, an archived article, editor-only fields or internal ids of people.
import { and, asc, desc, eq, lt, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { articleRevisions, articles, categories } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import type { Block, Citation } from '../articles/content.ts';
import { verificationLevel } from '../articles/verification.ts';
import type { VerificationLevel } from '../articles/verification.ts';

type Db = NodePgDatabase<typeof schema>;

export const PUBLIC_PAGE_MAX = 30;

const publishedOnly = (): SQL => eq(articles.status, 'published');

export interface PublicCategory {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
}

export interface PublicArticleSummary {
  readonly slug: string;
  readonly title: string;
  readonly dek: string;
  readonly articleType: string;
  readonly category: { readonly slug: string; readonly name: string };
  readonly publishedAt: Date;
  readonly verification: VerificationLevel;
}

/** What a reader may see of a citation: no editor notes. */
export interface PublicCitation {
  readonly id: string;
  readonly url: string;
  readonly publisher: string;
  readonly title: string;
  readonly accessedAt: string;
  readonly primary: boolean;
}

export interface PublicArticle extends PublicArticleSummary {
  readonly body: Block[];
  readonly citations: PublicCitation[];
  readonly methodNote: string | null;
  /** The founder's reason when published without a verified source (PRD v4 §7). */
  readonly sourceException: string | null;
  readonly firstPublishedAt: Date;
}

export async function publicCategories(db: Db): Promise<PublicCategory[]> {
  return db
    .select({ slug: categories.slug, name: categories.name, description: categories.description })
    .from(categories)
    .orderBy(asc(categories.name));
}

// --- Keyset cursor: (published_at, id) of the last item, opaque to clients. ---

const cursorSchema = z.strictObject({ p: z.iso.datetime(), i: z.uuid() });

export function encodeCursor(publishedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ p: publishedAt.toISOString(), i: id })).toString('base64url');
}

function decodeCursor(cursor: string): { publishedAt: Date; id: string } {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { publishedAt: new Date(parsed.p), id: parsed.i };
  } catch {
    throw new AppError('VALIDATION_FAILED', [{ path: 'cursor', rule: 'invalid' }]);
  }
}

const summaryColumns = {
  id: articles.id,
  slug: articles.slug,
  publishedAt: articles.publishedAt,
  title: articleRevisions.title,
  dek: articleRevisions.dek,
  articleType: articleRevisions.articleType,
  citations: articleRevisions.citations,
  categorySlug: categories.slug,
  categoryName: categories.name,
};

interface SummaryRow {
  readonly id: string;
  readonly slug: string;
  readonly publishedAt: Date | null;
  readonly title: string;
  readonly dek: string;
  readonly articleType: string;
  readonly citations: unknown[];
  readonly categorySlug: string;
  readonly categoryName: string;
}

function toSummary(row: SummaryRow): PublicArticleSummary {
  if (row.publishedAt === null) throw new Error('published article without published_at');
  return {
    slug: row.slug,
    title: row.title,
    dek: row.dek,
    articleType: row.articleType,
    category: { slug: row.categorySlug, name: row.categoryName },
    publishedAt: row.publishedAt,
    // Stored citations were validated when the revision was written.
    verification: verificationLevel(row.citations as Citation[]),
  };
}

export interface PublicListResult {
  readonly articles: PublicArticleSummary[];
  /** Pass back as `cursor` for the next page; null when there is none. */
  readonly nextCursor: string | null;
}

export async function publicArticles(
  db: Db,
  options: { readonly category?: string; readonly limit?: number; readonly cursor?: string } = {},
): Promise<PublicListResult> {
  const limit = Math.min(Math.max(options.limit ?? 12, 1), PUBLIC_PAGE_MAX);
  const after = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
  const conditions: SQL[] = [publishedOnly()];
  if (options.category !== undefined) conditions.push(eq(categories.slug, options.category));
  if (after !== undefined) {
    const older = or(
      lt(articles.publishedAt, after.publishedAt),
      and(eq(articles.publishedAt, after.publishedAt), lt(articles.id, after.id)),
    );
    if (older !== undefined) conditions.push(older);
  }
  const rows = await db
    .select(summaryColumns)
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.approvedRevisionId))
    .innerJoin(categories, eq(categories.id, articleRevisions.categoryId))
    .where(and(...conditions))
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    articles: page.map(toSummary),
    nextCursor:
      rows.length > limit && last?.publishedAt != null
        ? encodeCursor(last.publishedAt, last.id)
        : null,
  };
}

export async function publicArticle(db: Db, slug: string): Promise<PublicArticle | null> {
  const [row] = await db
    .select({
      ...summaryColumns,
      body: articleRevisions.body,
      methodNote: articleRevisions.methodNote,
      sourceException: articles.sourceException,
      firstPublishedAt: articles.firstPublishedAt,
    })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.approvedRevisionId))
    .innerJoin(categories, eq(categories.id, articleRevisions.categoryId))
    .where(and(publishedOnly(), eq(articles.slug, slug)));
  if (row === undefined) return null;
  const citations = row.citations as Citation[];
  return {
    ...toSummary(row),
    body: row.body as Block[],
    citations: citations.map((citation) => ({
      id: citation.id,
      url: citation.url,
      publisher: citation.publisher,
      title: citation.title,
      accessedAt: citation.accessedAt,
      primary: citation.primary,
    })),
    methodNote: row.methodNote,
    sourceException: row.sourceException,
    firstPublishedAt: row.firstPublishedAt ?? row.publishedAt ?? new Date(0),
  };
}
