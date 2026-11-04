// One dataset (P4-02): description, versions with their hashes, a new version, and publishing.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiUnauthorized, getDataset } from '../../../../../lib/api';
import { DATASET_STATUS_LABELS } from '../../../../../lib/data-messages';
import { DatasetForm } from '../dataset-form';
import { PublishPanel, VerifyButton } from './publish-panel';
import { VersionForm } from './version-form';

export const metadata: Metadata = { title: 'Dataset' };
export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

export default async function DatasetPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let found;
  try {
    found = await getDataset((await headers()).get('cookie'), id);
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  if (found === null) notFound();
  const { dataset, versions } = found;
  return (
    <>
      <p>
        <Link href="/os/data">← Semua dataset</Link>
      </p>
      <h1>{dataset.title}</h1>
      <p className="muted" data-testid="dataset-state">
        {DATASET_STATUS_LABELS[dataset.status] ?? dataset.status}
        {dataset.publishedVersion !== null
          ? ` · versi terbit v${String(dataset.publishedVersion)}`
          : ''}{' '}
        · sumber {dataset.source.organization} (
        {dataset.source.status === 'verified' ? 'Terverifikasi' : 'belum terverifikasi'}) · slug{' '}
        <code>{dataset.slug}</code>
      </p>

      <section aria-labelledby="publish">
        <h2 id="publish">Terbit</h2>
        {/* Keyed so a new version or a new dataset version number resets the choice. */}
        <PublishPanel
          key={`${String(versions.length)}-${String(dataset.version)}`}
          dataset={dataset}
          versions={versions}
        />
      </section>

      <section aria-labelledby="versions">
        <h2 id="versions">Versi</h2>
        {versions.length === 0 ? (
          <p className="muted">Belum ada versi.</p>
        ) : (
          <ul className="inbox-list" data-testid="versions">
            {versions.map((version) => (
              <li key={version.version}>
                <p className="kicker">
                  v{version.version} · diambil {version.retrievedOn} · disimpan{' '}
                  {dateFormat.format(new Date(version.createdAt))} WIB
                </p>
                <p>{version.revisionNote}</p>
                <p className="muted">
                  {version.observationCount} titik data · {version.periodStart} sampai{' '}
                  {version.periodEnd}
                  {version.series.length > 0 ? ` · seri: ${version.series.join(', ')}` : ''}
                </p>
                <p className="muted hash">
                  File {version.rawFilename} ({version.rawSize} byte) · SHA-256 file{' '}
                  {version.rawSha256.slice(0, 16)}… · SHA-256 hasil{' '}
                  {version.observationsSha256.slice(0, 16)}…
                </p>
                <p>
                  <a
                    href={`/api/v1/os/datasets/${dataset.id}/versions/${String(version.version)}/raw`}
                  >
                    Unduh file asli
                  </a>{' '}
                  · <VerifyButton datasetId={dataset.id} version={version.version} />
                </p>
              </li>
            ))}
          </ul>
        )}
        {dataset.status !== 'retracted' && (
          <>
            <h3>Versi baru</h3>
            <VersionForm datasetId={dataset.id} />
          </>
        )}
      </section>

      <section aria-labelledby="about">
        <h2 id="about">Keterangan dataset</h2>
        <DatasetForm key={dataset.version} dataset={dataset} />
      </section>
    </>
  );
}
