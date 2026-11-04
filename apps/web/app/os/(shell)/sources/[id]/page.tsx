// Edit a registry source (P1-05). Sources are never deleted: set the status to "Nonaktif".
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiUnauthorized, getSource } from '../../../../../lib/api';
import { SOURCE_STATUS_LABELS } from '../../../../../lib/source-messages';
import { SourceForm } from '../source-form';

export const metadata: Metadata = { title: 'Sumber' };
export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

export default async function SourcePage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  let source;
  try {
    source = await getSource(id, (await headers()).get('cookie'));
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  if (source === null) notFound();
  return (
    <>
      <p>
        <Link href="/os/sources">← Semua sumber</Link>
      </p>
      <h1>{source.name}</h1>
      <p className="muted">
        {SOURCE_STATUS_LABELS[source.status] ?? source.status} · versi {source.version} · diubah{' '}
        {dateFormat.format(new Date(source.updatedAt))} WIB
      </p>
      <SourceForm key={source.id} source={source} />
    </>
  );
}
