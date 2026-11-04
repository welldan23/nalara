// Private founder API (PRD B §6.2, PRD v4 §4.2). Hooks are attached at the plugin level, so every
// route registered here, now or later, requires an authenticated founder AND a declared
// permission (P1-01 policy); neither can be forgotten.
import type { FastifyPluginAsync } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { schema } from '../db/schema.ts';
import type { AuthGuards } from '../plugins/auth.ts';
import { enforcePolicy } from '../plugins/policy.ts';
import { registerArticleRoutes } from './articles.ts';
import { registerSourceRoutes } from './sources.ts';

export interface OsRoutesOptions {
  readonly guards: AuthGuards;
  readonly db: NodePgDatabase<typeof schema>;
}

export const osRoutes: FastifyPluginAsync<OsRoutesOptions> = (app, { guards, db }) => {
  app.addHook('preHandler', guards.requireFounder);
  enforcePolicy(app);

  app.get('/ping', { config: { permission: 'os.access' } }, () => Promise.resolve({ ok: true }));
  registerArticleRoutes(app, { db, guards });
  registerSourceRoutes(app, { db, guards });
  return Promise.resolve();
};
