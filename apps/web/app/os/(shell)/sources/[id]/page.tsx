// Edit a registry source (P1-05). Sources are never deleted: set the status to "Nonaktif".
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiUnauthorized, getSource } from '../../../../../lib/api';
import {
  FEED_STATUS_LABELS,
  SOURCE_STATUS_LABELS,
  feedErrorText,
} from '../../../../../lib/source-messages';
import { SourceForm } from '../source-form';
import { CheckFeedButton } from './feed-panel';

export const metadata: Metadata = { title: 'Sumber' };
export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

export default async function SourcePage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    data = await getSource(id, (await headers()).get('cookie'));
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  if (data === null) notFound();
  const { source, checks } = data;
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
      {source.feedUrl !== null && (
        <section aria-labelledby="feed" className="feed-panel" data-testid="feed">
          <h2 id="feed">Feed</h2>
          <p>
            <span className={`status feed-status-${source.feedStatus}`}>
              {FEED_STATUS_LABELS[source.feedStatus] ?? source.feedStatus}
            </span>
            {source.feedTitle !== null && <> · {source.feedTitle}</>}
            {source.feedCheckedAt !== null && (
              <span className="muted">
                {' '}
                · dicek {dateFormat.format(new Date(source.feedCheckedAt))} WIB
              </span>
            )}
          </p>
          {source.feedError !== null && <p className="error">{feedErrorText(source.feedError)}</p>}
          {source.feedQuarantinedAt !== null && (
            <p className="notice-warn" role="status">
              Feed ini dikarantina sejak {dateFormat.format(new Date(source.feedQuarantinedAt))} WIB
              setelah {source.consecutiveFailures} kali gagal, jadi tidak diambil lagi. Periksa URL
              feed di atas, lalu lepas karantina. Feed dicek ulang dulu sebelum diambil lagi.
            </p>
          )}
          <CheckFeedButton sourceId={source.id} quarantined={source.feedQuarantinedAt !== null} />
          {checks.length > 0 && (
            <ol className="revision-list" aria-label="Riwayat cek feed">
              {checks.map((check, index) => (
                <li key={`${check.checkedAt}-${String(index)}`}>
                  <strong>{check.ok ? 'Berhasil' : 'Gagal'}</strong>
                  {check.ok
                    ? ` · ${String(check.itemCount ?? 0)} item (${check.feedFormat ?? '?'})`
                    : ` · ${feedErrorText(check.error)}`}{' '}
                  <span className="muted">
                    · {dateFormat.format(new Date(check.checkedAt))} WIB
                    {check.durationMs !== null ? ` · ${String(check.durationMs)} ms` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}
