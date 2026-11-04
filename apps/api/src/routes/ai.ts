// AI settings for the founder (P3-02): the kill switch, daily quotas, agent preferences, and an
// overview of credentials and usage. Inside the OS scope (founder session + policy; CSRF on writes).
import type { FastifyInstance } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { listCredentials } from '../modules/agent/credentials.ts';
import {
  getAiSettings,
  stopAi,
  updateAgentPreferences,
  updateAiSettings,
  usageToday,
} from '../modules/agent/settings.ts';
import { getAgentPreferences } from '../modules/proposals/proposals.ts';
import type { AuthGuards } from '../plugins/auth.ts';

export function registerAiRoutes(
  app: FastifyInstance,
  { db, guards }: { readonly db: NodePgDatabase<typeof schema>; readonly guards: AuthGuards },
): void {
  const actor = (request: { auth: { userId: string } | null; id: string }) => {
    if (request.auth === null) throw new AppError('UNAUTHORIZED');
    return { userId: request.auth.userId, requestId: request.id };
  };

  app.get('/ai', { config: { permission: 'ai.read' } }, async () => {
    const [settings, usage, preferences, credentials] = await Promise.all([
      getAiSettings(db),
      usageToday(db),
      getAgentPreferences(db),
      listCredentials(db),
    ]);
    return { settings, usage, preferences, credentials };
  });

  app.put(
    '/ai/settings',
    { config: { permission: 'ai.write' }, preHandler: guards.requireCsrf },
    async (request) => ({ settings: await updateAiSettings(db, actor(request), request.body) }),
  );

  // The kill switch: always succeeds, whatever version the page had.
  app.post(
    '/ai/stop',
    { config: { permission: 'ai.write' }, preHandler: guards.requireCsrf },
    async (request) => ({ settings: await stopAi(db, actor(request)) }),
  );

  app.put(
    '/ai/preferences',
    { config: { permission: 'ai.write' }, preHandler: guards.requireCsrf },
    async (request) => updateAgentPreferences(db, actor(request), request.body),
  );
}
