// Inbox API for the founder (P2-06). Inside the OS scope: founder session + permission policy;
// changes need CSRF.
import type { FastifyInstance } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { parseOrThrow } from '../lib/validation.ts';
import {
  countNewInbox,
  createDraftFromItem,
  listInbox,
  setInboxStatus,
} from '../modules/inbox/inbox.ts';
import { loadRadar, radarView } from '../modules/radar/radar.ts';
import type { AuthGuards } from '../plugins/auth.ts';

const uuid = z.uuid();
const listQuery = z.strictObject({
  status: z.enum(['new', 'seen', 'dismissed', 'used']).optional(),
  source: uuid.optional(),
  cursor: z.string().max(512).optional(),
});
const statusBody = z.strictObject({ status: z.enum(['new', 'seen', 'dismissed']) });

function itemId(params: unknown): string {
  const { id } = parseOrThrow(z.strictObject({ id: z.string() }), params);
  if (!uuid.safeParse(id).success) throw new AppError('NOT_FOUND');
  return id;
}

export function registerInboxRoutes(
  app: FastifyInstance,
  { db, guards }: { readonly db: NodePgDatabase<typeof schema>; readonly guards: AuthGuards },
): void {
  const actor = (request: { auth: { userId: string } | null; id: string }) => {
    if (request.auth === null) throw new AppError('UNAUTHORIZED');
    return { userId: request.auth.userId, requestId: request.id };
  };

  // Radar (P5-01): the inbox as stories, clustered and scored.
  app.get('/radar', { config: { permission: 'inbox.read' } }, async () => {
    const radar = await loadRadar(db);
    return { radar: radarView(radar) };
  });

  app.get('/inbox', { config: { permission: 'inbox.read' } }, async (request) => {
    const query = parseOrThrow(listQuery, request.query);
    const [page, newCount] = await Promise.all([
      listInbox(db, {
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.source === undefined ? {} : { sourceId: query.source }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      }),
      countNewInbox(db),
    ]);
    return { ...page, newCount };
  });

  app.patch(
    '/inbox/:id',
    { config: { permission: 'inbox.write' }, preHandler: guards.requireCsrf },
    async (request) => {
      const { status } = parseOrThrow(statusBody, request.body);
      await setInboxStatus(db, actor(request), itemId(request.params), status);
      return { status };
    },
  );

  app.post(
    '/inbox/:id/draft',
    { config: { permission: 'articles.write' }, preHandler: guards.requireCsrf },
    async (request, reply) => {
      const result = await createDraftFromItem(
        db,
        actor(request),
        itemId(request.params),
        request.body,
      );
      return reply.code(201).send(result);
    },
  );
}
