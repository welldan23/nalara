// Brand tokens ("Tiga lapis" redesign; DesainPakeAI color-system + typography guides). Single
// source for CSS variables and the contrast tests. Roles come from the beringin logo: the crown
// (leaf), the trunk (ink) and the roots (soil). `rule` is decoration only and never text.

export const colors = {
  /** Page background: cool paper, not cream. */
  paper: '#F6F7F5',
  /** Raised surfaces (inputs, panels) and text on dark fills. */
  surface: '#FFFFFF',
  ink: '#18211E',
  inkMuted: '#4B5652',
  /** The one accent: links, primary actions, verification. */
  leaf: '#245640',
  /** Dark chrome (workspace navigation), hover on leaf fills. */
  leafDeep: '#15291F',
  /** The roots band under every article: sources. */
  soil: '#2A221C',
  soilInk: '#EFE8DD',
  soilMuted: '#C4B9AA',
  /** Hairlines and borders only (fails as text by design). */
  rule: '#D3D9D5',
  danger: '#9A2A1E',
} as const;

export type ColorName = keyof typeof colors;

/** Every text colour / background pair the UI uses; each must reach WCAG AA (4.5:1). */
export const TEXT_PAIRS: readonly (readonly [ColorName, ColorName])[] = [
  ['ink', 'paper'],
  ['inkMuted', 'paper'],
  ['leaf', 'paper'],
  ['danger', 'paper'],
  ['ink', 'surface'],
  ['inkMuted', 'surface'],
  ['leaf', 'surface'],
  ['surface', 'leaf'],
  ['surface', 'leafDeep'],
  ['soilMuted', 'leafDeep'],
  ['surface', 'danger'],
  ['soilInk', 'soil'],
  ['soilMuted', 'soil'],
];

export const fonts = {
  // Self-hosted OFL faces (@fontsource-variable, pinned), served from our origin under the CSP.
  // Display and interface: Plus Jakarta Sans, drawn for Jakarta's city identity.
  sans: "'Plus Jakarta Sans Variable', system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Arial, sans-serif",
  // Long reading: Literata, designed for screen reading.
  reading: "'Literata Variable', 'Iowan Old Style', Georgia, serif",
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
  return `:root{${vars.join('')}--font-sans:${fonts.sans};--font-reading:${fonts.reading};}`;
}
