// About, method and verification labels (P1-06, PRD v4 §1, §7). Static text: no data from the API.
import type { Metadata } from 'next';
import Link from 'next/link';
import { Rana } from '../../components/brand';
import { pageAlternates, pageOpenGraph } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Tentang',
  description: 'Misi NALARA, cara kami menulis, dan arti label verifikasi.',
  alternates: pageAlternates('/tentang'),
  openGraph: pageOpenGraph({
    title: 'Tentang NALARA',
    description: 'Misi NALARA, cara kami menulis, dan arti label verifikasi.',
    path: '/tentang',
  }),
};

export default function AboutPage() {
  return (
    <article className="reading">
      <h1>Tentang NALARA</h1>
      <p className="dek">Biar semua paham.</p>
      <p>
        NALARA adalah media penjelas Indonesia: artikel yang jelas, berkonteks, dan setiap klaim
        pentingnya bersumber. Kami bukan agregator yang menyalin berita, dan tidak ada artikel yang
        terbit otomatis. Setiap tulisan ditinjau dan disetujui redaksi sebelum terbit.
      </p>

      <h2>Cara kami menulis</h2>
      <ul>
        <li>Fakta ditelusuri sampai ke sumber aslinya: rilis resmi, dokumen, atau data resmi.</li>
        <li>Setiap angka penting ditulis dengan satuan, periode, dan sumbernya.</li>
        <li>Analisis dan opini diberi label, terpisah dari laporan fakta.</li>
        <li>Kami tidak mengarang kutipan, angka, sumber, atau gambar.</li>
      </ul>

      <h2 id="verifikasi">Label verifikasi</h2>
      <dl className="labels">
        <dt>Terverifikasi</dt>
        <dd>
          Klaim utama dikonfirmasi oleh sumber primer, atau oleh setidaknya dua sumber independen
          yang sudah kami buka dan cocokkan.
        </dd>
        <dt>Sebagian terverifikasi</dt>
        <dd>Sudah dicek ke sumber, tetapi sebagian detail baru dikonfirmasi satu sumber.</dd>
        <dt>Tanpa sumber terverifikasi</dt>
        <dd>
          Jarang dan hanya dengan alasan redaksi yang ditulis langsung di artikel, misalnya tulisan
          opini tanpa klaim faktual.
        </dd>
      </dl>

      <h2 id="rana">Kenalan dengan Rana</h2>
      <figure className="rana-intro">
        <Rana
          pose="rana"
          alt="Rana, burung hantu berjubah dengan lambang NALARA, bertengger di atas tumpukan buku"
        />
        <figcaption>
          Rana adalah maskot NALARA: seekor burung hantu, simbol rasa ingin tahu, ketelitian, dan
          kebijaksanaan. Ia membaca, memeriksa, menelusuri, bertanya, lalu menjelaskan, sama seperti
          cara kami menulis.
        </figcaption>
      </figure>

      <h2>Koreksi</h2>
      <p>
        Kalau kami keliru, kami memperbaikinya secara terbuka dan riwayat perubahan tidak dihapus.
        Koreksi soal fakta, angka, atau kutipan ditandai di artikelnya dan tercantum di{' '}
        <Link href="/koreksi">halaman koreksi</Link> beserta tanggalnya.
      </p>
    </article>
  );
}
