// Public origin and site-wide metadata for search engines and link previews (P1-08). Pure: no
// server-only imports, so it is unit-tested directly. The launch state is in ./launch.ts.
const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

/** The public origin from APP_BASE_URL, or null when it is not set (e.g. during `next build`). */
export function siteOrigin(): URL | null {
  const value = process.env['APP_BASE_URL'];
  return value !== undefined && ORIGIN.test(value) ? new URL(value) : null;
}

/** Absolute URL of a site path. Callers check `siteOrigin()` first. */
export function absoluteUrl(origin: URL, path: string): string {
  return new URL(path, origin).toString();
}

export const SITE_NAME = 'NALARA';
export const SITE_TAGLINE = 'Biar semua paham.';
export const SITE_DESCRIPTION =
  'NALARA, media penjelas Indonesia: ekonomi, teknologi, dan kebijakan dijelaskan dengan jelas, berkonteks, dan bersumber.';
/** Social preview image (the beringin logo, 512 × 512). */
export const SITE_IMAGE = { url: '/brand/nalara-beringin-512.png', width: 512, height: 512 };

/**
 * Open Graph for one page. Next.js replaces (does not merge) a parent's `openGraph`, so every
 * page that sets one repeats the site-wide fields here.
 */
export function pageOpenGraph(
  page: { readonly title: string; readonly description?: string; readonly path: string },
  extra: Record<string, unknown> = {},
) {
  return {
    siteName: SITE_NAME,
    locale: 'id_ID',
    type: 'website',
    title: page.title,
    ...(page.description ? { description: page.description } : {}),
    url: page.path,
    images: [{ ...SITE_IMAGE, alt: 'Logo NALARA, pohon beringin' }],
    ...extra,
  };
}

/**
 * Canonical URL plus the RSS feed link for one page. Like `openGraph`, a page's `alternates`
 * replaces the parent's, so the feed link is repeated here.
 */
export function pageAlternates(path: string) {
  return {
    canonical: path,
    types: { 'application/rss+xml': [{ url: '/rss.xml', title: SITE_NAME }] },
  };
}
