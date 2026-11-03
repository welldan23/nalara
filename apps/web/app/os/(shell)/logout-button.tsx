'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  async function logout() {
    setBusy(true);
    setFailed(false);
    try {
      const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
      if (me.ok) {
        const { csrfToken } = (await me.json()) as { csrfToken: string };
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'x-csrf-token': csrfToken },
        });
      }
      router.replace('/os/login');
      router.refresh();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="secondary" onClick={() => void logout()} disabled={busy}>
        {busy ? 'Keluar…' : 'Keluar'}
      </button>
      {failed && (
        <p role="alert" className="error">
          Gagal keluar. Periksa koneksi lalu coba lagi.
        </p>
      )}
    </div>
  );
}
