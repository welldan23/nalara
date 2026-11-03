'use client';

// Error boundary (TEST-WEB-10): never shows the error message or stack to the visitor.
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <h1>Ada gangguan</h1>
      <p>Halaman ini gagal dimuat. Coba lagi beberapa saat lagi.</p>
      <button type="button" onClick={reset}>
        Coba lagi
      </button>
    </>
  );
}
