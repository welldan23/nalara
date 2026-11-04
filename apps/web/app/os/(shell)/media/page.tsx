// Media library (P1-09): every uploaded image with its licence state, and the upload form.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { previewImageSrc } from '../../../../components/article-body';
import { ApiUnauthorized, listMedia } from '../../../../lib/api';
import { USAGE_BASIS_LABELS } from '../../../../lib/media-messages';
import { MediaForm } from './media-form';

export const metadata: Metadata = { title: 'Media' };
export const dynamic = 'force-dynamic';

export default async function MediaPage() {
  let media;
  try {
    media = await listMedia((await headers()).get('cookie'));
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  return (
    <>
      <h1>Media</h1>
      <p className="muted">
        Gambar untuk artikel. Teks alternatif wajib sejak unggah; lisensi dan atribusi wajib sebelum
        artikel bergambar bisa disetujui. Gambar tidak pernah dihapus.
      </p>
      <section aria-labelledby="unggah">
        <h2 id="unggah">Unggah gambar</h2>
        <MediaForm />
      </section>
      <section aria-labelledby="pustaka">
        <h2 id="pustaka">Pustaka</h2>
        {media.length === 0 ? (
          <p className="muted">Belum ada gambar.</p>
        ) : (
          <ul className="media-grid" data-testid="media">
            {media.map((item) => (
              <li key={item.id}>
                <Link href={`/os/media/${item.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- stripped bytes from the API; no sharp (ADR-001) */}
                  <img
                    src={previewImageSrc(item.id)}
                    alt={item.altText}
                    width={item.width}
                    height={item.height}
                    loading="lazy"
                  />
                </Link>
                <p className="muted">
                  {item.license !== null && item.attribution !== null ? (
                    <span className="status source-status-verified">Siap terbit</span>
                  ) : (
                    <span className="status source-status-paused">Lisensi belum lengkap</span>
                  )}{' '}
                  · {USAGE_BASIS_LABELS[item.usageBasis]?.split(' (')[0] ?? item.usageBasis}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
