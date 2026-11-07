// The agent runner's loop (P3-03, ADR-020). One task per role per cycle:
//   status → (AI on?) → model ↔ tools, at most MAX_STEPS model calls → done.
// - The model sees only its role's tools. A call to anything else is answered with an error and
//   never reaches the gateway; the gateway enforces the same allowlist again.
// - Tool results go back to the model as JSON; outside content is already under `external`.
// - Every model call's token use is reported to the gateway (usage.record).
// - The kill switch, a spent quota or an unreachable gateway ends the task at once.
// - Nothing the model writes is logged: only counts, codes and durations.
import { randomUUID } from 'node:crypto';
import { modelFor } from '../config/env.ts';
import type { AgentProviderConfig, AgentRoleName } from '../config/env.ts';
import { GatewayError } from './gateway-client.ts';
import type { Gateway } from './gateway-client.ts';
import { ModelError, chat } from './model.ts';
import type { ChatMessage, ModelFetchOptions } from './model.ts';
import { roleTools, systemPrompt } from './roles.ts';

export const MAX_STEPS = 8;
const MAX_ARGUMENTS = 64 * 1024;
const MAX_RESULT = 30_000;
/** Codes after which the task must stop rather than let the model try again. */
const STOP_CODES = new Set(['AGENT_DISABLED', 'QUOTA_EXCEEDED', 'UNAUTHORIZED', 'NOT_READY']);

export interface RunnerLog {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
}

export interface TaskDeps {
  readonly gateway: Gateway;
  readonly provider: AgentProviderConfig;
  readonly log: RunnerLog;
  readonly fetchOptions?: ModelFetchOptions;
  readonly signal?: AbortSignal;
}

export interface TaskResult {
  readonly role: AgentRoleName;
  readonly outcome: 'done' | 'disabled' | 'stopped' | 'step_limit' | 'model_error';
  readonly steps: number;
  readonly toolCalls: number;
  readonly refusedCalls: number;
  readonly code?: string;
}

function clip(text: string): string {
  return text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}…(dipotong)` : text;
}

export async function runTask(deps: TaskDeps, role: AgentRoleName): Promise<TaskResult> {
  const { gateway, provider, log } = deps;
  const status = await gateway.status(role);
  if (!status.aiEnabled) {
    return { role, outcome: 'disabled', steps: 0, toolCalls: 0, refusedCalls: 0 };
  }
  const { specs, byModelName } = roleTools(role);
  // Each role may run on its own model (AI_MODEL_<ROLE>), e.g. a checker from another family.
  const chatOptions = { model: modelFor(provider, role), sessionId: randomUUID() };
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(role) },
    { role: 'user', content: 'Mulai putaran tugasmu sekarang.' },
  ];
  let toolCalls = 0;
  let refusedCalls = 0;
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    if (deps.signal?.aborted === true) {
      return { role, outcome: 'stopped', steps: step - 1, toolCalls, refusedCalls };
    }
    let reply;
    try {
      reply = await chat(provider, messages, specs, chatOptions, deps.fetchOptions);
    } catch (error) {
      const code = error instanceof ModelError ? error.code : 'model:unknown';
      log.warn({ role, code }, 'model call failed');
      return { role, outcome: 'model_error', steps: step, toolCalls, refusedCalls, code };
    }
    try {
      await gateway.call(role, 'usage.record', {
        model: chatOptions.model,
        inputTokens: reply.usage.inputTokens,
        outputTokens: reply.usage.outputTokens,
      });
    } catch (error) {
      log.warn(
        { role, code: error instanceof GatewayError ? error.code : 'unknown' },
        'usage not recorded',
      );
    }
    messages.push(reply.message);
    const calls = reply.message.tool_calls ?? [];
    if (calls.length === 0) {
      return { role, outcome: 'done', steps: step, toolCalls, refusedCalls };
    }
    for (const call of calls) {
      const gatewayName = byModelName.get(call.function.name);
      let answer: unknown;
      if (gatewayName === undefined) {
        refusedCalls += 1;
        answer = { error: 'tool_not_available', message: 'Tool ini tidak tersedia untuk peranmu.' };
      } else {
        let input: unknown = null;
        if (call.function.arguments.length <= MAX_ARGUMENTS) {
          try {
            input = JSON.parse(call.function.arguments === '' ? '{}' : call.function.arguments);
          } catch {
            input = null;
          }
        }
        if (input === null || typeof input !== 'object' || Array.isArray(input)) {
          refusedCalls += 1;
          answer = { error: 'invalid_arguments' };
        } else {
          toolCalls += 1;
          try {
            answer = await gateway.call(role, gatewayName, input);
          } catch (error) {
            if (!(error instanceof GatewayError)) throw error;
            if (STOP_CODES.has(error.code)) {
              log.info({ role, code: error.code }, 'task stopped by the gateway');
              return {
                role,
                outcome: 'stopped',
                steps: step,
                toolCalls,
                refusedCalls,
                code: error.code,
              };
            }
            answer = { error: error.code };
          }
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: clip(JSON.stringify(answer)) });
    }
  }
  return { role, outcome: 'step_limit', steps: MAX_STEPS, toolCalls, refusedCalls };
}

export interface CycleDeps extends Omit<TaskDeps, 'provider'> {
  readonly provider: AgentProviderConfig | null;
  readonly roles: readonly AgentRoleName[];
}

/** One pass over the configured roles. Idle without a provider (D-25) or with AI switched off. */
export async function runCycle(deps: CycleDeps): Promise<TaskResult[]> {
  const { provider } = deps;
  if (provider === null) return [];
  const results: TaskResult[] = [];
  for (const role of deps.roles) {
    if (deps.signal?.aborted === true) break;
    try {
      const result = await runTask({ ...deps, provider }, role);
      results.push(result);
      deps.log.info({ ...result }, 'agent task finished');
      if (result.outcome === 'disabled') break;
    } catch (error) {
      const code = error instanceof GatewayError ? error.code : 'runner:unexpected';
      deps.log.warn({ role, code }, 'agent task failed');
      if (error instanceof GatewayError) break;
    }
  }
  return results;
}
