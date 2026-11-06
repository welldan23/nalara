// Shared pieces of the public reading pages (P1-06, "Tiga lapis" redesign).
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PublicArticleSummary } from '../lib/public-api';
import { TigaLapis, joinNames } from './brand';

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

/** Where the article is rooted, in one plain sentence; nothing when no source was checked. */
function Roots({ roots }: { readonly roots: readonly string[] }): ReactNode {
  if (roots.length === 0) return null;
  return <p className="roots">Berakar pada {joinNames(roots)}</p>;
}

function Topic({ article }: { readonly article: PublicArticleSummary }): ReactNode {
  const badge = TYPE_BADGES[article.articleType];
  return (
    <p className="topic">
      <Link href={`/topik/${article.category.slug}`}>{article.category.name}</Link>
      {badge !== null && badge !== undefined && <span className="badge">{badge}</span>}
    </p>
  );
}

/** The newest article, given the room of a front page. */
export function LeadArticle({ article }: { readonly article: PublicArticleSummary }): ReactNode {
  return (
    <article className="lead">
      <Topic article={article} />
      <h2 className="lead-title">
        <Link href={`/artikel/${article.slug}`}>{article.title}</Link>
      </h2>
      {article.dek !== '' && <p className="lead-dek">{article.dek}</p>}
      <p className="meta">
        <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
      </p>
      <Roots roots={article.roots} />
    </article>
  );
}

export function ArticleCard({ article }: { readonly article: PublicArticleSummary }): ReactNode {
  return (
    <article className="entry">
      <Topic article={article} />
      <h3 className="entry-title">
        <Link href={`/artikel/${article.slug}`}>{article.title}</Link>
      </h3>
      {article.dek !== '' && <p className="entry-dek">{article.dek}</p>}
      <p className="meta">
        <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
      </p>
      <Roots roots={article.roots} />
    </article>
  );
}

export function ComingSoon(): ReactNode {
  return (
    <>
      <section className="hero">
        <h1 className="hero-title">Biar semua paham.</h1>
        <p className="hero-text">
          NALARA menjelaskan berita, kebijakan, dan angka di Indonesia dengan sumber yang bisa kamu
          telusuri sendiri. Artikel pertama sedang ditulis.
        </p>
      </section>
      <TigaLapis />
    </>
  );
}
