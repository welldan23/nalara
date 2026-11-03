// Article reading page (P1-06, PRD v4 §4.1): title, summary, body, numbered sources, dates and
// the verification label. Only published articles exist here; everything else is a 404.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleBody, CitationList } from '../../../components/article-body';
import { TYPE_BADGES, VERIFICATION_PUBLIC, formatDate } from '../../../components/public';
import { publicArticle } from '../../../lib/public-api';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function load(slug: string) {
  return SLUG.test(slug) ? publicArticle(slug) : null;
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const article = await load((await params).slug);
  return article === null ? {} : { title: article.title, description: article.dek || undefined };
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
      <p className="kicker">
        <Link href={`/topik/${article.category.slug}`}>{article.category.name}</Link>
        {badge !== null && badge !== undefined && <span className="badge">{badge}</span>}
      </p>
      <h1>{article.title}</h1>
      {article.dek !== '' && <p className="dek">{article.dek}</p>}
      <p className="muted article-meta">
        Terbit{' '}
        <time dateTime={article.firstPublishedAt}>{formatDate(article.firstPublishedAt)}</time>
        {updated && (
          <>
            {' '}
            · diperbarui{' '}
            <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
          </>
        )}
      </p>
      {verification !== undefined && (
        <p className={`verification verification-${article.verification}`}>
          <strong>{verification.label}.</strong> {verification.detail}{' '}
          <Link href="/tentang#verifikasi">Cara kami memverifikasi</Link>
        </p>
      )}
      {article.sourceException !== null && (
        <p className="notice-warn">
          <strong>Catatan redaksi:</strong> {article.sourceException}
        </p>
      )}
      <ArticleBody blocks={article.body} citations={article.citations} />
      {article.methodNote !== null && (
        <section aria-labelledby="metode" className="method">
          <h2 id="metode">Catatan metode</h2>
          <p>{article.methodNote}</p>
        </section>
      )}
      <CitationList citations={article.citations} />
    </article>
  );
}
