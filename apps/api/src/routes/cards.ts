// Instagram cards for the founder (Kartu NALARA). Inside the OS scope (founder session + policy).
// Cards exist only for PUBLISHED articles: the deck reads the same data readers see, so a card
// can never show a draft, an unchecked number or an editor note.
import type { FastifyInstance } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { parseOrThrow } from '../lib/validation.ts';
import { buildDeck } from '../modules/cards/deck.ts';
import type { Deck } from '../modules/cards/deck.ts';
import { renderDeckSlide } from '../modules/cards/outbox.ts';
import { publicArticle } from '../modules/public/articles.ts';
import type { PublicArticle } from '../modules/public/articles.ts';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function slugParam(params: unknown): string {
  const { slug } = parseOrThrow(z.object({ slug: z.string() }), params);
  if (slug.length > 120 || !SLUG.test(slug)) throw new AppError('NOT_FOUND');
  return slug;
}

export function registerCardRoutes(
  app: FastifyInstance,
  { db, origin }: { readonly db: NodePgDatabase<typeof schema>; readonly origin: string | null },
): void {
  const load = async (slug: string): Promise<{ article: PublicArticle; deck: Deck }> => {
    const article = await publicArticle(db, slug);
    if (article === null) throw new AppError('NOT_FOUND');
    return { article, deck: buildDeck(article, { origin }) };
  };

  app.get('/cards/:slug', { config: { permission: 'articles.read' } }, async (request) => {
    const { article, deck } = await load(slugParam(request.params));
    return {
      slug: article.slug,
      title: article.title,
      slides: deck.slides.map((slide, index) => ({ number: index + 1, kind: slide.kind })),
      caption: deck.caption,
    };
  });

  app.get(
    '/cards/:slug/:number',
    { config: { permission: 'articles.read' } },
    async (request, reply) => {
      const { number } = parseOrThrow(z.object({ number: z.string() }), request.params);
      const match = /^([1-9]\d?)\.png$/.exec(number);
      if (match === null) throw new AppError('NOT_FOUND');
      const { deck } = await load(slugParam(request.params));
      const index = Number(match[1]) - 1;
      // Only images readers may see (licensed, credited, used by the published revision).
      const png = await renderDeckSlide(db, deck, index);
      if (png === null) throw new AppError('NOT_FOUND');
      return reply
        .header('content-type', 'image/png')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header(
          'content-disposition',
          `inline; filename="nalara-${slugParam(request.params)}-${String(index + 1).padStart(2, '0')}.png"`,
        )
        .header('cache-control', 'private, no-store')
        .send(png);
    },
  );
}
