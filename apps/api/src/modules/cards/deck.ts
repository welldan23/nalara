// Instagram cards (Kartu NALARA): turns a PUBLISHED article into a carousel deck and a caption.
// Pure: no I/O, so the deck is fully testable. Every number on a card comes from a stat block,
// whose citation the publish gate has already checked (PRD v4 §7); nothing here invents text.
import type { Block } from '../articles/content.ts';
import type { PublicArticle } from '../public/articles.ts';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
/** Instagram allows 20; past about seven slides people stop swiping. */
export const MAX_SLIDES = 7;
const MAX_STATS = 3;
const MAX_POINTS = 3;
const MAX_EVIDENCE = 4;

export interface CardContext {
  readonly topic: string;
  readonly dateLabel: string;
  /** "Bukti: BPS dan BI", or null when nothing was checked. */
  readonly evidenceLine: string | null;
}

export type Slide =
  | {
      readonly kind: 'cover';
      readonly title: string;
      readonly dek: string;
      readonly verification: string;
      /** A licensed image from the article (its id), or null for a type-only cover. */
      readonly imageId: string | null;
      readonly credit: string | null;
    }
  | {
      readonly kind: 'stat';
      readonly label: string;
      readonly value: string;
      readonly unit: string;
      readonly period: string;
      readonly source: string;
    }
  | { readonly kind: 'point'; readonly heading: string; readonly text: string }
  | { readonly kind: 'quote'; readonly text: string; readonly attribution: string }
  | {
      readonly kind: 'evidence';
      readonly items: readonly { readonly publisher: string; readonly title: string }[];
      readonly more: number;
      readonly link: string;
    };

export interface Deck {
  readonly context: CardContext;
  readonly slides: readonly Slide[];
  readonly caption: string;
}

const plain = (content: readonly { readonly text: string }[]): string =>
  content
    .map((part) => part.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

/** Shortens at a sentence end when possible, else at a word, and marks the cut with "…". */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  if (sentence >= max * 0.5) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[,;:]$/, '')}…`;
}

/** "BPS", "BPS dan BI", "BPS, BI, dan OJK". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0] ?? ''} dan ${names[1] ?? ''}`;
  return `${names.slice(0, -1).join(', ')}, dan ${names.at(-1) ?? ''}`;
}

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});

const VERIFICATION_STAMP: Readonly<Record<string, string>> = {
  TERVERIFIKASI: 'Terverifikasi',
  SEBAGIAN: 'Sebagian terverifikasi',
};

/** Each h2 with the first paragraph after it: the article's own points, in its own words. */
function points(body: readonly Block[]): { heading: string; text: string }[] {
  const found: { heading: string; text: string }[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const block = body[index];
    if (block?.type !== 'heading' || block.level !== 2) continue;
    const next = body.slice(index + 1).find((candidate) => candidate.type !== 'image');
    if (next?.type !== 'paragraph') continue;
    found.push({ heading: clip(plain(block.content), 60), text: clip(plain(next.content), 260) });
  }
  return found;
}

export interface DeckOptions {
  /** Public origin for the "read more" link, e.g. https://nalara.id; null before a domain exists. */
  readonly origin: string | null;
}

export function buildDeck(article: PublicArticle, options: DeckOptions): Deck {
  const citationById = new Map(article.citations.map((citation) => [citation.id, citation]));
  const link =
    options.origin === null
      ? `/artikel/${article.slug}`
      : `${new URL(options.origin).host}/artikel/${article.slug}`;
  const context: CardContext = {
    topic: article.category.name,
    dateLabel: dateFormat.format(article.publishedAt),
    evidenceLine: article.roots.length > 0 ? `Bukti: ${joinNames(article.roots)}` : null,
  };

  const cover = article.body.find((block) => block.type === 'image');
  const coverMedia = cover === undefined ? undefined : article.media[cover.mediaId];
  const slides: Slide[] = [
    {
      kind: 'cover',
      title: clip(article.title, 110),
      dek: clip(article.dek, 150),
      verification: VERIFICATION_STAMP[article.verification] ?? '',
      imageId: cover !== undefined && coverMedia !== undefined ? cover.mediaId : null,
      credit:
        coverMedia === undefined
          ? null
          : coverMedia.aiGenerated
            ? 'Ilustrasi AI'
            : coverMedia.attribution === null
              ? null
              : `Foto: ${coverMedia.attribution}`,
    },
  ];

  const middle: Slide[] = [];
  for (const block of article.body) {
    if (block.type !== 'stat' || middle.length >= MAX_STATS) continue;
    const citation = citationById.get(block.citationId);
    middle.push({
      kind: 'stat',
      label: clip(block.label, 70),
      value: block.value,
      unit: block.unit,
      period: block.period,
      source: citation === undefined ? '' : `Bukti: ${citation.publisher}`,
    });
  }
  for (const point of points(article.body).slice(0, MAX_POINTS)) {
    middle.push({ kind: 'point', ...point });
  }
  const quote = article.body.find((block) => block.type === 'quote');
  if (quote !== undefined) {
    middle.push({
      kind: 'quote',
      text: clip(plain(quote.content), 200),
      attribution: clip(quote.attribution, 80),
    });
  }
  // Cover and evidence always stay; the middle is cut to fit.
  slides.push(...middle.slice(0, MAX_SLIDES - 2));

  const checked = article.citations;
  slides.push({
    kind: 'evidence',
    items: checked
      .slice(0, MAX_EVIDENCE)
      .map((citation) => ({ publisher: citation.publisher, title: clip(citation.title, 80) })),
    more: Math.max(0, checked.length - MAX_EVIDENCE),
    link,
  });

  return { context, slides, caption: buildCaption(article, slides, options) };
}

function hashtag(name: string): string {
  return `#${name.replace(/[^\p{L}\p{N}]+/gu, '')}`;
}

/** Ready to paste: summary, the key numbers, every source with its link, credits, and the link. */
export function buildCaption(
  article: PublicArticle,
  slides: readonly Slide[],
  options: DeckOptions,
): string {
  const lines: string[] = [article.title];
  if (article.dek !== '') lines.push('', article.dek);
  const facts = slides.flatMap((slide) => {
    if (slide.kind === 'stat') {
      return [`• ${slide.label}: ${slide.value} ${slide.unit} (${slide.period})`];
    }
    if (slide.kind === 'point') return [`• ${slide.heading}`];
    return [];
  });
  if (facts.length > 0) lines.push('', ...facts);
  if (article.citations.length > 0) {
    lines.push('', 'Barang bukti:');
    article.citations.forEach((citation, index) => {
      lines.push(`${String(index + 1)}. ${citation.publisher}: ${citation.url}`);
    });
  }
  const credits = Object.values(article.media).flatMap((media) => {
    if (media.aiGenerated) return ['Ilustrasi AI'];
    return media.attribution === null ? [] : [`Foto: ${media.attribution}`];
  });
  if (credits.length > 0) lines.push('', ...new Set(credits));
  const url =
    options.origin === null ? null : new URL(`/artikel/${article.slug}`, options.origin).href;
  lines.push('', url === null ? 'Baca lengkap di situs NALARA.' : `Baca lengkap: ${url}`);
  lines.push('', `#NALARA ${hashtag(article.category.name)}`);
  return lines.join('\n');
}
