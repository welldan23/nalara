// NALARA Data catalogue (P4-02): datasets, their source, licence and published version.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiUnauthorized, listDatasets } from '../../../../lib/api';
import { DATASET_STATUS_LABELS, FREQUENCY_LABELS } from '../../../../lib/data-messages';
import { LICENSE_LABELS } from '../../../../lib/source-messages';

export const metadata: Metadata = { title: 'Data' };
export const dynamic = 'force-dynamic';

export default async function DatasetsPage() {
  let datasets;
  try {
    datasets = await listDatasets((await headers()).get('cookie'));
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  return (
    <>
      <h1>Data</h1>
      <p className="muted">
        Dataset dari sumber resmi, lengkap dengan file aslinya, cara pengolahan, dan riwayat versi.
        Grafik di artikel selalu menunjuk satu versi tertentu.
      </p>
      <p>
        <Link href="/os/data/baru">Dataset baru</Link>
      </p>
      {datasets.length === 0 ? (
        <p className="muted">Belum ada dataset.</p>
      ) : (
        <ul className="inbox-list" data-testid="datasets">
          {datasets.map((dataset) => (
            <li key={dataset.id}>
              <p className="kicker">
                {dataset.source.organization} ·{' '}
                {DATASET_STATUS_LABELS[dataset.status] ?? dataset.status}
                {dataset.publishedVersion !== null ? ` v${String(dataset.publishedVersion)}` : ''}
              </p>
              <h2 className="inbox-title">
                <Link href={`/os/data/${dataset.id}`}>{dataset.title}</Link>
              </h2>
              <p className="muted">
                {dataset.unit} · {FREQUENCY_LABELS[dataset.frequency] ?? dataset.frequency} ·{' '}
                {LICENSE_LABELS[dataset.licenseStatus] ?? dataset.licenseStatus} ·{' '}
                {dataset.versions} versi
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
