// Agent tool gateway (P3-02, ADR-020): the only way an AI agent reaches NALARA.
//
//   GET  /api/v1/agent/status          kill switch and quotas
//   POST /api/v1/agent/tools/:name     one allowlisted tool, JSON body = its input
//
// - Authentication: `Authorization: Bearer <token>` of an active agent credential. Founder
//   sessions are not accepted here (cookies are ignored), and agent tokens are not accepted
//   anywhere else.
// - `X-Agent-Role` names the role; the tool must be in that role's allowlist.
// - With AI switched off every tool is refused except `status` and `usage.record`.
// - Writes count against the daily quotas, and a spent token budget stops everything but
//   `status` and `usage.record`.
// - Writes and refusals are audited (actor type `agent`, the credential's label, the tool).
// The edge proxy never routes /api/v1/agent/* (Caddyfile): the runner reaches the API on the
// internal network only.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { schema } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';
import { recordAudit } from '../modules/audit/audit.ts';
import { findCredential } from '../modules/agent/credentials.ts';
import type { AgentCredential } from '../modules/agent/credentials.ts';
import { getAiSettings, usageToday } from '../modules/agent/settings.ts';
import { ROLE_TOOLS, isRole, isTool, runTool, toolPolicy } from '../modules/agent/tools.ts';
import type { ToolName } from '../modules/agent/tools.ts';
import type { AgentRole } from '../modules/proposals/proposals.ts';

type Db = NodePgDatabase<typeof schema>;

interface AgentCaller {
  readonly credential: AgentCredential;
  readonly role: AgentRole;
}

async function caller(db: Db, request: FastifyRequest): Promise<AgentCaller> {
  const header = request.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header) : null;
  if (match?.[1] === undefined) throw new AppError('UNAUTHORIZED');
  let credential: AgentCredential | null;
  try {
    credential = await findCredential(db, match[1]);
  } catch {
    throw new AppError('NOT_READY');
  }
  if (credential === null) throw new AppError('UNAUTHORIZED');
  const role = request.headers['x-agent-role'];
  if (!isRole(role)) throw new AppError('FORBIDDEN');
  return { credential, role };
}

export function agentRoutes(app: FastifyInstance, options: { readonly db: Db }): Promise<void> {
  const { db } = options;

  const audit = (
    who: AgentCaller,
    tool: ToolName | 'unknown',
    request: FastifyRequest,
    result: 'success' | 'denied' | 'failure',
    outcome: string,
  ) =>
    recordAudit(db, {
      action: 'agent.tool',
      actorType: 'agent',
      result,
      requestId: request.id,
      metadata: { tool, role: who.role, credential: who.credential.label, outcome },
    });

  async function call(request: FastifyRequest, name: string, body: unknown): Promise<unknown> {
    const who = await caller(db, request);
    if (!isTool(name)) {
      await audit(who, 'unknown', request, 'denied', 'unknown_tool');
      throw new AppError('NOT_FOUND');
    }
    if (!ROLE_TOOLS[who.role].includes(name)) {
      await audit(who, name, request, 'denied', 'not_allowed');
      throw new AppError('FORBIDDEN');
    }
    const policy = toolPolicy(name);
    if (!policy.whenDisabled) {
      const settings = await getAiSettings(db);
      if (!settings.aiEnabled) {
        await audit(who, name, request, 'denied', 'disabled');
        throw new AppError('AGENT_DISABLED');
      }
      if ((await usageToday(db)).tokens >= settings.dailyTokenQuota) {
        await audit(who, name, request, 'denied', 'token_quota');
        throw new AppError('QUOTA_EXCEEDED');
      }
    }
    try {
      const result = await runTool(
        { db, credential: who.credential, role: who.role, requestId: request.id },
        name,
        body,
      );
      if (policy.writes) await audit(who, name, request, 'success', 'ok');
      return result;
    } catch (error) {
      if (policy.writes && error instanceof AppError) {
        await audit(
          who,
          name,
          request,
          error.code === 'QUOTA_EXCEEDED' || error.code === 'FORBIDDEN' ? 'denied' : 'failure',
          error.code.toLowerCase(),
        );
      }
      throw error;
    }
  }

  app.get('/status', (request) => call(request, 'status', {}));
  // Drafts from the writer agent can be up to ~40 KB of source (same order as the editor).
  app.post('/tools/:name', { bodyLimit: 128 * 1024 }, (request) => {
    const { name } = request.params as { name: string };
    return call(request, name, request.body);
  });
  return Promise.resolve();
}
