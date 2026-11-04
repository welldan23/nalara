import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { publicCategories } from '../lib/public-api';
import type { PublicCategory } from '../lib/public-api';
import { SITE_DESCRIPTION, SITE_IMAGE, SITE_NAME, SITE_TAGLINE, siteOrigin } from '../lib/site';
import { siteLaunched } from '../lib/launch';
import { tokenCss } from '../lib/tokens';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  // Evaluated per request: the launch state lives in the API, never in the build.
  await connection();
  const origin = siteOrigin();
  const launched = origin !== null && (await siteLaunched());
  return {
    ...(origin === null ? {} : { metadataBase: origin }),
    title: { default: `${SITE_NAME} · ${SITE_TAGLINE}`, template: `%s · ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    // Indexing only after launch (ADR-015, KP1-15); /os additionally sends X-Robots-Tag.
    robots: launched ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      siteName: SITE_NAME,
      locale: 'id_ID',
      type: 'website',
      images: [{ ...SITE_IMAGE, alt: 'Logo NALARA, pohon beringin' }],
    },
    twitter: { card: 'summary' },
    icons: { icon: '/brand/nalara-beringin-64.png', apple: '/brand/nalara-beringin-192.png' },
    ...(launched
      ? {
          alternates: { types: { 'application/rss+xml': [{ url: '/rss.xml', title: SITE_NAME }] } },
        }
      : {}),
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

async function topics(): Promise<PublicCategory[]> {
  try {
    return (await publicCategories()) ?? [];
  } catch {
    // The navigation must never take a page down: without the API it simply has no topics.
    return [];
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const categories = await topics();
  return (
    <html lang="id">
      <head>
        {/* Generated from typed tokens; contains no user input. */}
        <style>{tokenCss()}</style>
      </head>
      <body>
        <a className="skip-link" href="#main">
          Langsung ke isi
        </a>
        <header className="masthead">
          <Link href="/" className="masthead-name">
            NALARA
          </Link>
          {categories.length > 0 && (
            <nav aria-label="Topik" className="site-nav">
              <ul>
                {categories.map((category) => (
                  <li key={category.slug}>
                    <Link href={`/topik/${category.slug}`}>{category.name}</Link>
                  </li>
                ))}
                <li>
                  <Link href="/tentang">Tentang</Link>
                </li>
              </ul>
            </nav>
          )}
        </header>
        {/* Focusable target for the skip link, so keyboard users land in the content. */}
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
