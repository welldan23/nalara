// Public homepage (P1-06): latest published articles. Before launch (ADR-015) the API answers
// 404 for everything public, and this page shows the placeholder instead.
import { CaraMenelusuri } from '../components/brand';
import { ArticleCard, ComingSoon, LeadArticle } from '../components/public';
import type { Metadata } from 'next';
import { publicArticles } from '../lib/public-api';
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  pageAlternates,
  pageOpenGraph,
} from '../lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  alternates: pageAlternates('/'),
  openGraph: pageOpenGraph({
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    path: '/',
  }),
};

export default async function HomePage() {
  const latest = await publicArticles({ limit: 12 });
  if (latest === null || latest.articles.length === 0) return <ComingSoon />;
  const [lead, ...rest] = latest.articles;
  return (
    <div className="front">
      <h1 className="front-title">Biar semua paham.</h1>
      <p className="front-text">
        Kami menelusuri klaim sampai ke sumbernya, lalu menjelaskannya. Buktinya selalu kami
        lampirkan.
      </p>
      <div className="front-grid">
        {lead !== undefined && <LeadArticle article={lead} />}
        {rest.length > 0 && (
          <section aria-labelledby="terbaru" className="front-list">
            <h2 id="terbaru" className="section-title">
              Berkas lainnya
            </h2>
            <div className="entries">
              {rest.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
          </section>
        )}
      </div>
      <CaraMenelusuri />
    </div>
  );
}
