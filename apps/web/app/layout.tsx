import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { publicCategories } from '../lib/public-api';
import type { PublicCategory } from '../lib/public-api';
import { SITE_DESCRIPTION, SITE_IMAGE, SITE_NAME, SITE_TAGLINE, siteOrigin } from '../lib/site';
import { siteLaunched } from '../lib/launch';
import { tokenCss } from '../lib/tokens';
import { BrandMark } from '../components/brand';
// Self-hosted variable fonts (OFL-1.1): served from this origin, so the CSP stays font-src 'self'.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/literata/opsz.css';
import '@fontsource-variable/literata/opsz-italic.css';
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
          <div className="masthead-inner">
            <Link href="/" className="masthead-name" aria-label="NALARA, ke beranda">
              <BrandMark size={34} />
              <span>NALARA</span>
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
                    <Link href="/data">Data</Link>
                  </li>
                  <li>
                    <Link href="/tentang">Tentang</Link>
                  </li>
                </ul>
              </nav>
            )}
          </div>
        </header>
        {/* Focusable target for the skip link, so keyboard users land in the content. */}
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <div className="site-footer-inner">
            <p className="site-footer-name">
              <BrandMark size={28} />
              <span>NALARA</span>
            </p>
            <p className="site-footer-text">
              Media penjelas Indonesia. Setiap tulisan ditinjau redaksi dan berakar pada sumber yang
              bisa kamu buka sendiri.
            </p>
            <ul className="site-footer-links">
              <li>
                <Link href="/tentang#verifikasi">Cara kami memverifikasi</Link>
              </li>
              {/* Topics exist only after launch; before it, the corrections page is a 404 too. */}
              {categories.length > 0 && (
                <li>
                  <Link href="/koreksi">Koreksi</Link>
                </li>
              )}
            </ul>
          </div>
        </footer>
      </body>
    </html>
  );
}
