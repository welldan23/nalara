// Newsroom API for the founder (P1-02, PRD v4 §10.1). Registered inside the OS scope, so every
// route here is behind requireFounder and the permission policy; mutations also need CSRF.
import type { FastifyInstance } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { ARTICLE_STATUSES, ARTICLE_TYPES } from '../db/schema.ts';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { parseOrThrow } from '../lib/validation.ts';
import {
  createDraft,
  getArticle,
  listArticles,
  listCategories,
  listRevisions,
  saveRevision,
} from '../modules/articles/articles.ts';
import { LIMITS, MAX_CITATIONS, citationSchema } from '../modules/articles/content.ts';
import type { Block, Citation } from '../modules/articles/content.ts';
import { parseMarkdown } from '../modules/articles/markdown.ts';
import { publishGate } from '../modules/articles/gate.ts';
import { verificationLevel } from '../modules/articles/verification.ts';
import {
  TRANSITIONS,
  correctPublished,
  listCorrections,
  listPublicationEvents,
  transition,
} from '../modules/articles/workflow.ts';
import type { TransitionAction } from '../modules/articles/workflow.ts';
import { styleWarnings } from '../modules/articles/warnings.ts';
import { assertMediaExist, mediaForBody } from '../modules/media/media.ts';
import { getEvidenceFile, latestEvidence, requestEvidence } from '../modules/evidence/evidence.ts';
import type { AuthGuards } from '../plugins/auth.ts';

/** Drafts are larger than the global 16 KiB API body limit (ADR-011). */
export const EDITOR_BODY_LIMIT_BYTES = 256 * 1024;

const editorFields = {
  title: z.string(),
  dek: z.string().default(''),
  articleType: z.enum(ARTICLE_TYPES),
  categoryId: z.string(),
  methodNote: z.string().nullable().default(null),
  bodySource: z.string().max(LIMITS.bodySource),
  citations: z.array(citationSchema).max(MAX_CITATIONS).default([]),
};

const createSchema = z.strictObject({
  ...editorFields,
  slug: z.string().optional(),
  changeNote: z.string().optional(),
});

const updateSchema = z.strictObject({
  ...editorFields,
  expectedVersion: z.number().int(),
  changeNote: z.string(),
});

const previewSchema = z.strictObject({
  title: z.string().max(LIMITS.title).default(''),
  dek: z.string().max(LIMITS.dek).default(''),
  bodySource: z.string().max(LIMITS.bodySource),
  citations: z.array(citationSchema).max(MAX_CITATIONS).default([]),
});

const listQuery = z.strictObject({
  status: z.enum(ARTICLE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const correctionSchema = z.strictObject({
  ...editorFields,
  expectedVersion: z.number().int(),
  changeNote: z.string(),
  description: z.string().max(500),
  substantial: z.boolean(),
});

const transitionSchema = z.strictObject({
  expectedVersion: z.number().int(),
  note: z.string().max(500).optional(),
  sourceException: z.string().max(500).optional(),
});

const idParams = z.strictObject({ id: z.string() });
const uuid = z.uuid();

/** Markdown → blocks; parse problems come back as field issues with the line number. */
function bodyFromSource(bodySource: string, citationIds: readonly string[]) {
  const { blocks, issues } = parseMarkdown(bodySource, { citationIds });
  if (issues.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      issues.map((issue) => ({ path: `bodySource.line.${String(issue.line)}`, rule: issue.rule })),
    );
  }
  return blocks;
}

function articleId(params: unknown): string {
  const { id } = parseOrThrow(idParams, params);
  // A malformed id is simply "not found", the same answer as a missing article.
  if (!uuid.safeParse(id).success) throw new AppError('NOT_FOUND');
  return id;
}

export function registerArticleRoutes(
  app: FastifyInstance,
  { db, guards }: { readonly db: NodePgDatabase<typeof schema>; readonly guards: AuthGuards },
): void {
  const actor = (request: { auth: { userId: string } | null; id: string }) => {
    if (request.auth === null) throw new AppError('UNAUTHORIZED');
    return { userId: request.auth.userId, requestId: request.id };
  };

  // P2-07: keep a copy of every checked citation. Evidence is auxiliary: a failure here is
  // logged and never undoes or blocks the save itself.
  const keepEvidence = async (
    request: { auth: { userId: string } | null; log: { warn: (o: object, m: string) => void } },
    citations: readonly { readonly url: string; readonly verified: boolean }[],
  ) => {
    if (request.auth === null) return;
    try {
      await requestEvidence(db, request.auth.userId, citations);
    } catch {
      request.log.warn({}, 'evidence request failed');
    }
  };

  app.get('/categories', { config: { permission: 'articles.read' } }, async () => ({
    categories: await listCategories(db),
  }));

  app.get('/articles', { config: { permission: 'articles.read' } }, async (request) => {
    const query = parseOrThrow(listQuery, request.query);
    return {
      articles: await listArticles(db, {
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
    };
  });

  app.get('/articles/:id', { config: { permission: 'articles.read' } }, async (request) => {
    const id = articleId(request.params);
    const article = await getArticle(db, id);
    if (article === null) throw new AppError('NOT_FOUND');
    const revisions = await listRevisions(db, id);
    // Stored bodies were validated against the block schema when they were written.
    const media = await mediaForBody(db, article.current.body as Block[]);
    return {
      article,
      revisions: revisions.map((revision) => ({
        id: revision.id,
        version: revision.version,
        title: revision.title,
        changeNote: revision.changeNote,
        createdAt: revision.createdAt,
      })),
      warnings: styleWarnings({
        title: article.current.title,
        dek: article.current.dek,
        // Stored bodies were validated against the block schema when they were written.
        body: article.current.body as Block[],
      }),
      // Stored citations were validated against the citation schema when they were written.
      verification: verificationLevel(article.current.citations as Citation[]),
      gate: publishGate(
        {
          body: article.current.body as Block[],
          citations: article.current.citations as Citation[],
        },
        { sourceException: article.sourceException, media },
      ).blockers,
      media: Object.fromEntries(media),
      // Stored citations were validated when the revision was written.
      evidence: await latestEvidence(
        db,
        (article.current.citations as Citation[]).map((citation) => citation.url),
      ),
      events: await listPublicationEvents(db, id),
      corrections: await listCorrections(db, id),
    };
  });

  // Correct a published article: new revision approved and published in one action (P1-07).
  app.post(
    '/articles/:id/correct',
    {
      config: { permission: 'articles.publish' },
      bodyLimit: EDITOR_BODY_LIMIT_BYTES,
      preHandler: guards.requireCsrf,
    },
    async (request) => {
      const id = articleId(request.params);
      const input = parseOrThrow(correctionSchema, request.body);
      const body = bodyFromSource(
        input.bodySource,
        input.citations.map((citation) => citation.id),
      );
      await assertMediaExist(db, body);
      const corrected = await correctPublished(db, actor(request), id, {
        expectedVersion: input.expectedVersion,
        changeNote: input.changeNote,
        description: input.description,
        substantial: input.substantial,
        content: {
          title: input.title,
          dek: input.dek,
          articleType: input.articleType,
          categoryId: input.categoryId,
          body,
          bodySource: input.bodySource,
          methodNote: input.methodNote,
          citations: input.citations,
        },
      });
      await keepEvidence(request, input.citations);
      return corrected;
    },
  );

  for (const action of Object.keys(TRANSITIONS) as TransitionAction[]) {
    const publishing = action === 'approve' || action === 'publish';
    app.post(
      `/articles/:id/${action}`,
      {
        config: { permission: publishing ? 'articles.publish' : 'articles.write' },
        preHandler: guards.requireCsrf,
      },
      async (request) => {
        const id = articleId(request.params);
        const input = parseOrThrow(transitionSchema, request.body);
        return transition(db, actor(request), id, action, {
          expectedVersion: input.expectedVersion,
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.sourceException !== undefined
            ? { sourceException: input.sourceException }
            : {}),
        });
      },
    );
  }

  app.post(
    '/articles',
    {
      config: { permission: 'articles.write' },
      bodyLimit: EDITOR_BODY_LIMIT_BYTES,
      preHandler: guards.requireCsrf,
    },
    async (request, reply) => {
      const input = parseOrThrow(createSchema, request.body);
      const body = bodyFromSource(
        input.bodySource,
        input.citations.map((citation) => citation.id),
      );
      await assertMediaExist(db, body);
      const content = {
        title: input.title,
        dek: input.dek,
        articleType: input.articleType,
        categoryId: input.categoryId,
        body,
        bodySource: input.bodySource,
        methodNote: input.methodNote,
        citations: input.citations,
      };
      const saved = await createDraft(db, actor(request), {
        content,
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.changeNote !== undefined ? { changeNote: input.changeNote } : {}),
      });
      await keepEvidence(request, content.citations);
      return reply.code(201).send({
        ...saved,
        warnings: styleWarnings(content),
        verification: verificationLevel(content.citations),
      });
    },
  );

  app.patch(
    '/articles/:id',
    {
      config: { permission: 'articles.write' },
      bodyLimit: EDITOR_BODY_LIMIT_BYTES,
      preHandler: guards.requireCsrf,
    },
    async (request) => {
      const id = articleId(request.params);
      const input = parseOrThrow(updateSchema, request.body);
      const body = bodyFromSource(
        input.bodySource,
        input.citations.map((citation) => citation.id),
      );
      await assertMediaExist(db, body);
      const content = {
        title: input.title,
        dek: input.dek,
        articleType: input.articleType,
        categoryId: input.categoryId,
        body,
        bodySource: input.bodySource,
        methodNote: input.methodNote,
        citations: input.citations,
      };
      const saved = await saveRevision(db, actor(request), id, {
        expectedVersion: input.expectedVersion,
        content,
        changeNote: input.changeNote,
      });
      await keepEvidence(request, content.citations);
      return {
        ...saved,
        warnings: styleWarnings(content),
        verification: verificationLevel(content.citations),
      };
    },
  );

  // Evidence download (P2-07). Always an attachment of unknown type: a copy of someone else's
  // page must never run in NALARA's origin.
  app.get(
    '/evidence/:id/file',
    { config: { permission: 'articles.read' } },
    async (request, reply) => {
      const { id } = parseOrThrow(idParams, request.params);
      if (!uuid.safeParse(id).success) throw new AppError('NOT_FOUND');
      const file = await getEvidenceFile(db, id);
      if (file === null) throw new AppError('NOT_FOUND');
      const digest = file.sha256.toString('hex');
      return reply
        .header('content-type', 'application/octet-stream')
        .header(
          'content-disposition',
          `attachment; filename="nalara-bukti-${digest.slice(0, 12)}.bin"`,
        )
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cache-control', 'private, no-store')
        .header('x-evidence-sha256', digest)
        .send(file.body);
    },
  );

  // Server-side preview: the editor shows exactly the blocks a save would store.
  app.post(
    '/articles/preview',
    {
      config: { permission: 'articles.write' },
      bodyLimit: EDITOR_BODY_LIMIT_BYTES,
      preHandler: guards.requireCsrf,
    },
    async (request) => {
      const input = parseOrThrow(previewSchema, request.body);
      const { blocks, issues } = parseMarkdown(input.bodySource, {
        citationIds: input.citations.map((citation) => citation.id),
      });
      return {
        blocks,
        issues,
        verification: verificationLevel(input.citations),
        warnings: styleWarnings({ title: input.title, dek: input.dek, body: blocks }),
        // Images the preview can draw; an id missing here is not in the library.
        media: Object.fromEntries(await mediaForBody(db, blocks)),
      };
    },
  );
}
