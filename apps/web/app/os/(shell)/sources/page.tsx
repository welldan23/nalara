// Source Registry list (P1-05): official sources with status and licence, filterable by status.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiUnauthorized, listSources } from '../../../../lib/api';
import {
  FEED_STATUS_LABELS,
  LICENSE_LABELS,
  SOURCE_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
} from '../../../../lib/source-messages';

export const metadata: Metadata = { title: 'Sumber' };
export const dynamic = 'force-dynamic';

export default async function SourcesPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { status } = await searchParams;
  const filter = typeof status === 'string' && status in SOURCE_STATUS_LABELS ? status : undefined;
  let sources;
  try {
    sources = await listSources((await headers()).get('cookie'), filter);
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }

  return (
    <>
      <div className="page-head">
        <h1>Sumber</h1>
        <Link className="button" href="/os/sources/baru">
          Tambah sumber
        </Link>
      </div>
      <p className="muted">
        Daftar sumber resmi yang dipakai redaksi, lengkap dengan status dan lisensinya. Belum ada
        pengambilan otomatis.
      </p>
      <nav className="filter-nav" aria-label="Saring status">
        <Link href="/os/sources" aria-current={filter === undefined ? 'page' : undefined}>
          Semua
        </Link>
        {Object.entries(SOURCE_STATUS_LABELS).map(([value, label]) => (
          <Link
            key={value}
            href={`/os/sources?status=${value}`}
            aria-current={filter === value ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {sources.length === 0 ? (
        <p className="muted">Belum ada sumber{filter === undefined ? '' : ' dengan status ini'}.</p>
      ) : (
        <ul className="article-list" data-testid="sources">
          {sources.map((source) => (
            <li key={source.id}>
              <Link href={`/os/sources/${source.id}`}>{source.name}</Link>
              <p className="muted">
                <span className={`status source-status-${source.status}`}>
                  {SOURCE_STATUS_LABELS[source.status] ?? source.status}
                </span>{' '}
                · {source.organization} · {SOURCE_TYPE_LABELS[source.type] ?? source.type} ·
                lisensi: {LICENSE_LABELS[source.licenseStatus] ?? source.licenseStatus}
                {source.feedStatus !== 'none' &&
                  ` · feed: ${FEED_STATUS_LABELS[source.feedStatus] ?? source.feedStatus}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
