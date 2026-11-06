// Article reading page (P1-06, PRD v4 §4.1; "Tiga lapis" layout: head, body, and the sources as roots): title, summary, body, numbered sources, dates and
// the verification label, and any substantial corrections (P1-07). Only published articles exist here; everything else is a 404.
import type { Metadata } from 'next';
import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleBody, CitationList } from '../../../components/article-body';
import { TYPE_BADGES, VERIFICATION_PUBLIC, formatDate } from '../../../components/public';
import { publicArticle } from '../../../lib/public-api';
import { pageAlternates, pageOpenGraph } from '../../../lib/site';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Metadata and page share one request per render (React cache).
const load = cache(async (slug: string) => {
  return SLUG.test(slug) ? publicArticle(slug) : null;
});

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const article = await load((await params).slug);
  if (article === null) return {};
  const path = `/artikel/${article.slug}`;
  const description = article.dek === '' ? undefined : article.dek;
  return {
    title: article.title,
    description,
    alternates: pageAlternates(path),
    openGraph: pageOpenGraph(
      { title: article.title, path, ...(description ? { description } : {}) },
      {
        type: 'article',
        publishedTime: article.firstPublishedAt,
        modifiedTime: article.publishedAt,
        section: article.category.name,
      },
    ),
  };
}

export default async function ArticlePage({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const article = await load((await params).slug);
  if (article === null) notFound();
  const badge = TYPE_BADGES[article.articleType];
  const verification = VERIFICATION_PUBLIC[article.verification];
  const updated = article.publishedAt !== article.firstPublishedAt;

  return (
    <article className="reading">
      <header className="article-head">
        <p className="topic">
          <Link href={`/topik/${article.category.slug}`}>{article.category.name}</Link>
          {badge !== null && badge !== undefined && <span className="badge">{badge}</span>}
        </p>
        <h1>{article.title}</h1>
        {article.dek !== '' && <p className="dek">{article.dek}</p>}
        <p className="meta article-meta">
          Terbit{' '}
          <time dateTime={article.firstPublishedAt}>{formatDate(article.firstPublishedAt)}</time>
          {updated && (
            <>
              , diperbarui{' '}
              <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
            </>
          )}
        </p>
        {verification !== undefined && (
          <p className={`verification verification-${article.verification}`}>
            <strong className="verification-label">{verification.label}.</strong>{' '}
            <span>
              {verification.detail} <Link href="/tentang#verifikasi">Cara kami memverifikasi</Link>
            </span>
          </p>
        )}
      </header>
      {article.corrections.length > 0 && (
        <aside className="corrections" aria-labelledby="koreksi" data-testid="corrections">
          <h2 id="koreksi">Koreksi</h2>
          <ul>
            {article.corrections.map((correction, index) => (
              <li key={`${correction.visibleAt}-${String(index)}`}>
                <time dateTime={correction.visibleAt}>{formatDate(correction.visibleAt)}</time>:{' '}
                {correction.description}
              </li>
            ))}
          </ul>
          <p className="muted">
            <Link href="/koreksi">Semua koreksi</Link>
          </p>
        </aside>
      )}
      {article.sourceException !== null && (
        <p className="notice-warn">
          <strong>Catatan redaksi:</strong> {article.sourceException}
        </p>
      )}
      <ArticleBody
        blocks={article.body}
        citations={article.citations}
        media={article.media}
        charts={article.charts}
      />
      {(article.citations.length > 0 || article.methodNote !== null) && (
        <div className="akar">
          <p className="akar-lead">
            Akar tulisan ini. Klaim penting di atas berasal dari sumber berikut, dan kamu bisa
            membukanya sendiri.
          </p>
          <CitationList citations={article.citations} />
          {article.methodNote !== null && (
            <section aria-labelledby="metode" className="method">
              <h2 id="metode">Catatan metode</h2>
              <p>{article.methodNote}</p>
            </section>
          )}
        </div>
      )}
    </article>
  );
}
