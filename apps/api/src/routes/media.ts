// Media library API for the founder (P1-09). Inside the OS scope: founder session + permission
// policy; uploads and edits need CSRF. The file route serves the stripped bytes for previews.
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { parseOrThrow } from '../lib/validation.ts';
import {
  MEDIA_UPLOAD_BODY_LIMIT,
  getMedia,
  getMediaFile,
  listMedia,
  updateMedia,
  uploadMedia,
} from '../modules/media/media.ts';
import type { MediaFile } from '../modules/media/media.ts';
import type { AuthGuards } from '../plugins/auth.ts';

const idParams = z.strictObject({ id: z.string() });
const uuid = z.uuid();
const updateEnvelope = z.looseObject({ expectedVersion: z.number().int() });

export function mediaId(params: unknown): string {
  const { id } = parseOrThrow(idParams, params);
  // A malformed id is simply "not found", the same answer as a missing image.
  if (!uuid.safeParse(id).success) throw new AppError('NOT_FOUND');
  return id;
}

/**
 * Send stored image bytes. The type is the one recognised from the magic bytes at upload, never
 * one a client declared; nosniff and a sandboxing CSP keep browsers from treating it as anything
 * else.
 */
export function sendImage(reply: FastifyReply, file: MediaFile, cacheControl: string) {
  return reply
    .header('content-type', file.mime)
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header('content-disposition', 'inline')
    .header('cache-control', cacheControl)
    .header('etag', `"${file.sha256.toString('hex')}"`)
    .send(file.data);
}

export function registerMediaRoutes(
  app: FastifyInstance,
  { db, guards }: { readonly db: NodePgDatabase<typeof schema>; readonly guards: AuthGuards },
): void {
  const actor = (request: { auth: { userId: string } | null; id: string }) => {
    if (request.auth === null) throw new AppError('UNAUTHORIZED');
    return { userId: request.auth.userId, requestId: request.id };
  };

  app.get('/media', { config: { permission: 'media.read' } }, async () => ({
    media: await listMedia(db),
  }));

  app.get('/media/:id', { config: { permission: 'media.read' } }, async (request) => {
    const media = await getMedia(db, mediaId(request.params));
    if (media === null) throw new AppError('NOT_FOUND');
    return { media };
  });

  app.get('/media/:id/file', { config: { permission: 'media.read' } }, async (request, reply) => {
    const file = await getMediaFile(db, mediaId(request.params));
    if (file === null) throw new AppError('NOT_FOUND');
    return sendImage(reply, file, 'private, max-age=300');
  });

  app.post(
    '/media',
    {
      config: { permission: 'media.write' },
      bodyLimit: MEDIA_UPLOAD_BODY_LIMIT,
      // Check the session before the (up to 7 MiB) body is read and parsed, so an anonymous
      // client cannot make the API parse large uploads. The scope's preHandler checks again.
      onRequest: async (request, reply) => {
        await guards.requireFounder.call(app, request, reply);
      },
      preHandler: guards.requireCsrf,
    },
    async (request, reply) => {
      const media = await uploadMedia(db, actor(request), request.body);
      return reply.code(201).send({ media });
    },
  );

  app.patch(
    '/media/:id',
    { config: { permission: 'media.write' }, preHandler: guards.requireCsrf },
    async (request) => {
      const id = mediaId(request.params);
      const { expectedVersion, ...fields } = parseOrThrow(updateEnvelope, request.body);
      return { media: await updateMedia(db, actor(request), id, fields, expectedVersion) };
    },
  );
}
