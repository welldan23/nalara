// New dataset (P4-02): it starts from a source in the registry.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiUnauthorized, listSources } from '../../../../../lib/api';
import { DatasetForm } from '../dataset-form';

export const metadata: Metadata = { title: 'Dataset baru' };
export const dynamic = 'force-dynamic';

export default async function NewDatasetPage() {
  let sources;
  try {
    sources = await listSources((await headers()).get('cookie'));
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  const usable = sources.filter((source) => source.status !== 'disabled');
  return (
    <>
      <p>
        <Link href="/os/data">← Semua dataset</Link>
      </p>
      <h1>Dataset baru</h1>
      {usable.length === 0 ? (
        <p className="muted">
          Tambahkan dulu sumbernya di <Link href="/os/sources">Source Registry</Link>.
        </p>
      ) : (
        <DatasetForm sources={usable} />
      )}
    </>
  );
}
