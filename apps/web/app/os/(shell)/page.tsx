// Founder OS overview. Authentication is enforced by the shell layout and by the API.
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'OS' };

export default function OsPage() {
  return (
    <>
      <h1>Ringkasan</h1>
      <p>
        Mulai dari <Link href="/os/newsroom">Newsroom</Link>: tulis draft, lihat pratinjau, simpan
        revisi.
      </p>
      <p className="muted">Review dan publikasi menyusul di P1-03.</p>
    </>
  );
}
