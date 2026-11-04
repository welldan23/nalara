// Guards for GitHub Actions workflow hardening (ADR-008, PRD §14 TEST-CI-*).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowDir = join(root, '.github', 'workflows');
const workflows = readdirSync(workflowDir)
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => ({
    file,
    text: stripYamlComments(readFileSync(join(workflowDir, file), 'utf8')),
  }));

// Checks apply to effective YAML only, so a comment such as "no pull_request_target" is not a hit.
function stripYamlComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s+#.*$/, ''))
    .join('\n');
}

describe('CI workflow hardening', () => {
  it('has at least one workflow', () => {
    expect(workflows.map((workflow) => workflow.file)).toContain('ci.yml');
  });

  it('pins every action to a full 40-character commit SHA', () => {
    const unpinned: string[] = [];
    for (const { file, text } of workflows) {
      for (const match of text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
        const ref = match[1] ?? '';
        if (ref.startsWith('./')) continue;
        if (!/@[0-9a-f]{40}$/.test(ref)) unpinned.push(`${file}: ${ref}`);
      }
    }
    expect(unpinned).toEqual([]);
  });

  it('TEST-COMPOSE-04 pins every external image by tag and digest (no latest)', () => {
    const sources = [
      readFileSync(join(root, 'compose.yaml'), 'utf8'),
      readFileSync(join(root, 'compose.prod.yaml'), 'utf8'),
      ...workflows.map((workflow) => workflow.text),
    ];
    const images = sources
      .flatMap((text) => [...text.matchAll(/^\s*image:\s*(\S+)/gm)].map((match) => match[1] ?? ''))
      // Images built from this repository are tagged locally, not pulled.
      .filter((image) => !image.startsWith('nalara-'));
    expect(images.length).toBeGreaterThan(2);
    for (const image of images) expect(image).toMatch(/:[\w.-]+@sha256:[0-9a-f]{64}$/);
    // One PostgreSQL version everywhere: dev, production and CI.
    const postgres = images.filter((image) => image.startsWith('postgres:'));
    expect(postgres.length).toBeGreaterThanOrEqual(3);
    expect(new Set(postgres).size).toBe(1);
    // The restore drill and its test start their own PostgreSQL: same version as everywhere else.
    for (const file of ['infra/scripts/restore.sh', 'tests/smoke/backup.smoke.mjs']) {
      const pins = [
        ...readFileSync(join(root, file), 'utf8').matchAll(/postgres:[\w.-]+@sha256:[0-9a-f]{64}/g),
      ].map((match) => match[0]);
      expect(pins.length, file).toBeGreaterThan(0);
      expect(new Set([...postgres, ...pins]).size, file).toBe(1);
    }

    const dockerfiles = ['apps/api/Dockerfile', 'apps/web/Dockerfile'].map((file) =>
      readFileSync(join(root, file), 'utf8'),
    );
    for (const text of dockerfiles) {
      expect(text).toMatch(/^ARG NODE_IMAGE=node:[\w.-]+@sha256:[0-9a-f]{64}$/m);
      for (const match of text.matchAll(/^FROM\s+(\S+)/gm)) {
        expect(match[1]).toMatch(/^(\$\{NODE_IMAGE\}|[a-z-]+)$/); // base image or an earlier stage
      }
      expect(text).not.toMatch(/:latest\b/);
    }
    const nodeImages = new Set(
      dockerfiles.map((text) => /^ARG NODE_IMAGE=(\S+)$/m.exec(text)?.[1]),
    );
    expect(nodeImages.size).toBe(1);
  });

  it('keeps the production topology closed and hardened (TEST-COMPOSE-02/06 static)', () => {
    const prod = readFileSync(join(root, 'compose.prod.yaml'), 'utf8');
    // Only the edge proxy publishes ports (P0-013): exactly one ports: block, inside caddy.
    const services = prod.split(/^ {2}(?=[a-z-]+:\s*$)/m);
    const withPorts = services.filter((block) => /^\s{4}ports:/m.test(block));
    expect(withPorts.map((block) => block.split(':')[0])).toEqual(['caddy']);
    // Exactly Caddy and the web server may forward a client IP (R-12); both have fixed addresses
    // outside the dynamic range.
    expect(prod).toMatch(/TRUSTED_PROXIES: 172\.31\.250\.10,172\.31\.250\.11\n/);
    expect(prod).toMatch(/ipv4_address: 172\.31\.250\.10/);
    expect(prod).toMatch(/ipv4_address: 172\.31\.250\.11/);
    expect(prod).toMatch(/ip_range: 172\.31\.250\.128\/25/);
    expect(prod).toMatch(/backend:\s*\n\s*internal: true/);
    expect(prod).toMatch(/read_only: true/);
    expect(prod).toMatch(/cap_drop: \[ALL\]/);
    expect(prod).toMatch(/no-new-privileges:true/);
    expect(prod).toMatch(/restart: unless-stopped/);
    // TEST-OPS-06 (static): every service inherits bounded json-file logs.
    // db, migrate, api, worker, agent, web, caddy
    expect(prod.match(/^ {4}<<: \*hardened$/gm)?.length).toBe(7);
    // Only the worker and the agent runner join the egress network (P2-02, P3-05).
    expect(prod.match(/networks: \[[a-z, ]*egress[a-z, ]*\]/g)?.length).toBe(2);
    expect(services.find((block) => block.startsWith('worker:'))).toMatch(
      /networks: \[backend, egress\]/,
    );
    // The agent runner: no database network, no database URL, opt-in profile (ADR-020).
    const agent = services.find((block) => block.startsWith('agent:')) ?? '';
    expect(agent).toMatch(/networks: \[agent, egress\]/);
    expect(agent).toMatch(/profiles: \[agent\]/);
    expect(agent).not.toMatch(/DATABASE_URL|DB_[A-Z]+_PASSWORD|backend/);
    expect(prod).toMatch(/agent:\s*\n\s*internal: true/);
    expect(prod).toMatch(/driver: json-file\s*\n\s*options: \{ max-size: 10m, max-file: '3' \}/);
    expect(prod).not.toMatch(/docker\.sock|privileged:\s*true|network_mode:\s*host/);
    for (const dockerfile of ['apps/api/Dockerfile', 'apps/web/Dockerfile']) {
      const text = readFileSync(join(root, dockerfile), 'utf8');
      expect(text).toMatch(/^USER node$/m);
      expect(text).not.toMatch(/^(ARG|ENV)\s+\S*(SECRET|PASSWORD|TOKEN|KEY)\b/im);
    }
  });

  it('never uses pull_request_target (TEST-CI-10)', () => {
    for (const { text } of workflows) {
      expect(text).not.toMatch(/pull_request_target/);
    }
  });

  it('defaults the token to read-only contents', () => {
    for (const { text } of workflows) {
      expect(text).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
      expect(text).not.toMatch(/:\s*write\b/);
    }
  });

  it('does not persist checkout credentials', () => {
    for (const { file, text } of workflows) {
      const checkouts = text.match(/uses:\s*actions\/checkout@/g)?.length ?? 0;
      const disabled = text.match(/persist-credentials:\s*false/g)?.length ?? 0;
      expect(disabled, file).toBe(checkouts);
    }
  });

  it('installs with a frozen lockfile and runs every quality gate (TEST-CI-01..03, 05, 06)', () => {
    const ci = workflows.find((workflow) => workflow.file === 'ci.yml')?.text ?? '';
    for (const command of [
      'pnpm install --frozen-lockfile',
      'pnpm run format:check',
      'pnpm run lint',
      'pnpm run typecheck',
      'pnpm run test',
      'pnpm run build',
    ]) {
      expect(ci).toContain(command);
    }
  });

  it('runs a checksum-verified secret scan over full history (TEST-CI-07)', () => {
    const ci = workflows.find((workflow) => workflow.file === 'ci.yml')?.text ?? '';
    expect(ci).toMatch(/GITLEAKS_SHA256:\s*[0-9a-f]{64}/);
    expect(ci).toContain('sha256sum -c -');
    expect(ci).toMatch(/fetch-depth:\s*0/);
    expect(ci).toContain('--exit-code 1');
  });

  it('runs the browser, Compose and backup suites in CI (P0-014b)', () => {
    const ci = workflows.find((workflow) => workflow.file === 'ci.yml')?.text ?? '';
    for (const job of [
      'check',
      'supply-chain',
      'e2e',
      'compose-smoke',
      'backup-smoke',
      'secret-scan',
    ]) {
      expect(ci, job).toMatch(new RegExp(`^ {2}${job}:\\s*$`, 'm'));
    }
    for (const command of [
      'pnpm run test:e2e',
      'pnpm exec playwright install --with-deps chromium',
      'node tests/smoke/compose.smoke.mjs',
      'node tests/smoke/backup.smoke.mjs',
    ]) {
      expect(ci).toContain(command);
    }
    // No step may swallow a failure.
    expect(ci).not.toMatch(/continue-on-error:\s*true/);
    expect(ci).not.toMatch(/\|\|\s*true/);
  });

  it('audits dependencies and registry signatures (TEST-CI-08)', () => {
    const ci = workflows.find((workflow) => workflow.file === 'ci.yml')?.text ?? '';
    expect(ci).toContain('pnpm audit --prod --audit-level low');
    expect(ci).toContain('pnpm audit --audit-level high');
    expect(ci).toContain('pnpm audit signatures');
  });
});

describe('Dependabot', () => {
  const path = join(root, '.github', 'dependabot.yml');

  it('watches npm, GitHub Actions and Compose images with a 7-day cooldown', () => {
    expect(existsSync(path)).toBe(true);
    const text = stripYamlComments(readFileSync(path, 'utf8'));
    const blocks = text.split(/^ {2}- package-ecosystem:\s*/m).slice(1);
    const ecosystems = blocks.map((block) => block.split('\n')[0]?.trim());
    expect(ecosystems).toEqual(['npm', 'github-actions', 'docker-compose']);
    // @types/node follows the runtime major, never ahead of it.
    expect(blocks[0]).toMatch(
      /dependency-name: '@types\/node'\s*\n\s*update-types: \['version-update:semver-major'\]/,
    );
    for (const block of blocks) {
      const days = Number(/default-days:\s*(\d+)/.exec(block)?.[1]);
      expect(days).toBeGreaterThanOrEqual(7);
    }
  });
});
