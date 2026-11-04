// Kill switch and daily quotas (P3-02, ADR-020). AI is off by default; with it off the gateway
// refuses every tool except `status`. Quotas cap agents over a rolling 24 hours even when it is on.
import { and, count, eq, gt, sql, sum } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import {
  agentPreferences,
  agentUsage,
  aiActionProposals,
  auditEvents,
  systemSettings,
} from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { parseOrThrow } from '../../lib/validation.ts';
import { plainText } from '../articles/content.ts';
import { recordAudit } from '../audit/audit.ts';

type Db = NodePgDatabase<typeof schema>;

export interface AiSettings {
  readonly aiEnabled: boolean;
  readonly dailyDraftQuota: number;
  readonly dailyProposalQuota: number;
  readonly dailyTokenQuota: number;
  readonly version: number;
  readonly updatedAt: Date;
}

const columns = {
  aiEnabled: systemSettings.aiEnabled,
  dailyDraftQuota: systemSettings.dailyDraftQuota,
  dailyProposalQuota: systemSettings.dailyProposalQuota,
  dailyTokenQuota: systemSettings.dailyTokenQuota,
  version: systemSettings.version,
  updatedAt: systemSettings.updatedAt,
};

export async function getAiSettings(db: Db): Promise<AiSettings> {
  const [row] = await db.select(columns).from(systemSettings);
  if (row === undefined) throw new Error('system_settings row missing');
  return row;
}

export const settingsInputSchema = z.strictObject({
  aiEnabled: z.boolean(),
  dailyDraftQuota: z.int().min(0).max(50),
  dailyProposalQuota: z.int().min(0).max(500),
  dailyTokenQuota: z.int().min(0).max(10_000_000),
  expectedVersion: z.int().min(1),
});

const SETTING_KEYS = [
  'aiEnabled',
  'dailyDraftQuota',
  'dailyProposalQuota',
  'dailyTokenQuota',
] as const;

export interface SettingsActor {
  readonly userId: string;
  readonly requestId?: string;
}

export async function updateAiSettings(
  db: Db,
  actor: SettingsActor,
  raw: unknown,
): Promise<AiSettings> {
  const input = parseOrThrow(settingsInputSchema, raw);
  return db.transaction(async (tx) => {
    const [current] = await tx.select(columns).from(systemSettings).for('update');
    if (current === undefined) throw new Error('system_settings row missing');
    if (current.version !== input.expectedVersion) throw new AppError('VERSION_CONFLICT');
    const changed = SETTING_KEYS.filter((key) => current[key] !== input[key]);
    if (changed.length === 0) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'settings', rule: 'unchanged' }]);
    }
    const [row] = await tx
      .update(systemSettings)
      .set({
        aiEnabled: input.aiEnabled,
        dailyDraftQuota: input.dailyDraftQuota,
        dailyProposalQuota: input.dailyProposalQuota,
        dailyTokenQuota: input.dailyTokenQuota,
        version: sql`${systemSettings.version} + 1`,
        updatedAt: sql`now()`,
      })
      .returning(columns);
    if (row === undefined) throw new Error('update returned no row');
    await recordAudit(tx, {
      action: 'ai.settings',
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'system_settings',
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
      metadata: { version: row.version, ai_enabled: row.aiEnabled, changed: changed.join(',') },
    });
    return row;
  });
}

/**
 * Switches AI off at once (the kill switch), whatever the version. Idempotent. Used by the OS and,
 * from P3-04, by the founder's Telegram `/stop`.
 */
export async function stopAi(db: Db, actor: SettingsActor): Promise<AiSettings> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(systemSettings)
      .set({
        aiEnabled: false,
        version: sql`${systemSettings.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(systemSettings.aiEnabled, true))
      .returning(columns);
    if (row === undefined) return getAiSettings(tx);
    await recordAudit(tx, {
      action: 'ai.settings',
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'system_settings',
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
      metadata: { version: row.version, ai_enabled: false, changed: 'aiEnabled' },
    });
    return row;
  });
}

export interface UsageToday {
  readonly drafts: number;
  readonly proposals: number;
  readonly tokens: number;
}

/** What agents used in the last 24 hours, for quotas and the founder's overview. */
export async function usageToday(db: Db): Promise<UsageToday> {
  const since = sql`now() - interval '1 day'`;
  const [drafts] = await db
    .select({ n: count() })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, 'article.create'),
        eq(auditEvents.actorType, 'agent'),
        gt(auditEvents.createdAt, since),
      ),
    );
  const [proposals] = await db
    .select({ n: count() })
    .from(aiActionProposals)
    .where(gt(aiActionProposals.createdAt, since));
  const [tokens] = await db
    .select({ n: sum(sql`${agentUsage.inputTokens} + ${agentUsage.outputTokens}`) })
    .from(agentUsage)
    .where(gt(agentUsage.createdAt, since));
  return {
    drafts: drafts?.n ?? 0,
    proposals: proposals?.n ?? 0,
    tokens: Number(tokens?.n ?? 0),
  };
}

export const preferencesInputSchema = z.strictObject({
  topics: z.array(plainText(40).trim().min(2)).max(20),
  notes: plainText(2000),
  expectedVersion: z.int().min(1),
});

/** The founder edits the agents' preferences directly (no proposal needed). */
export async function updateAgentPreferences(
  db: Db,
  actor: SettingsActor,
  raw: unknown,
): Promise<{ version: number }> {
  const input = parseOrThrow(preferencesInputSchema, raw);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(agentPreferences)
      .set({
        topics: input.topics,
        notes: input.notes,
        version: sql`${agentPreferences.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(agentPreferences.version, input.expectedVersion))
      .returning({ version: agentPreferences.version });
    if (row === undefined) throw new AppError('VERSION_CONFLICT');
    await recordAudit(tx, {
      action: 'ai.preferences',
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'agent_preferences',
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
      metadata: { version: row.version },
    });
    return row;
  });
}
