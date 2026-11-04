// Public homepage (P1-06): latest published articles. Before launch (ADR-015) the API answers
// 404 for everything public, and this page shows the placeholder instead.
import { ArticleCard, ComingSoon } from '../components/public';
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
  return (
    <>
      <h1 className="tagline">Biar semua paham.</h1>
      <section aria-labelledby="terbaru">
        <h2 id="terbaru" className="section-title">
          Terbaru
        </h2>
        <div className="cards">
          {latest.articles.map((article) => (
            <ArticleCard key={article.slug} article={article} />
          ))}
        </div>
      </section>
    </>
  );
}
