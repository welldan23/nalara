// Brand pieces for the "Berkas perkara" design: the beringin logo's three layers as a small mark,
// the verification stamp, and the short account of how NALARA works a story.
import type { ReactNode } from 'react';

/** The logo's three slanted layers (crown, trunk, roots) as a small one-colour vector mark. */
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

/** Rana, the NALARA owl (founder's mascot art), in the poses of the brand sheet. */
const POSES = {
  rana: { width: 520, height: 760 },
  membaca: { width: 215, height: 177 },
  memeriksa: { width: 183, height: 177 },
  menelusuri: { width: 208, height: 177 },
  bertanya: { width: 200, height: 204 },
  menjelaskan: { width: 190, height: 211 },
  beristirahat: { width: 220, height: 176 },
} as const;

export type Pose = keyof typeof POSES;

/**
 * Rana in one pose. Decorative by default (empty alt): every place she appears already says in
 * words what she illustrates. Pass `alt` only where the picture itself is the content.
 */
export function Rana({
  pose,
  className,
  alt = '',
  priority = false,
}: {
  readonly pose: Pose;
  readonly className?: string;
  readonly alt?: string;
  readonly priority?: boolean;
}): ReactNode {
  const size = POSES[pose];
  return (
    // Static art from /public; next/image would need sharp (ADR-001).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={['rana', className].filter(Boolean).join(' ')}
      src={`/maskot/${pose}.webp`}
      width={size.width}
      height={size.height}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}

const STEPS = [
  {
    name: 'Telusuri',
    pose: 'menelusuri',
    text: 'Setiap klaim kami kejar sampai sumber aslinya: rilis resmi, dokumen, atau data resmi. Bukan dari kata orang.',
  },
  {
    name: 'Periksa',
    pose: 'memeriksa',
    text: 'Angka dicocokkan dengan satuan dan periodenya. Kalau ada yang janggal, kami tanya dulu, belum ditulis.',
  },
  {
    name: 'Jelaskan',
    pose: 'menjelaskan',
    text: 'Kesimpulannya ditulis dengan bahasa sehari-hari, dan barang buktinya ditaruh di bawah. Silakan cek sendiri.',
  },
] as const;

/** How NALARA works a story, in order: an actual sequence, so it is numbered. */
export function CaraMenelusuri(): ReactNode {
  return (
    <section className="method-steps" aria-labelledby="cara-menelusuri">
      <h2 id="cara-menelusuri" className="method-steps-title">
        Cara kami menelusuri
      </h2>
      <ol>
        {STEPS.map((step) => (
          <li key={step.name}>
            <Rana pose={step.pose} className="method-steps-art" />
            <h3>{step.name}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const STAMP_TEXT: Readonly<Record<string, string>> = {
  TERVERIFIKASI: 'Terverifikasi',
  SEBAGIAN: 'Sebagian terverifikasi',
  BELUM_TERVERIFIKASI: 'Tanpa sumber terverifikasi',
};

/** The rubber stamp on a case file: the verification level, as decoration with a text twin. */
export function Stamp({ level }: { readonly level: string }): ReactNode {
  const text = STAMP_TEXT[level];
  if (text === undefined) return null;
  return <span className={`stamp stamp-${level}`}>{text}</span>;
}

/** "BPS", "BPS dan BI", "BPS, BI, dan OJK". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0] ?? ''} dan ${names[1] ?? ''}`;
  return `${names.slice(0, -1).join(', ')}, dan ${names.at(-1) ?? ''}`;
}
