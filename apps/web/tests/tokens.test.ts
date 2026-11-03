// TEST-WEB-08 contrast and TEST-WEB-09 no raw HTML, as fast unit checks that always run in CI.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEXT_PAIRS, colors, contrastRatio, tokenCss } from '../lib/tokens';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('TEST-WEB-08 colour contrast', () => {
  it.each(TEXT_PAIRS)('%s on %s reaches WCAG AA (4.5:1)', (foreground, background) => {
    expect(contrastRatio(colors[foreground], colors[background])).toBeGreaterThanOrEqual(4.5);
  });

  it('matches known reference ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio(colors.brass, colors.ivory)).toBeLessThan(4.5); // documented: not for text on ivory
  });

  it('emits every token as a CSS variable', () => {
    const css = tokenCss();
    for (const value of Object.values(colors)) expect(css).toContain(value);
    expect(css).toContain('--color-ink-muted:');
  });
});

describe('TEST-WEB-09 no raw HTML injection points', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === 'node_modules' || name === '.next') return [];
      return statSync(path).isDirectory() ? files(path) : [path];
    });

  it('never uses dangerouslySetInnerHTML or innerHTML in web sources', () => {
    const offenders = [...files(join(webRoot, 'app')), ...files(join(webRoot, 'lib'))]
      .filter((path) => /\.(tsx?|jsx?)$/.test(path))
      .filter((path) => /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
