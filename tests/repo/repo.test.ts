// Repository hygiene checks for Phase 0 (PRD §14.1 TEST-REPO-*).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PackageJson {
  name?: string;
  packageManager?: string;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function trackedFiles(): string[] {
  return git('ls-files', '-z')
    .split('\0')
    .filter((file) => file.length > 0);
}

function workspacePackageJsons(): string[] {
  return trackedFiles().filter(
    (file) => file === 'package.json' || /^(apps|packages)\/[^/]+\/package\.json$/.test(file),
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

describe('TEST-REPO-03 lockfile and package manager pinned', () => {
  it('commits pnpm-lock.yaml', () => {
    expect(trackedFiles()).toContain('pnpm-lock.yaml');
  });

  it('pins an exact pnpm version in packageManager', () => {
    const pkg = readJson('package.json') as PackageJson;
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it('uses exact versions for every dependency (no ranges)', () => {
    const ranged: string[] = [];
    for (const file of workspacePackageJsons()) {
      const pkg = readJson(file) as PackageJson;
      for (const [name, spec] of Object.entries({
        ...pkg.dependencies,
        ...pkg.devDependencies,
      })) {
        if (!/^\d+\.\d+\.\d+$/.test(spec)) ranged.push(`${file}: ${name}@${spec}`);
      }
    }
    expect(ranged).toEqual([]);
  });

  it('keeps the minimum release age supply-chain guard without exclusions', () => {
    const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toMatch(/^minimumReleaseAge:\s*(\d+)\s*$/m);
    const minutes = Number(/^minimumReleaseAge:\s*(\d+)/m.exec(workspace)?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(10080);
    expect(workspace).not.toMatch(/minimumReleaseAgeExclude/);
  });
});

describe('TEST-REPO-04 node version pinned', () => {
  const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8').trim();

  it('pins an exact Node version in .nvmrc', () => {
    expect(nvmrc).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps engines.node consistent with .nvmrc', () => {
    const pkg = readJson('package.json') as PackageJson;
    const major = nvmrc.split('.')[0];
    expect(pkg.engines?.['node']).toBe(`>=${nvmrc} <${String(Number(major) + 1)}`);
  });

  it('runs on the pinned Node major', () => {
    expect(process.versions.node.split('.')[0]).toBe(nvmrc.split('.')[0]);
  });
});

describe('TEST-REPO-05 no secrets tracked', () => {
  it('does not track environment or key files', () => {
    const offenders = trackedFiles().filter(
      (file) =>
        (/(^|\/)\.env(\..+)?$/.test(file) && !file.endsWith('.env.example')) ||
        /\.(pem|key|p12|age)$/.test(file),
    );
    expect(offenders).toEqual([]);
  });

  it('ignores .env files but not .env.example', () => {
    for (const file of ['.env', '.env.local', '.env.production', 'apps/api/.env']) {
      expect(() => git('check-ignore', '-q', '--no-index', file)).not.toThrow();
    }
    expect(() => git('check-ignore', '-q', '--no-index', '.env.example')).toThrow();
  });

  it('keeps secrets, docs and agent files out of Docker build context', () => {
    const lines = readFileSync(join(root, '.dockerignore'), 'utf8').split('\n');
    for (const entry of ['.env', '.env.*', '.git', '.claude', 'docs']) {
      expect(lines).toContain(entry);
    }
  });
});

describe('TEST-REPO-08 duplicate config avoided', () => {
  it('has exactly one ESLint and one Prettier config', () => {
    const files = trackedFiles();
    const eslint = files.filter((file) =>
      /(^|\/)(\.eslintrc(\..+)?|eslint\.config\.\w+)$/.test(file),
    );
    const prettier = files.filter((file) =>
      /(^|\/)(\.prettierrc(\..+)?|prettier\.config\.\w+)$/.test(file),
    );
    expect(eslint).toEqual(['eslint.config.mjs']);
    expect(prettier).toEqual(['.prettierrc.json']);
  });

  it('extends the shared tsconfig.base.json from every workspace tsconfig', () => {
    const tsconfigs = trackedFiles().filter((file) =>
      /^(apps|packages)\/[^/]+\/tsconfig\.json$/.test(file),
    );
    expect(tsconfigs.length).toBeGreaterThan(0);
    for (const file of tsconfigs) {
      expect((readJson(file) as { extends?: string }).extends).toBe('../../tsconfig.base.json');
    }
  });
});

describe('TEST-REPO-10 documentation paths resolve', () => {
  it('has no broken relative links in Markdown docs', () => {
    const markdown = ['README.md', ...walk('docs')].filter((file) => file.endsWith('.md'));
    const broken: string[] = [];
    for (const file of markdown) {
      const text = readFileSync(join(root, file), 'utf8');
      for (const match of text.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
        const target = match[1];
        if (target === undefined || /^[a-z]+:/i.test(target)) continue;
        const resolved = normalize(join(dirname(file), target));
        if (!existsSync(join(root, resolved))) broken.push(`${file} -> ${relative('.', target)}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
