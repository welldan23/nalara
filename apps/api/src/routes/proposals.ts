// Agent proposals for the founder (P3-01). Inside the OS scope: founder session + permission
// policy; deciding needs CSRF. Agents never reach these routes (they use the gateway, P3-02).
import type { FastifyInstance } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { PROPOSAL_STATUSES } from '../db/schema.ts';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { parseOrThrow } from '../lib/validation.ts';
import {
  countPendingProposals,
  decideProposal,
  getProposal,
  listProposals,
} from '../modules/proposals/proposals.ts';
import type { AuthGuards } from '../plugins/auth.ts';

const uuid = z.uuid();
const listQuery = z.strictObject({
  status: z.enum(PROPOSAL_STATUSES).optional(),
  cursor: z.string().max(512).optional(),
});
const decisionBody = z.strictObject({ decision: z.enum(['approve', 'reject']) });

function proposalId(params: unknown): string {
  const { id } = parseOrThrow(z.strictObject({ id: z.string() }), params);
  if (!uuid.safeParse(id).success) throw new AppError('NOT_FOUND');
  return id;
}

export function registerProposalRoutes(
  app: FastifyInstance,
  { db, guards }: { readonly db: NodePgDatabase<typeof schema>; readonly guards: AuthGuards },
): void {
  app.get('/proposals', { config: { permission: 'proposals.read' } }, async (request) => {
    const query = parseOrThrow(listQuery, request.query);
    const [page, pendingCount] = await Promise.all([
      listProposals(db, {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      }),
      countPendingProposals(db),
    ]);
    return { ...page, pendingCount };
  });

  app.get('/proposals/:id', { config: { permission: 'proposals.read' } }, async (request) => {
    const proposal = await getProposal(db, proposalId(request.params));
    if (proposal === null) throw new AppError('NOT_FOUND');
    return { proposal };
  });

  app.post(
    '/proposals/:id/decision',
    { config: { permission: 'proposals.decide' }, preHandler: guards.requireCsrf },
    async (request) => {
      if (request.auth === null) throw new AppError('UNAUTHORIZED');
      const { decision } = parseOrThrow(decisionBody, request.body);
      return decideProposal(
        db,
        { userId: request.auth.userId, requestId: request.id },
        proposalId(request.params),
        decision,
      );
    },
  );
}
