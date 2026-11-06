// Agent proposals (P3-01): what the AI agents would like changed. Nothing here has happened yet;
// only "Setujui" applies a proposal, and only against the version it was written for.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiUnauthorized, listProposals, listStoryQueue } from '../../../../lib/api';
import { PROPOSAL_STATUS_LABELS } from '../../../../lib/proposal-messages';
import { ProposalCard } from './proposal-card';

const QUEUE_STATUS_LABELS: Readonly<Record<string, string>> = {
  drafting: 'Sedang ditulis agent',
  drafted: 'Draft siap dicek',
  sent: 'Dikirim ke Telegram',
  published: 'Terbit',
  skipped: 'Dilewati',
  expired: 'Kedaluwarsa',
};

export const metadata: Metadata = { title: 'Usulan agent' };
export const dynamic = 'force-dynamic';

const TABS = ['pending', 'approved', 'rejected', 'failed', 'expired'] as const;

export default async function ProposalsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string | string[]; setelah?: string | string[] }>;
}) {
  const query = await searchParams;
  const status = TABS.find((value) => value === query.status) ?? 'pending';
  const cursor =
    typeof query.setelah === 'string' && query.setelah.length <= 512 ? query.setelah : undefined;
  const cookie = (await headers()).get('cookie');
  let page;
  let queue;
  try {
    [page, queue] = await Promise.all([
      listProposals(cookie, { status, ...(cursor === undefined ? {} : { cursor }) }),
      listStoryQueue(cookie),
    ]);
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }

  return (
    <>
      <h1>Usulan agent</h1>
      <p className="muted">
        Agent AI tidak pernah mengubah apa pun sendiri. Semua yang mereka mau ubah muncul di sini
        dan baru terjadi setelah kamu menyetujuinya. Isi usulan ditulis AI: baca dengan kritis.
      </p>
      <nav className="filter-nav" aria-label="Saring usulan">
        {TABS.map((value) => (
          <Link
            key={value}
            href={value === 'pending' ? '/os/usulan' : `/os/usulan?status=${value}`}
            aria-current={status === value ? 'page' : undefined}
          >
            {PROPOSAL_STATUS_LABELS[value]}
            {value === 'pending' && page.pendingCount > 0 ? ` (${String(page.pendingCount)})` : ''}
          </Link>
        ))}
      </nav>
      {page.items.length === 0 ? (
        <p className="muted">
          {status === 'pending' ? 'Belum ada usulan yang menunggu.' : 'Tidak ada usulan di sini.'}
        </p>
      ) : (
        <ul className="inbox-list" data-testid="proposals">
          {page.items.map((proposal) => (
            <li key={proposal.id}>
              <ProposalCard proposal={proposal} linkTitle />
            </li>
          ))}
        </ul>
      )}
      {queue.length > 0 && (
        <section aria-labelledby="antrean" data-testid="story-queue">
          <h2 id="antrean">Antrean Radar</h2>
          <p className="muted">
            Cerita berskor tinggi yang diambil agent Penulis untuk dijadikan draft. Paling banyak 3
            per jam dan 12 per hari; jam 01.00 sampai 05.00 WIB hanya cerita besar.
          </p>
          <ul className="article-list">
            {queue.map((story) => (
              <li key={story.id}>
                <p>
                  <strong>{story.score}</strong> {story.title}
                </p>
                <p className="muted">
                  {QUEUE_STATUS_LABELS[story.status] ?? story.status}
                  {story.articleId !== null && (
                    <>
                      {'. '}
                      <Link href={`/os/newsroom/${story.articleId}`}>Buka draft</Link>
                    </>
                  )}
                  {story.note !== null ? `. Catatan: ${story.note}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {page.nextCursor !== null && (
        <nav className="pager" aria-label="Halaman usulan">
          <Link
            href={`/os/usulan?${new URLSearchParams({ ...(status === 'pending' ? {} : { status }), setelah: page.nextCursor }).toString()}`}
          >
            Usulan lebih lama
          </Link>
        </nav>
      )}
    </>
  );
}
