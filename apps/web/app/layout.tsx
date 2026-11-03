import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { tokenCss } from '../lib/tokens';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'NALARA', template: '%s · NALARA' },
  description: 'Biar semua paham.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
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
          <p className="masthead-name">NALARA</p>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
