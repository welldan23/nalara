// Public reading API (P1-06, PRD v4 §4.1, A §8.1). No authentication, no cookies read, GET only.
// While the launch flag is off (ADR-015) every article route answers 404, exactly like a missing
// article, so nothing published can leak before launch.
import type { FastifyPluginAsync } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { parseOrThrow } from '../lib/validation.ts';
import { SLUG_PATTERN } from '../modules/articles/articles.ts';
import {
  PUBLIC_PAGE_MAX,
  publicArticle,
  publicArticles,
  publicCategories,
  publicCorrections,
} from '../modules/public/articles.ts';
import { getPublicMediaFile } from '../modules/media/media.ts';
import { mediaId, sendImage } from './media.ts';

export interface PublicRoutesOptions {
  readonly db: NodePgDatabase<typeof schema>;
  readonly enabled: boolean;
}

const slug = z.string().max(120).regex(SLUG_PATTERN);

const listQuery = z.strictObject({
  category: slug.optional(),
  limit: z.coerce.number().int().min(1).max(PUBLIC_PAGE_MAX).optional(),
  cursor: z.string().max(512).optional(),
});

export const publicRoutes: FastifyPluginAsync<PublicRoutesOptions> = (app, { db, enabled }) => {
  const requireLaunch = () => {
    if (!enabled) throw new AppError('NOT_FOUND');
  };

  app.get('/categories', async () => {
    requireLaunch();
    return { categories: await publicCategories(db) };
  });

  app.get('/articles', async (request) => {
    requireLaunch();
    const query = parseOrThrow(listQuery, request.query);
    return publicArticles(db, {
      ...(query.category !== undefined ? { category: query.category } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
  });

  app.get('/articles/:slug', async (request) => {
    requireLaunch();
    const params = z.strictObject({ slug: z.string() }).parse(request.params);
    // Malformed, unknown, draft, in review, approved-not-published, archived: one answer.
    if (!slug.safeParse(params.slug).success) throw new AppError('NOT_FOUND');
    const article = await publicArticle(db, params.slug);
    if (article === null) throw new AppError('NOT_FOUND');
    return { article };
  });

  // Images of published articles only, licensed and credited (P1-09); everything else 404.
  app.get('/media/:id', async (request, reply) => {
    requireLaunch();
    const file = await getPublicMediaFile(db, mediaId(request.params));
    if (file === null) throw new AppError('NOT_FOUND');
    return sendImage(reply, file, 'public, max-age=3600');
  });

  app.get('/corrections', async () => {
    requireLaunch();
    return { corrections: await publicCorrections(db) };
  });

  return Promise.resolve();
};
