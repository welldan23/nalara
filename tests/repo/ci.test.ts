// Guards for GitHub Actions workflow hardening (ADR-008, PRD §14 TEST-CI-*).
import { readFileSync, readdirSync } from 'node:fs';
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
    expect(new Set(images).size).toBe(1);

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
    expect(prod).not.toMatch(/^\s*ports:/m); // only the reverse proxy (P0-013) may publish ports
    expect(prod).toMatch(/backend:\s*\n\s*internal: true/);
    expect(prod).toMatch(/read_only: true/);
    expect(prod).toMatch(/cap_drop: \[ALL\]/);
    expect(prod).toMatch(/no-new-privileges:true/);
    expect(prod).toMatch(/restart: unless-stopped/);
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
});
