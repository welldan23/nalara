// Shared pieces of the public reading pages (P1-06, "Berkas perkara" design).
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PublicArticleSummary } from '../lib/public-api';
import { CaraMenelusuri, Rana, Stamp, joinNames } from './brand';

export const TYPE_BADGES: Readonly<Record<string, string | null>> = {
  explainer: null,
  analysis: 'Analisis',
  opinion: 'Opini',
};

export const VERIFICATION_PUBLIC: Readonly<Record<string, { label: string; detail: string }>> = {
  TERVERIFIKASI: {
    label: 'Terverifikasi',
    detail: 'Klaim utama dikonfirmasi sumber primer atau setidaknya dua sumber independen.',
  },
  SEBAGIAN: {
    label: 'Sebagian terverifikasi',
    detail: 'Sudah dicek ke sumber, tetapi sebagian detail baru dari satu sumber.',
  },
  BELUM_TERVERIFIKASI: {
    label: 'Tanpa sumber terverifikasi',
    detail: 'Terbit dengan alasan editorial yang dicantumkan di artikel.',
  },
};

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'long',
  timeZone: 'Asia/Jakarta',
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/** The evidence behind a piece, in one line; nothing when no source was checked. */
function Evidence({ roots }: { readonly roots: readonly string[] }): ReactNode {
  if (roots.length === 0) return null;
  return (
    <p className="evidence-line">
      <span className="evidence-line-label">Bukti</span> {joinNames(roots)}
    </p>
  );
}

const timeFormat = new Intl.DateTimeFormat('id-ID', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
});
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });
const shortDate = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Jakarta',
});

/** "14.30 WIB" for today's stories (Jakarta time), "7 Nov" for older ones. */
export function storyTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return dayKey.format(date) === dayKey.format(now)
    ? `${timeFormat.format(date)} WIB`
    : shortDate.format(date);
}

export function StoryTime({ iso }: { readonly iso: string }): ReactNode {
  return (
    <time className="story-time" dateTime={iso}>
      {storyTime(iso)}
    </time>
  );
}

/** Topic above a headline, plus "Analisis"/"Opini" when the piece is not a plain explainer. */
export function Kicker({
  article,
  withTopic = true,
}: {
  readonly article: PublicArticleSummary;
  readonly withTopic?: boolean;
}): ReactNode {
  const badge = TYPE_BADGES[article.articleType];
  const hasBadge = badge !== null && badge !== undefined;
  if (!withTopic && !hasBadge) return null;
  return (
    <p className="kicker">
      {withTopic && <Link href={`/topik/${article.category.slug}`}>{article.category.name}</Link>}
      {hasBadge && <span className="badge">{badge}</span>}
    </p>
  );
}

/** The day's main story: the biggest headline on the page, with its summary and evidence. */
export function LeadStory({ article }: { readonly article: PublicArticleSummary }): ReactNode {
  return (
    <article className="lead-story">
      <Kicker article={article} />
      <h2 className="lead-story-title">
        <Link href={`/artikel/${article.slug}`}>{article.title}</Link>
      </h2>
      {article.dek !== '' && <p className="lead-story-dek">{article.dek}</p>}
      <div className="lead-story-meta">
        <StoryTime iso={article.publishedAt} />
        <Evidence roots={article.roots} />
        <Stamp level={article.verification} />
      </div>
    </article>
  );
}

/** A headline in a list or a topic section. */
export function Headline({
  article,
  withDek = false,
  withTopic = true,
}: {
  readonly article: PublicArticleSummary;
  readonly withDek?: boolean;
  /** Off inside a topic's own section, where the topic is the section title. */
  readonly withTopic?: boolean;
}): ReactNode {
  return (
    <article className="headline">
      <Kicker article={article} withTopic={withTopic} />
      <h3 className="headline-title">
        <Link href={`/artikel/${article.slug}`}>{article.title}</Link>
      </h3>
      {withDek && article.dek !== '' && <p className="headline-dek">{article.dek}</p>}
      <StoryTime iso={article.publishedAt} />
    </article>
  );
}

export function ArticleCard({ article }: { readonly article: PublicArticleSummary }): ReactNode {
  const badge = TYPE_BADGES[article.articleType];
  return (
    <article className="entry">
      <p className="file-line">
        <Link href={`/topik/${article.category.slug}`}>{article.category.name}</Link>
        <span className="file-sep" aria-hidden="true">
          /
        </span>
        <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
        {badge !== null && badge !== undefined && <span className="badge">{badge}</span>}
      </p>
      <h3 className="entry-title">
        <Link href={`/artikel/${article.slug}`}>{article.title}</Link>
      </h3>
      {article.dek !== '' && <p className="entry-dek">{article.dek}</p>}
      <Evidence roots={article.roots} />
    </article>
  );
}

export function ComingSoon(): ReactNode {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1 className="hero-title">Biar semua paham.</h1>
          <p className="hero-text">
            NALARA menelusuri berita, kebijakan, dan angka di Indonesia sampai ke sumbernya, lalu
            menjelaskannya dengan bahasa sehari-hari. Berkas pertama sedang ditelusuri.
          </p>
        </div>
        <Rana pose="rana" className="hero-art" priority />
      </section>
      <CaraMenelusuri />
    </>
  );
}
