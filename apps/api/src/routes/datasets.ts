// NALARA Data catalogue for the founder (P4-02). Inside the OS scope (founder session + policy;
// CSRF on writes). Raw files travel as base64 in JSON (ADR-011), hence the larger body limit on
// the preview and version routes.
import type { FastifyInstance } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { parseOrThrow } from '../lib/validation.ts';
import {
  addVersion,
  createDataset,
  getDataset,
  getRawFile,
  listDatasets,
  previewTransform,
  publishDataset,
  retractDataset,
  updateDataset,
  verifyVersion,
} from '../modules/data/datasets.ts';
import { LIMITS } from '../modules/data/transform.ts';
import type { AuthGuards } from '../plugins/auth.ts';

/** base64 of the largest raw file, plus room for the metadata. */
export const DATASET_UPLOAD_BODY_LIMIT = Math.ceil((LIMITS.rawBytes * 4) / 3) + 64 * 1024;

const uuid = z.uuid();
function datasetId(params: unknown): string {
  const { id } = parseOrThrow(z.object({ id: z.string() }), params);
  if (!uuid.safeParse(id).success) throw new AppError('NOT_FOUND');
  return id;
}
function versionNumber(params: unknown): number {
  const { version } = parseOrThrow(z.object({ version: z.string() }), params);
  if (!/^[1-9]\d{0,5}$/.test(version)) throw new AppError('NOT_FOUND');
  return Number(version);
}

export function registerDatasetRoutes(
  app: FastifyInstance,
  { db, guards }: { readonly db: NodePgDatabase<typeof schema>; readonly guards: AuthGuards },
): void {
  const actor = (request: { auth: { userId: string } | null; id: string }) => {
    if (request.auth === null) throw new AppError('UNAUTHORIZED');
    return { userId: request.auth.userId, requestId: request.id };
  };
  const write = { config: { permission: 'data.write' as const }, preHandler: guards.requireCsrf };

  app.get('/datasets', { config: { permission: 'data.read' } }, async () => ({
    datasets: await listDatasets(db),
  }));

  app.get('/datasets/:id', { config: { permission: 'data.read' } }, async (request) => {
    const found = await getDataset(db, datasetId(request.params));
    if (found === null) throw new AppError('NOT_FOUND');
    return found;
  });

  app.post('/datasets', write, async (request, reply) =>
    reply.code(201).send(await createDataset(db, actor(request), request.body)),
  );

  app.put('/datasets/:id', write, async (request) =>
    updateDataset(db, actor(request), datasetId(request.params), request.body),
  );

  // Dry run of a transform: nothing is stored.
  app.post('/datasets/preview', { ...write, bodyLimit: DATASET_UPLOAD_BODY_LIMIT }, (request) =>
    previewTransform(request.body),
  );

  app.post(
    '/datasets/:id/versions',
    { ...write, bodyLimit: DATASET_UPLOAD_BODY_LIMIT },
    async (request, reply) =>
      reply
        .code(201)
        .send(await addVersion(db, actor(request), datasetId(request.params), request.body)),
  );

  app.post('/datasets/:id/versions/:version/verify', write, async (request) =>
    verifyVersion(db, datasetId(request.params), versionNumber(request.params)),
  );

  app.get(
    '/datasets/:id/versions/:version/raw',
    { config: { permission: 'data.read' } },
    async (request, reply) => {
      const file = await getRawFile(db, datasetId(request.params), versionNumber(request.params));
      if (file === null) throw new AppError('NOT_FOUND');
      // An attachment of unknown type: never rendered by the browser.
      return reply
        .header('content-type', 'application/octet-stream')
        .header(
          'content-disposition',
          `attachment; filename="nalara-data-${file.sha256.slice(0, 12)}.csv"`,
        )
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('x-raw-sha256', file.sha256)
        .send(file.raw);
    },
  );

  app.post('/datasets/:id/publish', write, async (request) =>
    publishDataset(db, actor(request), datasetId(request.params), request.body),
  );

  app.post('/datasets/:id/retract', write, async (request) => {
    await retractDataset(db, actor(request), datasetId(request.params), request.body);
    return { status: 'retracted' };
  });
}
