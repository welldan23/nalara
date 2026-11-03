// Brand tokens (PRD B §10) — single source for CSS variables and contrast tests.
// Contrast (WCAG 2.x): brass and sage FAIL on ivory (2.0 / 1.8) and may only be used as text
// on forest, or as non-text decoration. TEXT_PAIRS lists the only text/background pairs allowed.

export const colors = {
  forest: '#172823',
  ivory: '#F5F0E6',
  ink: '#252A29',
  inkMuted: '#4F5754',
  brass: '#C2A77A',
  sage: '#A9B9AC',
  danger: '#8A1F17',
} as const;

export type ColorName = keyof typeof colors;

/** Every text colour / background pair the UI uses; each must reach WCAG AA (4.5:1). */
export const TEXT_PAIRS: readonly (readonly [ColorName, ColorName])[] = [
  ['ink', 'ivory'],
  ['inkMuted', 'ivory'],
  ['forest', 'ivory'],
  ['danger', 'ivory'],
  ['ivory', 'forest'],
  ['brass', 'forest'],
  ['sage', 'forest'],
];

export const fonts = {
  // System stacks only: no unlicensed font files are bundled (PRD B §10).
  serif: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif",
} as const;

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  );
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** CSS custom properties generated from the tokens above (no duplicated hex values). */
export function tokenCss(): string {
  const kebab = (name: string) => name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
  const vars = Object.entries(colors).map(([name, value]) => `--color-${kebab(name)}:${value};`);
  return `:root{${vars.join('')}--font-serif:${fonts.serif};--font-sans:${fonts.sans};}`;
}
