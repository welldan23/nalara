// Articles of one topic, newest first, with "older articles" paging (P1-06).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArticleCard } from '../../../components/public';
import { publicArticles, publicCategories } from '../../../lib/public-api';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function topic(slug: string) {
  if (!SLUG.test(slug)) return null;
  const categories = await publicCategories();
  return categories?.find((category) => category.slug === slug) ?? null;
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const found = await topic((await params).slug);
  return found === null ? {} : { title: found.name, description: found.description ?? undefined };
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
        <p className="muted">Belum ada artikel di topik ini.</p>
      ) : (
        <div className="cards">
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
