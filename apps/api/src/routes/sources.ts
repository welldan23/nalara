// Source Registry API for the founder (P1-05). Registered inside the OS scope: every route is
// behind requireFounder and the permission policy; mutations also need CSRF.
import type { FastifyInstance } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { SOURCE_STATUSES } from '../db/schema.ts';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { parseOrThrow } from '../lib/validation.ts';
import {
  createSource,
  getSource,
  listSourceChecks,
  listSources,
  requestFeedCheck,
  updateSource,
} from '../modules/sources/sources.ts';
import type { AuthGuards } from '../plugins/auth.ts';

const listQuery = z.strictObject({ status: z.enum(SOURCE_STATUSES).optional() });
const idParams = z.strictObject({ id: z.string() });
const uuid = z.uuid();
// The rest of the body is validated by the module's source schema.
const updateEnvelope = z.looseObject({ expectedVersion: z.number().int() });

function sourceId(params: unknown): string {
  const { id } = parseOrThrow(idParams, params);
  // A malformed id is simply "not found", the same answer as a missing source.
  if (!uuid.safeParse(id).success) throw new AppError('NOT_FOUND');
  return id;
}

export function registerSourceRoutes(
  app: FastifyInstance,
  { db, guards }: { readonly db: NodePgDatabase<typeof schema>; readonly guards: AuthGuards },
): void {
  const actor = (request: { auth: { userId: string } | null; id: string }) => {
    if (request.auth === null) throw new AppError('UNAUTHORIZED');
    return { userId: request.auth.userId, requestId: request.id };
  };

  app.get('/sources', { config: { permission: 'sources.read' } }, async (request) => {
    const query = parseOrThrow(listQuery, request.query);
    return {
      sources: await listSources(db, query.status === undefined ? {} : { status: query.status }),
    };
  });

  app.get('/sources/:id', { config: { permission: 'sources.read' } }, async (request) => {
    const id = sourceId(request.params);
    const source = await getSource(db, id);
    if (source === null) throw new AppError('NOT_FOUND');
    return { source, checks: await listSourceChecks(db, id) };
  });

  // Queue a feed check for the worker (P2-03b). 202: the result arrives in the check history.
  app.post(
    '/sources/:id/check-feed',
    { config: { permission: 'sources.write' }, preHandler: guards.requireCsrf },
    async (request, reply) => {
      const queued = await requestFeedCheck(db, actor(request), sourceId(request.params));
      return reply.code(202).send({ queued });
    },
  );

  app.post(
    '/sources',
    { config: { permission: 'sources.write' }, preHandler: guards.requireCsrf },
    async (request, reply) => {
      const source = await createSource(db, actor(request), request.body);
      return reply.code(201).send({ source });
    },
  );

  app.patch(
    '/sources/:id',
    { config: { permission: 'sources.write' }, preHandler: guards.requireCsrf },
    async (request) => {
      const id = sourceId(request.params);
      const { expectedVersion, ...fields } = parseOrThrow(updateEnvelope, request.body);
      return { source: await updateSource(db, actor(request), id, fields, expectedVersion) };
    },
  );
}
