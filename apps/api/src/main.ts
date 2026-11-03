// API process entry point. Phase 0 so far: validate configuration and fail fast.
// The HTTP server is added in P0-006.
import { ConfigError, describeConfig, loadConfig } from './config/env.ts';

function log(level: 'info' | 'fatal', msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra });
  if (level === 'fatal') console.error(line);
  else console.info(line);
}

try {
  const config = loadConfig(process.env);
  log('info', 'configuration loaded', { config: describeConfig(config) });
} catch (error) {
  if (error instanceof ConfigError) {
    log('fatal', 'invalid configuration, refusing to start', { issues: error.issues });
    process.exitCode = 1;
  } else {
    throw error;
  }
}
