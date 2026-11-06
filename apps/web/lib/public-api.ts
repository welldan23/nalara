// Server-side calls to the public reading API (P1-06). Deliberately separate from lib/api.ts:
// these requests never carry the visitor's cookies, so a public page is the same for everyone
// and can never show founder-only data, even to the founder.
import 'server-only';
import { cache } from 'react';
import { forwardedFor } from './forwarded';
import type { Block, ChartRender, CitationView, MediaRender } from '../components/article-body';
import type { VerificationLevel } from './api';

export interface PublicCategory {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
}

export interface PublicArticleSummary {
  readonly slug: string;
  readonly title: string;
  readonly dek: string;
  readonly articleType: 'explainer' | 'analysis' | 'opinion';
  readonly category: { readonly slug: string; readonly name: string };
  readonly publishedAt: string;
  readonly verification: VerificationLevel;
}

export interface PublicArticle extends PublicArticleSummary {
  readonly body: readonly Block[];
  readonly citations: readonly CitationView[];
  readonly methodNote: string | null;
  readonly sourceException: string | null;
  readonly firstPublishedAt: string;
  /** Substantial corrections, oldest first. */
  readonly corrections: readonly PublicCorrection[];
  /** Licensed images the body uses, by id (P1-09). */
  readonly media: Readonly<Record<string, MediaRender>>;
  /** Charted dataset versions, by `dataset@version` (P4-03). */
  readonly charts: Readonly<Record<string, ChartRender>>;
}

export interface PublicCorrection {
  readonly description: string;
  readonly visibleAt: string;
}

export interface PublicCorrectionEntry extends PublicCorrection {
  readonly article: { readonly slug: string; readonly title: string };
}

function apiBaseUrl(): string {
  const value = process.env['API_BASE_URL'];
  if (value === undefined || !/^https?:\/\/[^/\s]+$/.test(value)) {
    throw new Error('API_BASE_URL must be set to the internal API origin, e.g. http://api:4000');
  }
  return value;
}

/** GET a public API path; 404 (unknown, unpublished, or site not launched) → null. */
async function publicGet<T>(path: string): Promise<T | null> {
  const response = await fetch(`${apiBaseUrl()}/api/v1/public${path}`, {
    headers: { accept: 'application/json', ...(await forwardedFor()) },
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`public API answered ${String(response.status)} for ${path}`);
  return (await response.json()) as T;
}

/**
 * null while the site is not launched (ADR-015). Memoised per server render (React cache): the
 * navigation and the launch check for metadata share one API call per page.
 */
export const publicCategories = cache(async (): Promise<PublicCategory[] | null> => {
  const body = await publicGet<{ categories: PublicCategory[] }>('/categories');
  return body?.categories ?? null;
});

export async function publicArticles(options: {
  readonly category?: string;
  readonly cursor?: string;
  readonly limit?: number;
}): Promise<{ articles: PublicArticleSummary[]; nextCursor: string | null } | null> {
  const query = new URLSearchParams();
  if (options.category !== undefined) query.set('category', options.category);
  if (options.cursor !== undefined) query.set('cursor', options.cursor);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return publicGet(`/articles${suffix}`);
}

export async function publicArticle(slug: string): Promise<PublicArticle | null> {
  // The slug comes from the URL: encode it so it can only ever be one path segment.
  const body = await publicGet<{ article: PublicArticle }>(`/articles/${encodeURIComponent(slug)}`);
  return body?.article ?? null;
}

/** null while the site is not launched (ADR-015). */
export async function publicCorrections(): Promise<PublicCorrectionEntry[] | null> {
  const body = await publicGet<{ corrections: PublicCorrectionEntry[] }>('/corrections');
  return body?.corrections ?? null;
}

// --- NALARA Data (P4-04) ---

export interface PublicDatasetSummary {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly unit: string;
  readonly frequency: string;
  readonly publishedVersion: number;
  readonly publishedAt: string;
  readonly organization: string;
  readonly sourceName: string;
}

export interface PublicDatasetVersion {
  readonly version: number;
  readonly retrievedOn: string;
  readonly fileUrl: string;
  readonly spec: Readonly<Record<string, unknown>>;
  readonly revisionNote: string;
  readonly observationCount: number;
  readonly series: readonly string[];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly rawSha256: string;
  readonly observationsSha256: string;
  readonly createdAt: string;
}

export interface PublicDataset {
  readonly dataset: PublicDatasetSummary & {
    readonly sourcePageUrl: string;
    readonly methodology: string;
    readonly licenseStatus: string;
    readonly licenseNote: string | null;
    readonly attribution: string | null;
    readonly downloadable: boolean;
  };
  readonly versions: readonly PublicDatasetVersion[];
  readonly observations: readonly { series: string | null; period: string; value: number }[];
}

/** null while the site is not launched (ADR-015). */
export async function publicDatasets(): Promise<PublicDatasetSummary[] | null> {
  return (await publicGet<{ datasets: PublicDatasetSummary[] }>('/datasets'))?.datasets ?? null;
}

export async function publicDataset(slug: string): Promise<PublicDataset | null> {
  // The slug comes from the URL: encode it so it can only ever be one path segment.
  return publicGet<PublicDataset>(`/datasets/${encodeURIComponent(slug)}`);
}
