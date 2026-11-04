// sitemap.xml (P1-08): static pages, topics and every published article, from the public API
// only. Empty before launch.
import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { publicArticles, publicCategories } from '../lib/public-api';
import type { PublicArticleSummary } from '../lib/public-api';
import { absoluteUrl, siteOrigin } from '../lib/site';

// Hard stop so a broken cursor can never loop forever: 100 pages × 30 = 3000 articles.
const MAX_PAGES = 100;

async function allArticles(): Promise<PublicArticleSummary[] | null> {
  const articles: PublicArticleSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await publicArticles({ limit: 30, ...(cursor ? { cursor } : {}) });
    if (result === null) return null;
    articles.push(...result.articles);
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return articles;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = siteOrigin();
  if (origin === null) return [];
  let categories;
  let articles;
  try {
    [categories, articles] = await Promise.all([publicCategories(), allArticles()]);
  } catch {
    return [];
  }
  if (categories === null || articles === null) return [];
  const url = (path: string) => absoluteUrl(origin, path);
  const newest = articles[0]?.publishedAt;
  return [
    { url: url('/'), ...(newest ? { lastModified: newest } : {}), changeFrequency: 'daily' },
    ...categories.map((category) => ({
      url: url(`/topik/${category.slug}`),
      changeFrequency: 'daily' as const,
    })),
    ...articles.map((article) => ({
      url: url(`/artikel/${article.slug}`),
      lastModified: article.publishedAt,
    })),
    { url: url('/koreksi'), changeFrequency: 'weekly' },
    { url: url('/tentang'), changeFrequency: 'monthly' },
  ];
}
