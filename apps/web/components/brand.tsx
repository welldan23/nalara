// Brand pieces for the "Tiga lapis" design: the beringin logo reduced to its three slanted layers
// (crown, trunk, roots), and the short explanation of how NALARA writes that the layers stand for.
import type { ReactNode } from 'react';

/** The logo's three layers as a small vector mark: crown (leaf), trunk (ink), roots (soil). */
export function BrandMark({ size = 32 }: { readonly size?: number }): ReactNode {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={Math.round((size * 30) / 36)}
      viewBox="0 0 36 30"
      aria-hidden="true"
      focusable="false"
    >
      <polygon className="brand-mark-crown" points="7,0 31,0 25,8 1,8" />
      <polygon className="brand-mark-trunk" points="11,11 35,11 29,19 5,19" />
      <polygon className="brand-mark-roots" points="9,22 33,22 27,30 3,30" />
    </svg>
  );
}

const LAYERS = [
  {
    name: 'Tajuk',
    text: 'Apa yang terjadi, dalam beberapa kalimat. Yang kamu lihat duluan.',
  },
  {
    name: 'Batang',
    text: 'Kenapa penting, apa konteksnya, dan angka yang bisa dicek: lengkap dengan satuan dan periodenya.',
  },
  {
    name: 'Akar',
    text: 'Sumber resmi dan data yang kami buka sendiri. Ada di bawah setiap tulisan, bisa kamu telusuri.',
  },
] as const;

/** How every NALARA piece is built, drawn as the logo's stacked layers. */
export function TigaLapis({ headingLevel = 2 }: { readonly headingLevel?: 2 | 3 }): ReactNode {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="tiga-lapis" aria-labelledby="tiga-lapis-judul">
      <Heading id="tiga-lapis-judul" className="tiga-lapis-title">
        Setiap tulisan punya tiga lapis
      </Heading>
      <dl className="tiga-lapis-layers">
        {LAYERS.map((layer) => (
          <div key={layer.name} className={`lapis lapis-${layer.name.toLowerCase()}`}>
            <dt>{layer.name}</dt>
            <dd>{layer.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** "BPS", "BPS dan BI", "BPS, BI, dan OJK". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0] ?? ''} dan ${names[1] ?? ''}`;
  return `${names.slice(0, -1).join(', ')}, dan ${names.at(-1) ?? ''}`;
}
