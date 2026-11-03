// Private founder API (PRD B §6.2, PRD v4 §4.2). Hooks are attached at the plugin level, so every
// route registered here, now or later, requires an authenticated founder AND a declared
// permission (P1-01 policy); neither can be forgotten.
import type { FastifyPluginAsync } from 'fastify';
import type { AuthGuards } from '../plugins/auth.ts';
import { enforcePolicy } from '../plugins/policy.ts';

export const osRoutes: FastifyPluginAsync<{ readonly guards: AuthGuards }> = (app, { guards }) => {
  app.addHook('preHandler', guards.requireFounder);
  enforcePolicy(app);

  app.get('/ping', { config: { permission: 'os.access' } }, () => Promise.resolve({ ok: true }));
  return Promise.resolve();
};
