// Kartu NALARA: an Instagram carousel and caption for one published article. The PNGs are drawn
// by the API from the published version only; the founder downloads them and posts by hand.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiUnauthorized, getCardDeck } from '../../../../../lib/api';
import { CopyCaption } from './copy-caption';

export const metadata: Metadata = { title: 'Kartu IG' };
export const dynamic = 'force-dynamic';

const KIND_LABELS: Readonly<Record<string, string>> = {
  cover: 'Sampul',
  stat: 'Angka',
  point: 'Poin',
  quote: 'Kutipan',
  evidence: 'Barang bukti',
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export default async function CardsPage({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  let deck;
  try {
    deck = await getCardDeck((await headers()).get('cookie'), slug);
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  if (deck === null) notFound();
  const src = (number: number) =>
    `/api/v1/os/cards/${encodeURIComponent(deck.slug)}/${String(number)}.png`;

  return (
    <>
      <p>
        <Link href="/os/newsroom">← Newsroom</Link>
      </p>
      <h1>Kartu IG</h1>
      <p className="muted">
        Carousel untuk <strong>{deck.title}</strong>, dari versi yang sedang terbit. Unduh tiap
        slide, lalu unggah ke Instagram sesuai urutan.
      </p>
      <ol className="card-grid" data-testid="card-slides">
        {deck.slides.map((slide) => (
          <li key={slide.number}>
            {/* Generated PNG from the API; next/image would need sharp (ADR-001). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src(slide.number)}
              width={1080}
              height={1350}
              alt={`Slide ${String(slide.number)}: ${KIND_LABELS[slide.kind] ?? slide.kind}`}
              loading="lazy"
            />
            <p>
              {String(slide.number)}. {KIND_LABELS[slide.kind] ?? slide.kind}{' '}
              <a href={src(slide.number)} download>
                Unduh
              </a>
            </p>
          </li>
        ))}
      </ol>
      <h2>Caption</h2>
      <CopyCaption caption={deck.caption} />
    </>
  );
}
