// Brand tokens ("Berkas perkara" design; DesainPakeAI color-system + typography guides). Single
// source for CSS variables and the contrast tests. Every article is a case file NALARA has looked
// into: fog-grey desk, case sheets, manila folders, an oxblood stamp, and sources as evidence.
// `rule` is decoration only and never text.

export const colors = {
  /** Page background: cool London fog, deliberately not cream. */
  paper: '#E9EBE7',
  /** The case sheet: reading surfaces, inputs, panels; also text on dark fills. */
  surface: '#FBFBF9',
  /** Iron-gall ink. */
  ink: '#1A1C22',
  inkMuted: '#474A52',
  /** The one accent: links, the verification stamp, primary actions. */
  accent: '#7B1E22',
  /** Night: the workspace navigation and the footer. */
  night: '#17191F',
  nightInk: '#EDE6D3',
  nightMuted: '#BDB6A4',
  /** Manila folder tabs and evidence tags (ink text on top). */
  manila: '#DCC995',
  /** Hairlines and borders only (fails as text by design). */
  rule: '#C6CAC4',
  danger: '#A12A1C',
} as const;

export type ColorName = keyof typeof colors;

/** Every text colour / background pair the UI uses; each must reach WCAG AA (4.5:1). */
export const TEXT_PAIRS: readonly (readonly [ColorName, ColorName])[] = [
  ['ink', 'paper'],
  ['inkMuted', 'paper'],
  ['accent', 'paper'],
  ['danger', 'paper'],
  ['ink', 'surface'],
  ['inkMuted', 'surface'],
  ['accent', 'surface'],
  ['danger', 'surface'],
  ['surface', 'accent'],
  ['surface', 'night'],
  ['nightInk', 'night'],
  ['nightMuted', 'night'],
  ['surface', 'danger'],
  ['ink', 'manila'],
  ['inkMuted', 'manila'],
  ['accent', 'manila'],
];

export const fonts = {
  // Self-hosted OFL faces (@fontsource, pinned), served from our origin under the CSP.
  // Interface and the workspace: Plus Jakarta Sans, drawn for Jakarta's city identity.
  sans: "'Plus Jakarta Sans Variable', system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Arial, sans-serif",
  // Headlines: Libre Caslon Display, the type of 19th-century printing. Large sizes only.
  display: "'Libre Caslon Display', 'Iowan Old Style', Georgia, serif",
  // Long reading and small headings: Literata, designed for screen reading.
  reading: "'Literata Variable', 'Iowan Old Style', Georgia, serif",
  // Case-file labels only (evidence tags, file numbers, the stamp): a typewriter face.
  type: "'Courier Prime', 'Courier New', ui-monospace, monospace",
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
  const families = Object.entries(fonts).map(([name, value]) => `--font-${name}:${value};`);
  return `:root{${vars.join('')}${families.join('')}}`;
}
