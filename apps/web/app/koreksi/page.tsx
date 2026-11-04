// Public corrections page (P1-07, PRD v4 §7): every substantial correction, newest first, linked
// to its article. Minor corrections (typos) stay in the internal history only.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate } from '../../components/public';
import { publicCorrections } from '../../lib/public-api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Koreksi',
  description: 'Daftar koreksi substansial atas artikel NALARA.',
};

export default async function CorrectionsPage() {
  const corrections = await publicCorrections();
  if (corrections === null) notFound();
  return (
    <article className="reading">
      <h1>Koreksi</h1>
      <p className="dek">
        Kalau kami keliru soal fakta, angka, atau kutipan, kami memperbaikinya dan mencatatnya di
        sini. Versi lama tetap tersimpan di arsip redaksi.
      </p>
      {corrections.length === 0 ? (
        <p className="muted">Belum ada koreksi.</p>
      ) : (
        <ol className="correction-list">
          {corrections.map((correction, index) => (
            <li key={`${correction.article.slug}-${correction.visibleAt}-${String(index)}`}>
              <Link href={`/artikel/${correction.article.slug}`}>{correction.article.title}</Link>
              <p>{correction.description}</p>
              <p className="muted">
                <time dateTime={correction.visibleAt}>{formatDate(correction.visibleAt)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
