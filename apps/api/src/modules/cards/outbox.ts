// Kartu IG to Telegram (P5-04b, founder's "Opsi A"). Right after an article is published, the API
// renders its cards (the same images the OS shows) and stores them with the caption. The worker
// sends them to the founder's chat (cards/telegram-post.ts); the founder posts to Instagram.
//
// Rendering never blocks publishing: the caller runs this after the publish committed, and a
// failure only means no album (the cards stay available in the OS).
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { articles, cardOutbox } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { getPublicMediaFile } from '../media/media.ts';
import { publicArticle } from '../public/articles.ts';
import { buildDeck } from './deck.ts';
import type { Deck } from './deck.ts';
import { renderCard } from './render.ts';

type Db = NodePgDatabase<typeof schema>;

/** satori decodes PNG and JPEG; other stored types simply get a type-only cover. */
const DRAWABLE = new Set(['image/png', 'image/jpeg']);

/** One card as PNG. The cover photo is used only if readers may see it (licensed, credited). */
export async function renderDeckSlide(db: Db, deck: Deck, index: number): Promise<Buffer | null> {
  const slide = deck.slides[index];
  if (slide === undefined) return null;
  let image: string | null = null;
  if (slide.kind === 'cover' && slide.imageId !== null) {
    const file = await getPublicMediaFile(db, slide.imageId);
    if (file !== null && DRAWABLE.has(file.mime)) {
      image = `data:${file.mime};base64,${file.data.toString('base64')}`;
    }
  }
  return renderCard(slide, index, deck.slides.length, deck.context, image);
}

export type CardPostOutcome = 'queued' | 'already_queued' | 'not_published';

/**
 * Renders the cards of a published article and queues them for Telegram. Reads the article the
 * way readers see it, so a card can never show a draft. Safe to call twice for the same revision.
 */
export async function queueCardPost(
  db: Db,
  articleId: string,
  { origin }: { readonly origin: string | null },
): Promise<CardPostOutcome> {
  const [row] = await db
    .select({ slug: articles.slug, revisionId: articles.approvedRevisionId })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.status, 'published')));
  if (row?.revisionId === null || row?.revisionId === undefined) return 'not_published';
  const article = await publicArticle(db, row.slug);
  if (article === null) return 'not_published';

  const deck = buildDeck(article, { origin });
  const slides: Buffer[] = [];
  for (let index = 0; index < deck.slides.length; index += 1) {
    const png = await renderDeckSlide(db, deck, index);
    if (png !== null) slides.push(png);
  }
  const inserted = await db
    .insert(cardOutbox)
    .values({
      articleId,
      revisionId: row.revisionId,
      title: article.title.slice(0, 300),
      caption: deck.caption.slice(0, 4000),
      slides,
    })
    .onConflictDoNothing()
    .returning({ id: cardOutbox.id });
  return inserted.length > 0 ? 'queued' : 'already_queued';
}
