import Link from 'next/link';
import { Rana } from '../components/brand';

export default function NotFound() {
  return (
    <section className="empty-state">
      <Rana pose="bertanya" className="empty-state-art" />
      <div>
        <h1>Halaman tidak ditemukan</h1>
        <p>
          Rana sudah mencari, tapi berkas ini tidak ada. Mungkin alamatnya salah ketik, atau
          halamannya belum terbit.
        </p>
        <p>
          <Link href="/">Kembali ke beranda</Link>
        </p>
      </div>
    </section>
  );
}
