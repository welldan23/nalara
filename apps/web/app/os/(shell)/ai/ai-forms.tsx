'use client';
// Kill switch, quotas and agent preferences (P3-02). The API re-checks everything; the kill switch
// always succeeds, whatever version this page loaded.
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { AiOverview } from '../../../../lib/api';

async function csrfToken(): Promise<string> {
  const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
  if (!me.ok) throw new Error('session');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

async function send(method: 'PUT' | 'POST', url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function run(action: () => Promise<Response>, done: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await action();
      if (response.status === 409) {
        setMessage('Pengaturan berubah di tempat lain. Muat ulang halaman.');
      } else if (!response.ok) {
        setMessage('Gagal menyimpan. Periksa isian lalu coba lagi.');
      } else {
        setMessage(done);
        router.refresh();
      }
    } catch {
      setMessage('Gagal menyimpan. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, run };
}

export function KillSwitch(props: { readonly settings: AiOverview['settings'] }) {
  const { busy, message, run } = useAction();
  const { settings } = props;
  return (
    <div className="inbox-actions">
      {settings.aiEnabled ? (
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => void run(() => send('POST', '/api/v1/os/ai/stop', {}), 'AI dimatikan.')}
        >
          Matikan AI sekarang
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(
              () =>
                send('PUT', '/api/v1/os/ai/settings', {
                  aiEnabled: true,
                  dailyDraftQuota: settings.dailyDraftQuota,
                  dailyProposalQuota: settings.dailyProposalQuota,
                  dailyTokenQuota: settings.dailyTokenQuota,
                  expectedVersion: settings.version,
                }),
              'AI dinyalakan.',
            )
          }
        >
          Nyalakan AI
        </button>
      )}
      {message !== '' && <p role="status">{message}</p>}
    </div>
  );
}

export function QuotaForm(props: { readonly settings: AiOverview['settings'] }) {
  const ids = useId();
  const { busy, message, run } = useAction();
  const [drafts, setDrafts] = useState(String(props.settings.dailyDraftQuota));
  const [proposals, setProposals] = useState(String(props.settings.dailyProposalQuota));
  const [tokens, setTokens] = useState(String(props.settings.dailyTokenQuota));
  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    max: number,
  ) => (
    <p>
      <label htmlFor={`${ids}-${id}`}>{label}</label>
      <input
        id={`${ids}-${id}`}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        onChange={(event) => {
          set(event.target.value);
        }}
      />
    </p>
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () =>
            send('PUT', '/api/v1/os/ai/settings', {
              aiEnabled: props.settings.aiEnabled,
              dailyDraftQuota: Number(drafts),
              dailyProposalQuota: Number(proposals),
              dailyTokenQuota: Number(tokens),
              expectedVersion: props.settings.version,
            }),
          'Kuota disimpan.',
        );
      }}
    >
      {field('drafts', 'Draft per hari', drafts, setDrafts, 50)}
      {field('proposals', 'Usulan per hari', proposals, setProposals, 500)}
      {field('tokens', 'Token AI per hari', tokens, setTokens, 10_000_000)}
      <button type="submit" disabled={busy}>
        Simpan kuota
      </button>
      {message !== '' && <p role="status">{message}</p>}
    </form>
  );
}

export function PreferencesForm(props: { readonly preferences: AiOverview['preferences'] }) {
  const ids = useId();
  const { busy, message, run } = useAction();
  const [topics, setTopics] = useState(props.preferences.topics.join(', '));
  const [notes, setNotes] = useState(props.preferences.notes);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () =>
            send('PUT', '/api/v1/os/ai/preferences', {
              topics: topics
                .split(',')
                .map((topic) => topic.trim())
                .filter((topic) => topic !== ''),
              notes,
              expectedVersion: props.preferences.version,
            }),
          'Preferensi disimpan.',
        );
      }}
    >
      <p>
        <label htmlFor={`${ids}-topics`}>Topik (pisahkan dengan koma)</label>
        <input
          id={`${ids}-topics`}
          value={topics}
          maxLength={900}
          onChange={(event) => {
            setTopics(event.target.value);
          }}
        />
      </p>
      <p>
        <label htmlFor={`${ids}-notes`}>Catatan untuk agent</label>
        <textarea
          id={`${ids}-notes`}
          rows={4}
          maxLength={2000}
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
      </p>
      <button type="submit" disabled={busy}>
        Simpan preferensi
      </button>
      {message !== '' && <p role="status">{message}</p>}
    </form>
  );
}
