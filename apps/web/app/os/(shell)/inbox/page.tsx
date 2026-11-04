// Inbox (P2-06): what the feeds of verified sources found. Material to check, never content:
// nothing here is public, and a draft starts from a citation and an empty template.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiUnauthorized, listCategories, listInbox } from '../../../../lib/api';
import { ItemActions } from './item-actions';

export const metadata: Metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

const TABS = [
  ['new', 'Baru'],
  ['seen', 'Dilihat'],
  ['dismissed', 'Diabaikan'],
  ['used', 'Jadi draft'],
] as const;

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

const isWebLink = (url: string) => /^https?:\/\//i.test(url);

export default async function InboxPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string | string[]; setelah?: string | string[] }>;
}) {
  const query = await searchParams;
  const status = TABS.some(([value]) => value === query.status) ? (query.status as string) : 'new';
  const cursor =
    typeof query.setelah === 'string' && query.setelah.length <= 512 ? query.setelah : undefined;
  const cookie = (await headers()).get('cookie');
  let data;
  try {
    data = await Promise.all([
      listInbox(cookie, { status, ...(cursor === undefined ? {} : { cursor }) }),
      listCategories(cookie),
    ]);
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  const [inbox, categories] = data;

  return (
    <>
      <h1>Inbox</h1>
      <p className="muted">
        Item baru dari feed sumber Terverifikasi. Ini bahan untuk dicek, bukan untuk disalin: buka
        tautan aslinya, lalu tulis dengan kata-katamu sendiri.
      </p>
      <nav className="filter-nav" aria-label="Saring inbox">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            href={value === 'new' ? '/os/inbox' : `/os/inbox?status=${value}`}
            aria-current={status === value ? 'page' : undefined}
          >
            {label}
            {value === 'new' && inbox.newCount > 0 ? ` (${String(inbox.newCount)})` : ''}
          </Link>
        ))}
      </nav>
      {inbox.items.length === 0 ? (
        <p className="muted">
          {status === 'new'
            ? 'Belum ada item baru. Item muncul setelah feed sumber Terverifikasi diambil.'
            : 'Tidak ada item di sini.'}
        </p>
      ) : (
        <ul className="inbox-list" data-testid="inbox">
          {inbox.items.map((item) => (
            <li key={item.id}>
              <p className="kicker">
                {item.source.organization} · {item.source.name}
              </p>
              <h2 className="inbox-title">
                {isWebLink(item.url) ? (
                  <a href={item.url} rel="noopener noreferrer nofollow" target="_blank">
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </h2>
              {item.summary !== '' && <p className="inbox-summary">{item.summary}</p>}
              <p className="muted">
                {item.publishedAt !== null
                  ? `Terbit ${dateFormat.format(new Date(item.publishedAt))} WIB · `
                  : ''}
                ditemukan {dateFormat.format(new Date(item.firstSeenAt))} WIB
                {item.alsoIn > 0 ? ` · juga di ${String(item.alsoIn)} sumber lain` : ''}
              </p>
              <ItemActions id={item.id} status={item.status} categories={categories} />
            </li>
          ))}
        </ul>
      )}
      {inbox.nextCursor !== null && (
        <nav className="pager" aria-label="Halaman inbox">
          <Link
            href={`/os/inbox?${new URLSearchParams({ ...(status === 'new' ? {} : { status }), setelah: inbox.nextCursor }).toString()}`}
          >
            Item lebih lama
          </Link>
        </nav>
      )}
    </>
  );
}
