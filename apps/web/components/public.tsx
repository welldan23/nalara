// Shared pieces of the public reading pages (P1-06).
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PublicArticleSummary } from '../lib/public-api';

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

export function ArticleCard({ article }: { readonly article: PublicArticleSummary }): ReactNode {
  const badge = TYPE_BADGES[article.articleType];
  return (
    <article className="card">
      <p className="kicker">
        <Link href={`/topik/${article.category.slug}`}>{article.category.name}</Link>
        {badge !== null && badge !== undefined && <span className="badge">{badge}</span>}
      </p>
      <h2 className="card-title">
        <Link href={`/artikel/${article.slug}`}>{article.title}</Link>
      </h2>
      {article.dek !== '' && <p className="card-dek">{article.dek}</p>}
      <p className="muted card-meta">
        <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
      </p>
    </article>
  );
}

export function ComingSoon(): ReactNode {
  return (
    <>
      <h1>Biar semua paham.</h1>
      <p>
        NALARA sedang dibangun: media dan data publik Indonesia yang menjelaskan berita, kebijakan,
        dan angka dengan sumber yang bisa ditelusuri.
      </p>
      <p className="muted">Belum ada artikel yang diterbitkan.</p>
    </>
  );
}
