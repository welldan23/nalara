'use client';
// Approve or reject an agent proposal (P3-01). The API re-checks everything and applies the
// proposal only against the version it was written for.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

async function csrfToken(): Promise<string> {
  const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
  if (!me.ok) throw new Error('session');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

export function DecisionButtons(props: { readonly id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/os/proposals/${encodeURIComponent(props.id)}/decision`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
          body: JSON.stringify({ decision }),
        },
      );
      if (response.status === 409) {
        setError('Usulan ini sudah diputuskan atau kedaluwarsa.');
      } else if (!response.ok) {
        throw new Error(String(response.status));
      }
      router.refresh();
    } catch {
      setError('Gagal menyimpan keputusan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inbox-actions">
      <button type="button" disabled={busy} onClick={() => void decide('approve')}>
        Setujui
      </button>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void decide('reject')}
      >
        Tolak
      </button>
      {error !== '' && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
