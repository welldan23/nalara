// Founder OS shell (P1-02): navigation for every signed-in /os page. The session is checked
// here on the server for every request; the API still authorises each data call on its own.
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { currentFounder } from '../../../lib/api';
import { LogoutButton } from './logout-button';

export const dynamic = 'force-dynamic';

export default async function OsShellLayout({ children }: { readonly children: ReactNode }) {
  const founder = await currentFounder((await headers()).get('cookie'));
  if (founder === null) redirect('/os/login');

  return (
    <div className="os-shell">
      <nav className="os-nav" aria-label="NALARA OS">
        <Link href="/os" className="os-brand">
          {/* Pre-sized static PNG: next/image would need the native sharp binary (ADR-001). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/nalara-beringin-64.png" alt="" width={32} height={32} />
          <span>NALARA OS</span>
        </Link>
        <ul>
          <li>
            <Link href="/os">Ringkasan</Link>
          </li>
          <li>
            <Link href="/os/newsroom">Newsroom</Link>
          </li>
          <li>
            <Link href="/os/sources">Sumber</Link>
          </li>
          <li>
            <Link href="/os/media">Media</Link>
          </li>
        </ul>
        <div className="os-account">
          <span className="muted">{founder.email}</span>
          <LogoutButton />
        </div>
      </nav>
      <div className="os-content">{children}</div>
    </div>
  );
}
