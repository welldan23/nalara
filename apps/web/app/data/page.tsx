// NALARA Data (P4-04): the published datasets, each with its source and current version.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Rana } from '../../components/brand';
import { formatDate } from '../../components/public';
import { FREQUENCY_LABELS } from '../../lib/data-messages';
import { publicDatasets } from '../../lib/public-api';
import { pageAlternates, pageOpenGraph } from '../../lib/site';

export const dynamic = 'force-dynamic';

const DESCRIPTION =
  'Dataset resmi yang dipakai NALARA: sumber, lisensi, cara pengolahan, dan riwayat versinya.';

export const metadata: Metadata = {
  title: 'Data',
  description: DESCRIPTION,
  alternates: pageAlternates('/data'),
  openGraph: pageOpenGraph({ title: 'Data', path: '/data', description: DESCRIPTION }),
};

export default async function DataPage() {
  const datasets = await publicDatasets();
  if (datasets === null) notFound();
  return (
    <section className="reading">
      <h1>Data</h1>
      <p className="dek">{DESCRIPTION}</p>
      {datasets.length === 0 ? (
        <div className="empty-state">
          <Rana pose="memeriksa" className="empty-state-art" />
          <p className="muted">Belum ada dataset yang terbit. Rana masih memeriksa angkanya.</p>
        </div>
      ) : (
        <ul className="inbox-list" data-testid="public-datasets">
          {datasets.map((dataset) => (
            <li key={dataset.slug}>
              <p className="kicker">{dataset.organization}</p>
              <h2 className="inbox-title">
                <Link href={`/data/${dataset.slug}`}>{dataset.title}</Link>
              </h2>
              {dataset.description !== '' && <p>{dataset.description}</p>}
              <p className="muted">
                {FREQUENCY_LABELS[dataset.frequency] ?? dataset.frequency}, dalam {dataset.unit}.
                Versi {dataset.publishedVersion}, terbit {formatDate(dataset.publishedAt)}.
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
