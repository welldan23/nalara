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

  it('pins every container image by digest and keeps it identical to compose.yaml', () => {
    const compose = readFileSync(join(root, 'compose.yaml'), 'utf8');
    const images = [compose, ...workflows.map((workflow) => workflow.text)].flatMap((text) =>
      [...text.matchAll(/^\s*image:\s*(\S+)/gm)].map((match) => match[1] ?? ''),
    );
    expect(images.length).toBeGreaterThan(1);
    for (const image of images) expect(image).toMatch(/:[\w.-]+@sha256:[0-9a-f]{64}$/);
    expect(new Set(images).size).toBe(1);
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
