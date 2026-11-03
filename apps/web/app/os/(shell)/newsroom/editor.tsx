'use client';
// Draft editor (P1-02). The browser only collects input and shows what the API answers: parsing,
// validation, versions and authorization all happen in the API (ADR-002, ADR-011).
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { ArticleBody } from '../../../../components/article-body';
import type { Block } from '../../../../components/article-body';
import {
  TYPE_LABELS,
  WARNING_MESSAGES,
  RULE_MESSAGES,
  describeField,
} from '../../../../lib/editor-messages';

interface Category {
  readonly id: string;
  readonly name: string;
}

export interface EditorValues {
  readonly title: string;
  readonly dek: string;
  readonly articleType: 'explainer' | 'analysis' | 'opinion';
  readonly categoryId: string;
  readonly methodNote: string;
  readonly bodySource: string;
}

interface Warning {
  readonly code: string;
  readonly detail?: string;
}

interface Preview {
  readonly blocks: Block[];
  readonly issues: { line: number; rule: string }[];
}

async function csrfToken(): Promise<string> {
  const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
  if (!me.ok) throw new Error('session');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

async function send(method: 'POST' | 'PATCH', url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
    body: JSON.stringify(body),
  });
}

function warningText(warning: Warning): string {
  const label = WARNING_MESSAGES[warning.code] ?? warning.code;
  return warning.detail === undefined ? label : `${label}: “${warning.detail}”`;
}

export function Editor(props: {
  readonly categories: readonly Category[];
  readonly initial: EditorValues;
  readonly articleId?: string;
  readonly version?: number;
  readonly editable?: boolean;
}) {
  const router = useRouter();
  const ids = useId();
  const [values, setValues] = useState<EditorValues>(props.initial);
  const [changeNote, setChangeNote] = useState('');
  const [version, setVersion] = useState(props.version ?? 0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const editable = props.editable ?? true;
  const isNew = props.articleId === undefined;

  const set =
    <K extends keyof EditorValues>(key: K) =>
    (value: EditorValues[K]) => {
      setValues((current) => ({ ...current, [key]: value }));
      setNotice('');
    };

  async function showPreview() {
    setBusy(true);
    setErrors([]);
    try {
      const response = await send('POST', '/api/v1/os/articles/preview', {
        title: values.title,
        dek: values.dek,
        bodySource: values.bodySource,
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as Preview & { warnings: Warning[] };
      setPreview({ blocks: body.blocks, issues: body.issues });
      setWarnings(body.warnings);
    } catch {
      setErrors(['Pratinjau gagal. Periksa koneksi lalu coba lagi.']);
    } finally {
      setBusy(false);
    }
  }

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    setNotice('');
    const payload = {
      title: values.title,
      dek: values.dek,
      articleType: values.articleType,
      categoryId: values.categoryId,
      methodNote: values.methodNote.trim() === '' ? null : values.methodNote,
      bodySource: values.bodySource,
    };
    try {
      const response = isNew
        ? await send('POST', '/api/v1/os/articles', payload)
        : await send('PATCH', `/api/v1/os/articles/${encodeURIComponent(props.articleId ?? '')}`, {
            ...payload,
            expectedVersion: version,
            changeNote: changeNote.trim() === '' ? 'Revisi' : changeNote,
          });
      const body = (await response.json()) as {
        articleId?: string;
        version?: number;
        warnings?: Warning[];
        error?: { code: string; fields?: { path: string; rule: string }[] };
      };
      if (response.ok) {
        setWarnings(body.warnings ?? []);
        if (isNew && body.articleId !== undefined) {
          router.push(`/os/newsroom/${body.articleId}`);
          return;
        }
        setVersion(body.version ?? version);
        setChangeNote('');
        setNotice(`Tersimpan sebagai versi ${String(body.version ?? version)}.`);
        router.refresh();
      } else if (body.error?.code === 'VERSION_CONFLICT') {
        setErrors([
          'Artikel ini sudah diubah di tab atau perangkat lain. Salin perubahanmu, muat ulang halaman, lalu simpan lagi.',
        ]);
      } else if (body.error?.code === 'VALIDATION_FAILED') {
        setErrors((body.error.fields ?? []).map((field) => describeField(field.path, field.rule)));
      } else if (response.status === 401) {
        setErrors(['Sesi berakhir. Masuk lagi, lalu simpan ulang.']);
      } else {
        setErrors([`Gagal menyimpan (${body.error?.code ?? String(response.status)}).`]);
      }
    } catch {
      setErrors(['Gagal menyimpan. Periksa koneksi lalu coba lagi.']);
    } finally {
      setBusy(false);
    }
  }

  const field = (name: string) => `${ids}-${name}`;

  return (
    <div className="editor">
      <form className="editor-form" onSubmit={(event) => void save(event)}>
        <fieldset disabled={!editable || busy}>
          <label htmlFor={field('title')}>Judul</label>
          <input
            id={field('title')}
            value={values.title}
            onChange={(event) => {
              set('title')(event.target.value);
            }}
            maxLength={200}
            required
          />

          <label htmlFor={field('dek')}>Ringkasan (dek)</label>
          <textarea
            id={field('dek')}
            value={values.dek}
            onChange={(event) => {
              set('dek')(event.target.value);
            }}
            maxLength={400}
            rows={2}
          />

          <div className="editor-row">
            <div>
              <label htmlFor={field('type')}>Jenis</label>
              <select
                id={field('type')}
                value={values.articleType}
                onChange={(event) => {
                  set('articleType')(event.target.value as EditorValues['articleType']);
                }}
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={field('topic')}>Topik</label>
              <select
                id={field('topic')}
                value={values.categoryId}
                onChange={(event) => {
                  set('categoryId')(event.target.value);
                }}
              >
                {props.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label htmlFor={field('body')}>Isi</label>
          <p className="hint" id={field('body-hint')}>
            ## subjudul · **tebal** · *miring* · [teks](https://…) · - daftar · &gt; kutipan lalu
            &gt; — Nama, jabatan
          </p>
          <textarea
            id={field('body')}
            className="editor-body"
            aria-describedby={field('body-hint')}
            value={values.bodySource}
            onChange={(event) => {
              set('bodySource')(event.target.value);
            }}
            rows={20}
            spellCheck
          />

          <label htmlFor={field('method')}>Catatan metode (opsional)</label>
          <textarea
            id={field('method')}
            value={values.methodNote}
            onChange={(event) => {
              set('methodNote')(event.target.value);
            }}
            maxLength={2000}
            rows={2}
          />

          {!isNew && (
            <>
              <label htmlFor={field('note')}>Catatan perubahan</label>
              <input
                id={field('note')}
                value={changeNote}
                onChange={(event) => {
                  setChangeNote(event.target.value);
                }}
                maxLength={300}
                placeholder="mis. Perbaiki angka inflasi"
              />
            </>
          )}

          <div className="editor-actions">
            <button type="button" className="secondary" onClick={() => void showPreview()}>
              Pratinjau
            </button>
            <button type="submit">
              {isNew ? 'Simpan draft' : `Simpan versi ${String(version + 1)}`}
            </button>
          </div>
        </fieldset>
        {!editable && (
          <p className="muted">
            Artikel ini tidak dalam status draft, jadi isinya tidak bisa diubah.
          </p>
        )}
        <div aria-live="polite">
          {notice !== '' && <p className="notice">{notice}</p>}
          {errors.length > 0 && (
            <ul className="error" role="alert">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <div className="warnings">
              <p>Saran gaya (tidak menghalangi penyimpanan):</p>
              <ul>
                {warnings.map((warning) => (
                  <li key={`${warning.code}-${warning.detail ?? ''}`}>{warningText(warning)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </form>

      <section className="editor-preview" aria-label="Pratinjau">
        <h2>Pratinjau</h2>
        {preview === null ? (
          <p className="muted">Tekan “Pratinjau” untuk melihat hasil seperti yang akan disimpan.</p>
        ) : (
          <>
            {preview.issues.length > 0 && (
              <ul className="error">
                {preview.issues.map((issue) => (
                  <li key={`${String(issue.line)}-${issue.rule}`}>
                    Baris {issue.line}: {RULE_MESSAGES[issue.rule] ?? issue.rule}
                  </li>
                ))}
              </ul>
            )}
            <article className="preview-article">
              <h1>{values.title === '' ? 'Tanpa judul' : values.title}</h1>
              {values.dek !== '' && <p className="dek">{values.dek}</p>}
              <ArticleBody blocks={preview.blocks} />
            </article>
          </>
        )}
      </section>
    </div>
  );
}
