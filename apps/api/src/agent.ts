// Agent runner process (P3-03, ADR-020). Same image as the API, separate container, and no
// database credentials: it reaches NALARA only through the agent tool gateway, and the AI
// provider only through the safe fetch. Idle until the founder picks a provider (D-25) and
// switches AI on. SIGTERM/SIGINT stop it between steps.
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { ConfigError, loadAgentRunnerConfig } from './config/env.ts';
import { gatewayClient } from './agent/gateway-client.ts';
import { runCycle } from './agent/runner.ts';
import type { RunnerLog } from './agent/runner.ts';

/** The container healthcheck looks at this file's age (it lives on the /tmp tmpfs). */
export const HEARTBEAT_FILE = '/tmp/nalara-agent.alive';

function line(level: string, fields: Record<string, unknown>, msg: string): void {
  process.stdout.write(
    `${JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields })}\n`,
  );
}

const log: RunnerLog = {
  info: (fields, msg) => {
    line('info', fields, msg);
  },
  warn: (fields, msg) => {
    line('warn', fields, msg);
  },
};

function beat(): void {
  try {
    writeFileSync(HEARTBEAT_FILE, new Date().toISOString());
  } catch {
    // No writable /tmp: the healthcheck reports it.
  }
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadAgentRunnerConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      line('fatal', { issues: error.issues }, 'invalid configuration, refusing to start');
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  const controller = new AbortController();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      line('info', { signal }, 'agent runner stopping');
      controller.abort();
    });
  }
  const stopped = () => controller.signal.aborted;
  const gateway = gatewayClient(config.gatewayUrl, config.token);
  line(
    'info',
    { roles: config.roles, provider: config.provider === null ? 'none' : 'configured' },
    config.provider === null
      ? 'agent runner started without an AI provider (D-25); staying idle'
      : 'agent runner started',
  );
  while (!stopped()) {
    beat();
    await runCycle({
      gateway,
      provider: config.provider,
      roles: config.roles,
      log,
      signal: controller.signal,
    });
    // Sleep in short slices so the heartbeat stays fresh and a stop is quick.
    const until = Date.now() + config.intervalSeconds * 1000;
    while (!stopped() && Date.now() < until) {
      beat();
      await sleep(Math.min(30_000, until - Date.now()), undefined, {
        signal: controller.signal,
      }).catch(() => undefined);
    }
  }
}

void main();
