// Public homepage (P1-06, news front page): the news comes first. A lead story with the next
// headlines beside it, the latest stream, then one section per topic. How NALARA works (Rana and
// the three steps) closes the page as a short trust note. Before launch (ADR-015) the API answers
// 404 for everything public, and this page shows the placeholder instead.
import Link from 'next/link';
import type { Metadata } from 'next';
import { Rana } from '../components/brand';
import { ComingSoon, Headline, Kicker, LeadStory, StoryTime } from '../components/public';
import { publicArticles, publicCategories } from '../lib/public-api';
import type { PublicArticleSummary } from '../lib/public-api';
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

const TOP_COUNT = 4; // headlines beside the lead
const LATEST_COUNT = 6;
const PER_TOPIC = 3;

const editionDate = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});

export default async function HomePage() {
  const latest = await publicArticles({ limit: 1 + TOP_COUNT + LATEST_COUNT });
  if (latest === null || latest.articles.length === 0) return <ComingSoon />;
  const [lead, ...others] = latest.articles;
  const top = others.slice(0, TOP_COUNT);
  const stream = others.slice(TOP_COUNT);

  // One section per topic, without repeating a story already shown above.
  const shown = new Set(latest.articles.map((article) => article.slug));
  const categories = (await publicCategories()) ?? [];
  const sections = (
    await Promise.all(
      categories.map(async (category) => {
        const page = await publicArticles({ category: category.slug, limit: PER_TOPIC + 6 });
        const stories = (page?.articles ?? [])
          .filter((article) => !shown.has(article.slug))
          .slice(0, PER_TOPIC);
        return { category, stories };
      }),
    )
  ).filter((section) => section.stories.length > 0);

  return (
    <div className="news">
      <h1 className="visually-hidden">NALARA: berita hari ini</h1>
      <p className="edition">
        <time dateTime={new Date().toISOString().slice(0, 10)}>
          {editionDate.format(new Date())}
        </time>
        <span>Media penjelas Indonesia</span>
      </p>

      <section className="news-top" aria-label="Berita utama">
        {lead !== undefined && <LeadStory article={lead} />}
        {top.length > 0 && (
          <ol className="news-top-list">
            {top.map((article) => (
              <li key={article.slug}>
                <Headline article={article} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {stream.length > 0 && (
        <section className="news-band" aria-labelledby="terbaru">
          <h2 id="terbaru" className="band-title">
            Terbaru
          </h2>
          <ol className="stream">
            {stream.map((article) => (
              <StreamItem key={article.slug} article={article} />
            ))}
          </ol>
        </section>
      )}

      {sections.map(({ category, stories }) => (
        <section
          key={category.slug}
          className="news-band"
          aria-labelledby={`topik-${category.slug}`}
        >
          <h2 id={`topik-${category.slug}`} className="band-title">
            <Link href={`/topik/${category.slug}`}>{category.name}</Link>
          </h2>
          <div className="band-grid">
            {stories.map((article) => (
              <Headline key={article.slug} article={article} withDek withTopic={false} />
            ))}
          </div>
          <p className="band-more">
            <Link href={`/topik/${category.slug}`}>Semua berita {category.name}</Link>
          </p>
        </section>
      ))}

      <aside className="trust-note" aria-labelledby="cara-kerja">
        <Rana pose="memeriksa" className="trust-note-art" />
        <div>
          <h2 id="cara-kerja">Kenapa bisa dipercaya</h2>
          <p>
            Setiap berita ditelusuri sampai sumber aslinya, angkanya dicocokkan, dan barang buktinya
            dilampirkan di bawah artikel. Stempel di tiap berita menunjukkan seberapa kuat buktinya.
          </p>
          <p>
            <Link href="/tentang#verifikasi">Cara kami memverifikasi</Link>
          </p>
        </div>
      </aside>
    </div>
  );
}

function StreamItem({ article }: { readonly article: PublicArticleSummary }) {
  return (
    <li className="stream-item">
      <StoryTime iso={article.publishedAt} />
      <div>
        <Kicker article={article} />
        <h3 className="stream-title">
          <Link href={`/artikel/${article.slug}`}>{article.title}</Link>
        </h3>
      </div>
    </li>
  );
}
