// Server-side calls from Next.js to the API (ADR-002). The web app holds no database
// credentials and makes no authorization decisions: it forwards the browser's cookies and
// trusts only what the API answers.
import 'server-only';
import type { MediaRender } from '../components/article-body';
import { forwardedFor } from './forwarded';

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
    headers: { cookie: cookieHeader, accept: 'application/json', ...(await forwardedFor()) },
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
  /** Latest evidence snapshot per cited URL (P2-07). */
  readonly evidence: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly status: string;
        readonly capturedAt: string | null;
        readonly byteSize: number | null;
        readonly sha256: string | null;
        readonly error: string | null;
      }
    >
  >;
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
    headers: { cookie: cookieHeader ?? '', accept: 'application/json', ...(await forwardedFor()) },
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
  readonly feedUrl: string | null;
  readonly feedStatus: string;
  readonly feedTitle: string | null;
  readonly feedCheckedAt: string | null;
  readonly feedError: string | null;
  readonly consecutiveFailures: number;
  readonly feedQuarantinedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SourceCheck {
  readonly ok: boolean;
  readonly httpStatus: number | null;
  readonly feedFormat: string | null;
  readonly itemCount: number | null;
  readonly error: string | null;
  readonly durationMs: number | null;
  readonly checkedAt: string;
}

export async function listSources(cookieHeader: string | null, status?: string): Promise<Source[]> {
  const query = status === undefined ? '' : `?status=${encodeURIComponent(status)}`;
  const body = await osGet<{ sources: Source[] }>(`/sources${query}`, cookieHeader);
  return body?.sources ?? [];
}

export async function getSource(
  id: string,
  cookieHeader: string | null,
): Promise<{ source: Source; checks: SourceCheck[] } | null> {
  // The id comes from the URL: encode it so it can only ever be one path segment.
  return osGet<{ source: Source; checks: SourceCheck[] }>(
    `/sources/${encodeURIComponent(id)}`,
    cookieHeader,
  );
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

// --- Inbox (P2-06) ---

export interface InboxItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly summary: string;
  readonly publishedAt: string | null;
  readonly firstSeenAt: string;
  readonly status: string;
  readonly source: { readonly id: string; readonly name: string; readonly organization: string };
  readonly alsoIn: number;
}

export async function listInbox(
  cookieHeader: string | null,
  query: { readonly status?: string; readonly cursor?: string },
): Promise<{ items: InboxItem[]; nextCursor: string | null; newCount: number }> {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set('status', query.status);
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return (
    (await osGet<{ items: InboxItem[]; nextCursor: string | null; newCount: number }>(
      `/inbox${suffix}`,
      cookieHeader,
    )) ?? { items: [], nextCursor: null, newCount: 0 }
  );
}

// --- Agent proposals (P3-01) ---

export interface Proposal {
  readonly id: string;
  readonly kind: string;
  readonly agentRole: string;
  /** Written by an AI agent: shown as plain text only, never as markup or links. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly reason: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly targetVersion: number | null;
  readonly status: string;
  readonly failure: string | null;
  readonly resultId: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt: string | null;
}

export interface ProposalDetail extends Proposal {
  readonly target: { readonly label: string; readonly currentVersion: number | null } | null;
  readonly decision: {
    readonly decision: string;
    readonly channel: string;
    readonly decidedAt: string;
  } | null;
}

export async function listProposals(
  cookieHeader: string | null,
  query: { readonly status?: string; readonly cursor?: string },
): Promise<{ items: Proposal[]; nextCursor: string | null; pendingCount: number }> {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set('status', query.status);
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return (
    (await osGet<{ items: Proposal[]; nextCursor: string | null; pendingCount: number }>(
      `/proposals${suffix}`,
      cookieHeader,
    )) ?? { items: [], nextCursor: null, pendingCount: 0 }
  );
}

export async function getProposal(
  cookieHeader: string | null,
  id: string,
): Promise<ProposalDetail | null> {
  const body = await osGet<{ proposal: ProposalDetail }>(
    `/proposals/${encodeURIComponent(id)}`,
    cookieHeader,
  );
  return body?.proposal ?? null;
}

// --- AI settings (P3-02) ---

export interface AiOverview {
  readonly settings: {
    readonly aiEnabled: boolean;
    readonly dailyDraftQuota: number;
    readonly dailyProposalQuota: number;
    readonly dailyTokenQuota: number;
    readonly version: number;
    readonly updatedAt: string;
  };
  readonly usage: { readonly drafts: number; readonly proposals: number; readonly tokens: number };
  readonly preferences: {
    readonly topics: readonly string[];
    readonly notes: string;
    readonly version: number;
  };
  readonly credentials: readonly {
    readonly label: string;
    readonly createdAt: string;
    readonly lastUsedAt: string | null;
    readonly revokedAt: string | null;
  }[];
}

export async function getAiOverview(cookieHeader: string | null): Promise<AiOverview | null> {
  return osGet<AiOverview>('/ai', cookieHeader);
}

// --- NALARA Data (P4-02) ---

export interface Dataset {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly sourceId: string;
  readonly sourcePageUrl: string;
  readonly unit: string;
  readonly frequency: string;
  readonly methodology: string;
  readonly licenseStatus: string;
  readonly licenseNote: string | null;
  readonly attribution: string | null;
  readonly status: string;
  readonly publishedVersion: number | null;
  readonly publishedAt: string | null;
  readonly version: number;
  readonly updatedAt: string;
  readonly source: {
    readonly name: string;
    readonly organization: string;
    readonly status: string;
  };
  readonly versions: number;
}

export interface DatasetVersion {
  readonly version: number;
  readonly rawFilename: string;
  readonly rawSize: number;
  readonly rawSha256: string;
  readonly fileUrl: string;
  readonly retrievedOn: string;
  readonly spec: Readonly<Record<string, unknown>>;
  readonly observationsSha256: string;
  readonly observationCount: number;
  readonly series: readonly string[];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly revisionNote: string;
  readonly createdAt: string;
}

export async function listDatasets(cookieHeader: string | null): Promise<Dataset[]> {
  return (await osGet<{ datasets: Dataset[] }>('/datasets', cookieHeader))?.datasets ?? [];
}

export async function getDataset(
  cookieHeader: string | null,
  id: string,
): Promise<{ dataset: Dataset; versions: DatasetVersion[] } | null> {
  return osGet(`/datasets/${encodeURIComponent(id)}`, cookieHeader);
}

/** Instagram cards of a published article (Kartu NALARA). */
export interface CardDeck {
  readonly slug: string;
  readonly title: string;
  readonly slides: readonly { readonly number: number; readonly kind: string }[];
  readonly caption: string;
}

export async function getCardDeck(
  cookieHeader: string | null,
  slug: string,
): Promise<CardDeck | null> {
  return osGet(`/cards/${encodeURIComponent(slug)}`, cookieHeader);
}

/** Radar (P5-01): the inbox as stories, clustered and scored. */
export interface RadarStory {
  readonly id: string;
  readonly title: string;
  readonly score: number;
  readonly breaking: boolean;
  readonly independentSources: number;
  readonly latestAt: string;
  readonly keywords: readonly string[];
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly url: string;
    readonly source: { readonly name: string; readonly organization: string };
  }[];
}

export async function getRadar(
  cookieHeader: string | null,
): Promise<{ quietHours: boolean; stories: readonly RadarStory[] }> {
  const body = await osGet<{ radar: { quietHours: boolean; stories: RadarStory[] } }>(
    '/radar',
    cookieHeader,
  );
  return body?.radar ?? { quietHours: false, stories: [] };
}

/** Proposal queue (P5-02). */
export interface QueuedStory {
  readonly id: string;
  readonly title: string;
  readonly score: number;
  readonly breaking: boolean;
  readonly status: string;
  readonly articleId: string | null;
  readonly note: string | null;
  readonly queuedAt: string;
}

export async function listStoryQueue(cookieHeader: string | null): Promise<QueuedStory[]> {
  const body = await osGet<{ stories: QueuedStory[] }>('/stories', cookieHeader);
  return body?.stories ?? [];
}
