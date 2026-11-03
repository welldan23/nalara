import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { publicCategories } from '../lib/public-api';
import type { PublicCategory } from '../lib/public-api';
import { tokenCss } from '../lib/tokens';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'NALARA', template: '%s · NALARA' },
  description: 'Biar semua paham.',
  // Indexing stays off until launch (KP1-15); P1-08 ties this to the launch flag.
  robots: { index: false, follow: false },
};

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
