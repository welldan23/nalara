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

/** The newest article, laid on the desk as an open case file. */
export function LeadArticle({ article }: { readonly article: PublicArticleSummary }): ReactNode {
  const badge = TYPE_BADGES[article.articleType];
  return (
    <article className="lead folder">
      <p className="folder-tab">
        <Link href={`/topik/${article.category.slug}`}>{article.category.name}</Link>
      </p>
      <div className="folder-sheet">
        <p className="file-line">
          Berkas <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
          {badge !== null && badge !== undefined && <span className="badge">{badge}</span>}
        </p>
        <h2 className="lead-title">
          <Link href={`/artikel/${article.slug}`}>{article.title}</Link>
        </h2>
        {article.dek !== '' && <p className="lead-dek">{article.dek}</p>}
        <div className="lead-foot">
          <Evidence roots={article.roots} />
          <Stamp level={article.verification} />
        </div>
      </div>
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
