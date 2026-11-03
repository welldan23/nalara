// Founder OS placeholder (P0-011). The API decides who is authenticated; this page only asks.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentFounder } from '../../lib/api';
import { LogoutButton } from './logout-button';

export const metadata: Metadata = { title: 'OS' };
export const dynamic = 'force-dynamic';

export default async function OsPage() {
  const founder = await currentFounder((await headers()).get('cookie'));
  if (founder === null) redirect('/os/login');

  return (
    <>
      <h1>NALARA OS</h1>
      <p>
        Masuk sebagai <strong>{founder.email}</strong>.
      </p>
      <p className="muted">Fondasi Phase 0: belum ada fitur editorial.</p>
      <LogoutButton />
    </>
  );
}
