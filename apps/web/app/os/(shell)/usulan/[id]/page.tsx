// One agent proposal with its target and decision (P3-01).
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiUnauthorized, getProposal } from '../../../../../lib/api';
import { ProposalCard } from '../proposal-card';

export const metadata: Metadata = { title: 'Usulan agent' };
export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

export default async function ProposalPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookie = (await headers()).get('cookie');
  let proposal;
  try {
    proposal = await getProposal(cookie, id);
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  if (proposal === null) notFound();
  const stale =
    proposal.status === 'pending' &&
    proposal.targetVersion !== null &&
    proposal.target?.currentVersion !== undefined &&
    proposal.target.currentVersion !== null &&
    proposal.target.currentVersion !== proposal.targetVersion;

  return (
    <>
      <p>
        <Link href="/os/usulan">← Semua usulan</Link>
      </p>
      <ProposalCard proposal={proposal} targetLabel={proposal.target?.label ?? null} />
      {stale && (
        <p className="error">
          Data tujuannya sudah berubah sejak usulan ini dibuat. Menyetujuinya akan gagal tanpa
          menimpa apa pun.
        </p>
      )}
      {proposal.decision !== null && (
        <p className="muted">
          {proposal.decision.decision === 'approve' ? 'Disetujui' : 'Ditolak'} lewat{' '}
          {proposal.decision.channel === 'telegram' ? 'Telegram' : 'NALARA OS'} pada{' '}
          {dateFormat.format(new Date(proposal.decision.decidedAt))} WIB
        </p>
      )}
      {proposal.kind === 'sources.propose_create' && proposal.resultId !== null && (
        <p>
          <Link href={`/os/sources/${proposal.resultId}`}>Buka sumber yang dibuat</Link>
        </p>
      )}
    </>
  );
}
