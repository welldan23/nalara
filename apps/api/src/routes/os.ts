// Private founder API (PRD B §6.2). The guard is attached at the plugin level, so every route
// registered here, now or later, requires an authenticated founder; it cannot be forgotten.
import type { FastifyPluginAsync } from 'fastify';
import type { AuthGuards } from '../plugins/auth.ts';

export const osRoutes: FastifyPluginAsync<{ readonly guards: AuthGuards }> = (app, { guards }) => {
  app.addHook('preHandler', guards.requireFounder);

  app.get('/ping', () => Promise.resolve({ ok: true }));
  return Promise.resolve();
};
