// Everything under /os is private: never indexed, whatever the launch state (P1-08). next.config
// also sends `X-Robots-Tag: noindex` for these paths, and robots.txt disallows them.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function OsLayout({ children }: { readonly children: ReactNode }) {
  return children;
}
