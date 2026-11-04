// Server-side calls from Next.js to the API (ADR-002). The web app holds no database
// credentials and makes no authorization decisions: it forwards the browser's cookies and
// trusts only what the API answers.
import 'server-only';
import type { MediaRender } from '../components/article-body';

export interface Founder {
  readonly id: string;
  readonly email: string;
  readonly role: 'founder';
  readonly mfaEnabled: boolean;
}

function apiBaseUrl(): string {
  const value = process.env['API_BASE_URL'];
  if (value === undefined || !/^https?:\/\/[^/\s]+$/.test(value)) {
    throw new Error('API_BASE_URL must be set to the internal API origin, e.g. http://api:4000');
  }
  return value;
}

/** The current founder, or null when the API says the request is not authenticated. */
export async function currentFounder(cookieHeader: string | null): Promise<Founder | null> {
  if (cookieHeader === null || cookieHeader === '') return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/auth/me`, {
    headers: { cookie: cookieHeader, accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`API answered ${String(response.status)} for /auth/me`);
  const body = (await response.json()) as { user: Founder };
  return body.user;
}

// --- Newsroom (P1-02). Types mirror the API responses; the API stays the only authority. ---

export type ArticleStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'archived';
export type ArticleType = 'explainer' | 'analysis' | 'opinion';

export interface Category {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface ArticleSummary {
  readonly id: string;
  readonly slug: string;
  readonly status: ArticleStatus;
  readonly currentVersion: number;
  readonly title: string;
  readonly categoryId: string;
  readonly updatedAt: string;
}

export interface ArticleDetail {
  readonly article: {
    readonly id: string;
    readonly slug: string;
    readonly status: ArticleStatus;
    readonly currentVersion: number;
    readonly sourceException: string | null;
    readonly publishedAt: string | null;
    readonly current: {
      readonly title: string;
      readonly dek: string;
      readonly articleType: ArticleType;
      readonly categoryId: string;
      readonly bodySource: string;
      readonly methodNote: string | null;
      readonly citations: readonly Citation[];
    };
  };
  readonly verification: VerificationLevel;
  readonly gate: readonly string[];
  /** Images the current body uses (P1-09); `licensed` false means the gate will block. */
  readonly media: Readonly<Record<string, MediaRender & { readonly licensed: boolean }>>;
  readonly events: readonly {
    readonly action: string;
    readonly fromStatus: string;
    readonly toStatus: string;
    readonly verification: VerificationLevel;
    readonly note: string | null;
    readonly createdAt: string;
  }[];
  readonly corrections: readonly {
    readonly description: string;
    readonly substantial: boolean;
    readonly visibleAt: string | null;
    readonly createdAt: string;
  }[];
  readonly revisions: readonly {
    readonly id: string;
    readonly version: number;
    readonly title: string;
    readonly changeNote: string;
    readonly createdAt: string;
  }[];
}

export type VerificationLevel = 'TERVERIFIKASI' | 'SEBAGIAN' | 'BELUM_TERVERIFIKASI';

export interface Citation {
  readonly id: string;
  readonly url: string;
  readonly publisher: string;
  readonly title: string;
  readonly accessedAt: string;
  readonly claimNote: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

export class ApiUnauthorized extends Error {}

/** GET an OS API path on behalf of the browser; 404 → null, 401 → ApiUnauthorized. */
async function osGet<T>(path: string, cookieHeader: string | null): Promise<T | null> {
  const response = await fetch(`${apiBaseUrl()}/api/v1/os${path}`, {
    headers: { cookie: cookieHeader ?? '', accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 401) throw new ApiUnauthorized();
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`API answered ${String(response.status)} for ${path}`);
  return (await response.json()) as T;
}

export async function listCategories(cookieHeader: string | null): Promise<Category[]> {
  const body = await osGet<{ categories: Category[] }>('/categories', cookieHeader);
  return body?.categories ?? [];
}

export async function listArticles(cookieHeader: string | null): Promise<ArticleSummary[]> {
  const body = await osGet<{ articles: ArticleSummary[] }>('/articles?limit=100', cookieHeader);
  return body?.articles ?? [];
}

export function getArticle(id: string, cookieHeader: string | null): Promise<ArticleDetail | null> {
  // The id comes from the URL: encode it so it can only ever be one path segment.
  return osGet<ArticleDetail>(`/articles/${encodeURIComponent(id)}`, cookieHeader);
}

// --- Source Registry (P1-05) ---

export interface Source {
  readonly id: string;
  readonly name: string;
  readonly organization: string;
  readonly type: string;
  readonly officialUrl: string;
  readonly licenseStatus: string;
  readonly licenseNote: string | null;
  readonly attribution: string | null;
  readonly status: string;
  readonly notes: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export async function listSources(cookieHeader: string | null, status?: string): Promise<Source[]> {
  const query = status === undefined ? '' : `?status=${encodeURIComponent(status)}`;
  const body = await osGet<{ sources: Source[] }>(`/sources${query}`, cookieHeader);
  return body?.sources ?? [];
}

export async function getSource(id: string, cookieHeader: string | null): Promise<Source | null> {
  // The id comes from the URL: encode it so it can only ever be one path segment.
  const body = await osGet<{ source: Source }>(`/sources/${encodeURIComponent(id)}`, cookieHeader);
  return body?.source ?? null;
}

// --- Media library (P1-09) ---

export interface Media {
  readonly id: string;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
  readonly altText: string;
  readonly caption: string | null;
  readonly usageBasis: string;
  readonly license: string | null;
  readonly attribution: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export async function listMedia(cookieHeader: string | null): Promise<Media[]> {
  const body = await osGet<{ media: Media[] }>('/media', cookieHeader);
  return body?.media ?? [];
}

export async function getMedia(id: string, cookieHeader: string | null): Promise<Media | null> {
  // The id comes from the URL: encode it so it can only ever be one path segment.
  const body = await osGet<{ media: Media }>(`/media/${encodeURIComponent(id)}`, cookieHeader);
  return body?.media ?? null;
}
