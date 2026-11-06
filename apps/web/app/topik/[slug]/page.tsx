// Articles of one topic, newest first, with "older articles" paging (P1-06).
import type { Metadata } from 'next';
import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Rana } from '../../../components/brand';
import { ArticleCard } from '../../../components/public';
import { publicArticles, publicCategories } from '../../../lib/public-api';
import { pageAlternates, pageOpenGraph } from '../../../lib/site';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Metadata and page share one request per render (React cache).
const topic = cache(async (slug: string) => {
  if (!SLUG.test(slug)) return null;
  const categories = await publicCategories();
  return categories?.find((category) => category.slug === slug) ?? null;
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ setelah?: string | string[] }>;
}): Promise<Metadata> {
  const found = await topic((await params).slug);
  if (found === null) return {};
  const path = `/topik/${found.slug}`;
  const description = found.description ?? undefined;
  return {
    title: found.name,
    description,
    alternates: pageAlternates(path),
    openGraph: pageOpenGraph({ title: found.name, path, ...(description ? { description } : {}) }),
    // Older pages are for readers; search engines get the topic page and the sitemap instead.
    ...((await searchParams).setelah !== undefined
      ? { robots: { index: false, follow: true } }
      : {}),
  };
}

export default async function TopicPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ setelah?: string | string[] }>;
}) {
  const { slug } = await params;
  const found = await topic(slug);
  if (found === null) notFound();
  const { setelah } = await searchParams;
  const cursor = typeof setelah === 'string' && setelah.length <= 512 ? setelah : undefined;
  let page;
  try {
    page = await publicArticles({ category: found.slug, limit: 12, ...(cursor ? { cursor } : {}) });
  } catch {
    // A tampered cursor is refused by the API (400): start from the newest instead.
    page = await publicArticles({ category: found.slug, limit: 12 });
  }
  if (page === null) notFound();

  return (
    <>
      <h1>{found.name}</h1>
      {found.description !== null && <p className="dek">{found.description}</p>}
      {page.articles.length === 0 ? (
        <div className="empty-state">
          <Rana pose="beristirahat" className="empty-state-art" />
          <p className="muted">Belum ada artikel di topik ini. Rana masih menelusuri.</p>
        </div>
      ) : (
        <div className="entries">
          {page.articles.map((article) => (
            <ArticleCard key={article.slug} article={article} />
          ))}
        </div>
      )}
      <nav className="pager" aria-label="Halaman artikel">
        {cursor !== undefined && <Link href={`/topik/${found.slug}`}>Terbaru</Link>}
        {page.nextCursor !== null && (
          <Link href={`/topik/${found.slug}?setelah=${encodeURIComponent(page.nextCursor)}`}>
            Artikel sebelumnya
          </Link>
        )}
      </nav>
    </>
  );
}
