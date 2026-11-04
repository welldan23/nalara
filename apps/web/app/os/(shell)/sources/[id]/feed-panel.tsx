'use client';
// Feed state of one source and a "check now" button (P2-03b). The check runs in the worker; the
// page refreshes a few times to pick up the result.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

async function csrfToken(): Promise<string> {
  const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
  if (!me.ok) throw new Error('session');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

export function CheckFeedButton({ sourceId }: { readonly sourceId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(
        `/api/v1/os/sources/${encodeURIComponent(sourceId)}/check-feed`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
          body: '{}',
        },
      );
      const body = (await response.json()) as {
        queued?: boolean;
        error?: { fields?: { path: string; rule: string }[] };
      };
      if (response.status === 202) {
        setMessage(
          body.queued === true
            ? 'Pengecekan dijadwalkan. Hasilnya muncul di riwayat di bawah dalam beberapa detik.'
            : 'Pengecekan sebelumnya masih menunggu giliran.',
        );
        for (const delay of [3_000, 8_000, 15_000]) {
          setTimeout(() => {
            router.refresh();
          }, delay);
        }
      } else if (body.error?.fields?.some((field) => field.rule === 'not_verified')) {
        setMessage('Feed hanya dicek untuk sumber berstatus Terverifikasi.');
      } else if (body.error?.fields?.some((field) => field.path === 'feedUrl')) {
        setMessage('Isi dan simpan URL feed dulu.');
      } else {
        setMessage(`Gagal (${String(response.status)}).`);
      }
    } catch {
      setMessage('Gagal. Periksa koneksi lalu coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workflow-actions">
      <button type="button" className="secondary" disabled={busy} onClick={() => void check()}>
        Cek feed sekarang
      </button>
      <p aria-live="polite" className="muted">
        {message}
      </p>
    </div>
  );
}
