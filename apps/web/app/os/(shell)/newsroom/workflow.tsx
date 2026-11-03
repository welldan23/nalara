'use client';
// Review → approve → publish panel (P1-03). Shows the publish gate as the API computes it and
// offers only the actions the current status allows; the API re-checks everything.
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { ArticleStatus } from '../../../../lib/api';
import { GATE_MESSAGES, RULE_MESSAGES } from '../../../../lib/editor-messages';

type Action = 'submit' | 'return' | 'approve' | 'publish' | 'archive';

async function csrfToken(): Promise<string> {
  const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
  if (!me.ok) throw new Error('session');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

export function WorkflowPanel(props: {
  readonly articleId: string;
  readonly status: ArticleStatus;
  readonly version: number;
  readonly gate: readonly string[];
}) {
  const router = useRouter();
  const ids = useId();
  const [note, setNote] = useState('');
  const [exception, setException] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const needsException = props.gate.includes('no_verified_source');

  async function run(action: Action) {
    setBusy(true);
    setErrors([]);
    try {
      const response = await fetch(
        `/api/v1/os/articles/${encodeURIComponent(props.articleId)}/${action}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
          body: JSON.stringify({
            expectedVersion: props.version,
            ...(action === 'return' ? { note } : {}),
            ...(action === 'approve' && exception.trim() !== ''
              ? { sourceException: exception }
              : {}),
          }),
        },
      );
      if (response.ok) {
        setNote('');
        setException('');
        router.refresh();
        return;
      }
      const body = (await response.json()) as {
        error?: { code: string; fields?: { path: string; rule: string }[] };
      };
      const code = body.error?.code;
      if (code === 'GATE_BLOCKED') {
        setErrors((body.error?.fields ?? []).map((f) => GATE_MESSAGES[f.rule] ?? f.rule));
      } else if (code === 'VERSION_CONFLICT') {
        setErrors(['Artikel berubah di tab lain. Muat ulang halaman.']);
      } else if (code === 'INVALID_TRANSITION') {
        setErrors(['Aksi ini tidak berlaku untuk status sekarang. Muat ulang halaman.']);
      } else if (code === 'VALIDATION_FAILED') {
        setErrors(
          (body.error?.fields ?? []).map((field) =>
            field.path === 'note'
              ? 'Tulis alasan pengembalian (minimal 5 karakter).'
              : field.path === 'sourceException'
                ? 'Alasan pengecualian minimal 20 karakter.'
                : (RULE_MESSAGES[field.rule] ?? field.rule),
          ),
        );
      } else {
        setErrors([`Gagal (${code ?? String(response.status)}).`]);
      }
    } catch {
      setErrors(['Gagal. Periksa koneksi lalu coba lagi.']);
    } finally {
      setBusy(false);
    }
  }

  const button = (action: Action, label: string, secondary = false) => (
    <button
      type="button"
      className={secondary ? 'secondary' : undefined}
      disabled={busy}
      onClick={() => void run(action)}
    >
      {label}
    </button>
  );

  return (
    <section className="workflow" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Review dan terbit</h2>
      {props.gate.length > 0 && props.status !== 'published' && props.status !== 'archived' && (
        <div className="gate" data-testid="gate">
          <p>Belum bisa disetujui atau diterbitkan:</p>
          <ul>
            {props.gate.map((rule) => (
              <li key={rule}>{GATE_MESSAGES[rule] ?? rule}</li>
            ))}
          </ul>
        </div>
      )}

      {props.status === 'draft' && (
        <div className="workflow-actions">
          {button('submit', 'Ajukan untuk review')}
          {button('archive', 'Arsipkan', true)}
        </div>
      )}

      {props.status === 'in_review' && (
        <>
          {needsException && (
            <>
              <label htmlFor={`${ids}-exception`}>
                Alasan terbit tanpa sumber terverifikasi (opsional, tampil ke pembaca)
              </label>
              <textarea
                id={`${ids}-exception`}
                value={exception}
                onChange={(event) => {
                  setException(event.target.value);
                }}
                maxLength={500}
                rows={2}
              />
            </>
          )}
          <div className="workflow-actions">{button('approve', 'Setujui revisi ini')}</div>
          <label htmlFor={`${ids}-note`}>Alasan dikembalikan</label>
          <input
            id={`${ids}-note`}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            maxLength={500}
            placeholder="mis. Tambah sumber primer untuk angka inflasi"
          />
          <div className="workflow-actions">{button('return', 'Kembalikan ke draft', true)}</div>
        </>
      )}

      {props.status === 'approved' && (
        <div className="workflow-actions">{button('publish', 'Terbitkan')}</div>
      )}

      {props.status === 'published' && (
        <div className="workflow-actions">
          {button('archive', 'Arsipkan (tarik dari publik)', true)}
        </div>
      )}

      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
