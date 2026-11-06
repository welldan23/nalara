// One published dataset (P4-04): the chart of the published version, where the data comes from,
// the licence, how it was processed (in words and as hashes anyone can re-check), and every
// version with its revision note. Unknown, draft and retracted datasets are a 404.
import type { Metadata } from 'next';
import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChartFigure } from '../../../components/chart';
import { formatDate } from '../../../components/public';
import { FREQUENCY_LABELS, describeSpec } from '../../../lib/data-messages';
import { publicDataset } from '../../../lib/public-api';
import { pageAlternates, pageOpenGraph } from '../../../lib/site';
import { LICENSE_LABELS } from '../../../lib/source-messages';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const load = cache(async (slug: string) => (SLUG.test(slug) ? publicDataset(slug) : null));

const isSafeHref = (href: string) => {
  try {
    return new URL(href).protocol === 'https:';
  } catch {
    return false;
  }
};

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const found = await load((await params).slug);
  if (found === null) return {};
  const path = `/data/${found.dataset.slug}`;
  const description =
    found.dataset.description === ''
      ? `${found.dataset.title}, satuan ${found.dataset.unit}, dari ${found.dataset.organization}.`
      : found.dataset.description;
  return {
    title: found.dataset.title,
    description,
    alternates: pageAlternates(path),
    openGraph: pageOpenGraph({ title: found.dataset.title, path, description }),
  };
}

export default async function DatasetPage({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const found = await load((await params).slug);
  if (found === null) notFound();
  const { dataset, versions, observations } = found;
  const current = versions.find((version) => version.version === dataset.publishedVersion);
  if (current === undefined) notFound();
  const sourceLink = isSafeHref(dataset.sourcePageUrl) ? dataset.sourcePageUrl : null;

  return (
    <article className="reading">
      <p className="kicker">
        <Link href="/data">Data</Link> · {dataset.organization}
      </p>
      <h1>{dataset.title}</h1>
      {dataset.description !== '' && <p className="dek">{dataset.description}</p>}

      <ChartFigure
        block={{
          type: 'chart',
          dataset: dataset.slug,
          version: current.version,
          kind: 'line',
          title: `${dataset.title} (${dataset.unit})`,
        }}
        chart={{
          datasetTitle: dataset.title,
          unit: dataset.unit,
          frequency: dataset.frequency,
          observations,
          series: current.series,
          periodStart: current.periodStart,
          periodEnd: current.periodEnd,
          organization: dataset.organization,
          sourceName: dataset.sourceName,
          sourcePageUrl: dataset.sourcePageUrl,
          retrievedOn: current.retrievedOn,
          revisionNote: current.revisionNote,
          licenseStatus: dataset.licenseStatus,
          attribution: dataset.attribution,
          observationsSha256: current.observationsSha256,
        }}
        id="grafik-dataset"
        preview={false}
      />

      <section aria-labelledby="tentang-data">
        <h2 id="tentang-data">Tentang data ini</h2>
        <dl className="proposal-payload">
          <div>
            <dt>Penerbit</dt>
            <dd>
              {dataset.organization} ({dataset.sourceName})
            </dd>
          </div>
          <div>
            <dt>Halaman sumber</dt>
            <dd>
              {sourceLink === null ? (
                dataset.sourcePageUrl
              ) : (
                <a href={sourceLink} rel="noopener noreferrer nofollow">
                  {sourceLink}
                </a>
              )}
            </dd>
          </div>
          <div>
            <dt>Satuan</dt>
            <dd>{dataset.unit}</dd>
          </div>
          <div>
            <dt>Frekuensi</dt>
            <dd>{FREQUENCY_LABELS[dataset.frequency] ?? dataset.frequency}</dd>
          </div>
          <div>
            <dt>Periode</dt>
            <dd>
              {current.periodStart} sampai {current.periodEnd}
            </dd>
          </div>
          <div>
            <dt>Lisensi</dt>
            <dd>
              {LICENSE_LABELS[dataset.licenseStatus] ?? dataset.licenseStatus}
              {dataset.attribution !== null && ` · ${dataset.attribution}`}
            </dd>
          </div>
        </dl>
        {dataset.methodology !== '' && (
          <>
            <h3>Metodologi</h3>
            <p className="proposal-reason">{dataset.methodology}</p>
          </>
        )}
      </section>

      <section aria-labelledby="pengolahan">
        <h2 id="pengolahan">Cara data diolah (versi {current.version})</h2>
        <p>
          File asli diambil dari{' '}
          {isSafeHref(current.fileUrl) ? (
            <a href={current.fileUrl} rel="noopener noreferrer nofollow">
              situs penerbit
            </a>
          ) : (
            'situs penerbit'
          )}{' '}
          pada {formatDate(`${current.retrievedOn}T00:00:00Z`)}, lalu:
        </p>
        <ol>
          {describeSpec(current.spec).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <p className="muted hash">
          SHA-256 file asli: {current.rawSha256}
          <br />
          SHA-256 hasil olahan: {current.observationsSha256}
        </p>
        <p className="muted">
          Langkah yang sama pada file yang sama selalu menghasilkan hash yang sama. Itu cara
          mengecek bahwa angka di grafik benar-benar berasal dari file penerbit.
        </p>
        {dataset.downloadable ? (
          <p>
            <a href={`/api/v1/public/datasets/${dataset.slug}/data.csv`} download>
              Unduh data hasil olahan (CSV)
            </a>
          </p>
        ) : (
          <p className="muted">
            Lisensi data ini tidak mengizinkan NALARA membagikan ulang filenya. Ambil langsung dari
            penerbit.
          </p>
        )}
      </section>

      <section aria-labelledby="riwayat">
        <h2 id="riwayat">Riwayat versi</h2>
        <ol className="inbox-list" reversed data-testid="dataset-versions">
          {versions.map((version) => (
            <li key={version.version}>
              <p className="kicker">
                Versi {version.version}
                {version.version === dataset.publishedVersion ? ' · yang tampil sekarang' : ''} ·
                diambil {formatDate(`${version.retrievedOn}T00:00:00Z`)}
              </p>
              <p>{version.revisionNote}</p>
              <p className="muted">
                {version.observationCount} angka · {version.periodStart} sampai {version.periodEnd}
              </p>
              {dataset.downloadable && version.version !== dataset.publishedVersion && (
                <p>
                  <a
                    href={`/api/v1/public/datasets/${dataset.slug}/data.csv?versi=${String(version.version)}`}
                    download
                  >
                    Unduh versi {version.version} (CSV)
                  </a>
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
