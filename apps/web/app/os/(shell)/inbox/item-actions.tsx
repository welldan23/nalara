'use client';
// Mark an inbox item or start a draft from it (P2-06). The API re-checks everything.
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

async function csrfToken(): Promise<string> {
  const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
  if (!me.ok) throw new Error('session');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

async function send(method: 'PATCH' | 'POST', url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
    body: JSON.stringify(body),
  });
}

export function ItemActions(props: {
  readonly id: string;
  readonly status: string;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
}) {
  const router = useRouter();
  const ids = useId();
  const [categoryId, setCategoryId] = useState(props.categories[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = `/api/v1/os/inbox/${encodeURIComponent(props.id)}`;

  async function mark(status: 'seen' | 'dismissed' | 'new') {
    setBusy(true);
    setError('');
    try {
      const response = await send('PATCH', url, { status });
      if (!response.ok) throw new Error(String(response.status));
      router.refresh();
    } catch {
      setError('Gagal menyimpan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  async function draft() {
    setBusy(true);
    setError('');
    try {
      const response = await send('POST', `${url}/draft`, { categoryId });
      const body = (await response.json()) as { articleId?: string };
      if (response.status !== 201 || body.articleId === undefined) {
        throw new Error(String(response.status));
      }
      router.push(`/os/newsroom/${body.articleId}`);
    } catch {
      setError('Draft gagal dibuat. Coba lagi.');
      setBusy(false);
    }
  }

  return (
    <div className="inbox-actions">
      {props.status === 'new' && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void mark('seen')}
        >
          Tandai dilihat
        </button>
      )}
      {props.status !== 'dismissed' && props.status !== 'used' && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void mark('dismissed')}
        >
          Abaikan
        </button>
      )}
      {props.status === 'dismissed' && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void mark('new')}
        >
          Kembalikan ke baru
        </button>
      )}
      {props.status !== 'used' && (
        <>
          <label htmlFor={`${ids}-topic`} className="visually-hidden">
            Topik draft
          </label>
          <select
            id={`${ids}-topic`}
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
            }}
            disabled={busy}
          >
            {props.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={() => void draft()}>
            Buat draft
          </button>
        </>
      )}
      {error !== '' && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
