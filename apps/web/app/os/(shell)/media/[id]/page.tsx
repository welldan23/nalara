// One library image (P1-09): preview, the block to paste into an article, and its description.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { previewImageSrc } from '../../../../../components/article-body';
import { ApiUnauthorized, getMedia } from '../../../../../lib/api';
import { imageSnippet } from '../../../../../lib/media-messages';
import { MediaForm } from '../media-form';

export const metadata: Metadata = { title: 'Media' };
export const dynamic = 'force-dynamic';

export default async function MediaItemPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let media;
  try {
    media = await getMedia(id, (await headers()).get('cookie'));
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  if (media === null) notFound();
  const kb = Math.max(1, Math.round(media.byteSize / 1024));
  return (
    <>
      <p>
        <Link href="/os/media">← Semua media</Link>
      </p>
      <h1>Gambar</h1>
      <figure className="article-image media-preview">
        {/* eslint-disable-next-line @next/next/no-img-element -- stripped bytes from the API; no sharp (ADR-001) */}
        <img
          src={previewImageSrc(media.id)}
          alt={media.altText}
          width={media.width}
          height={media.height}
        />
        <figcaption className="muted">
          {media.mime.replace('image/', '').toUpperCase()} · {media.width} × {media.height} px ·{' '}
          {kb} KB · versi {media.version}
        </figcaption>
      </figure>
      <h2>Pasang di artikel</h2>
      <p className="muted">Salin blok ini ke isi artikel, di tempat gambar ingin tampil:</p>
      <pre className="snippet" data-testid="snippet">
        {imageSnippet(media.id)}
      </pre>
      <h2>Keterangan dan lisensi</h2>
      <MediaForm key={media.id} media={media} />
    </>
  );
}
