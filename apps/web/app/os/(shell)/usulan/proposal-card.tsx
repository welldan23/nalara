// One agent proposal, rendered as plain text (its payload and reason come from an AI agent).
import Link from 'next/link';
import type { Proposal } from '../../../../lib/api';
import {
  KIND_LABELS,
  PROPOSAL_FAILURES,
  PROPOSAL_STATUS_LABELS,
  ROLE_LABELS,
  payloadLines,
} from '../../../../lib/proposal-messages';
import { DecisionButtons } from './decision-buttons';

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

export function ProposalCard(props: {
  readonly proposal: Proposal;
  readonly targetLabel?: string | null;
  readonly linkTitle?: boolean;
}) {
  const { proposal } = props;
  const title = KIND_LABELS[proposal.kind] ?? proposal.kind;
  const lines = payloadLines(proposal.kind, proposal.payload);
  return (
    <article className="proposal" data-testid="proposal">
      <p className="kicker">
        Agent {ROLE_LABELS[proposal.agentRole] ?? proposal.agentRole} ·{' '}
        {PROPOSAL_STATUS_LABELS[proposal.status] ?? proposal.status}
      </p>
      <h2 className="inbox-title">
        {props.linkTitle === true ? <Link href={`/os/usulan/${proposal.id}`}>{title}</Link> : title}
      </h2>
      {props.targetLabel !== undefined && props.targetLabel !== null && (
        <p>
          Untuk: <strong>{props.targetLabel}</strong>
        </p>
      )}
      <p className="proposal-reason">Alasan agent: {proposal.reason}</p>
      {lines.length > 0 && (
        <dl className="proposal-payload">
          {lines.map(([label, value], index) => (
            <div key={`${label}-${String(index)}`}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="muted">
        Dibuat {dateFormat.format(new Date(proposal.createdAt))} WIB
        {proposal.status === 'pending'
          ? ` · kedaluwarsa ${dateFormat.format(new Date(proposal.expiresAt))} WIB`
          : ''}
      </p>
      {proposal.failure !== null && (
        <p className="error">{PROPOSAL_FAILURES[proposal.failure] ?? proposal.failure}</p>
      )}
      {proposal.status === 'pending' && <DecisionButtons id={proposal.id} />}
    </article>
  );
}
