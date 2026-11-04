'use client';
// Draft editor (P1-02). The browser only collects input and shows what the API answers: parsing,
// validation, versions and authorization all happen in the API (ADR-002, ADR-011).
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { ArticleBody, CitationList, previewImageSrc } from '../../../../components/article-body';
import type { Citation, VerificationLevel } from '../../../../lib/api';
import type { Block, MediaRender } from '../../../../components/article-body';
import {
  TYPE_LABELS,
  WARNING_MESSAGES,
  GATE_MESSAGES,
  RULE_MESSAGES,
  VERIFICATION_LABELS,
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
  readonly citations: readonly Citation[];
}

interface Warning {
  readonly code: string;
  readonly detail?: string;
}

interface Preview {
  readonly blocks: Block[];
  readonly issues: { line: number; rule: string }[];
  readonly media: Readonly<Record<string, MediaRender>>;
}

function today(): string {
  // Calendar date in Asia/Jakarta, as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function newCitation(): Citation {
  return {
    id: crypto.randomUUID(),
    url: '',
    publisher: '',
    title: '',
    accessedAt: today(),
    claimNote: '',
    primary: false,
    verified: false,
  };
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
  readonly verification?: VerificationLevel;
  readonly status?: string;
  /** 'correct': the article is published; saving publishes a correction (P1-07). */
  readonly mode?: 'edit' | 'correct';
}) {
  const router = useRouter();
  const ids = useId();
  const [values, setValues] = useState<EditorValues>(props.initial);
  const [changeNote, setChangeNote] = useState('');
  const [version, setVersion] = useState(props.version ?? 0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [verification, setVerification] = useState<VerificationLevel | null>(
    props.verification ?? null,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // A notice belongs to the status it was shown for. When review/approve/publish moves the
  // article on, drop it (adjusting state during render, as React recommends, not in an effect).
  const [noticeStatus, setNoticeStatus] = useState(props.status);
  if (props.status !== noticeStatus) {
    setNoticeStatus(props.status);
    if (props.status !== 'draft') setNotice('');
  }
  const correcting = props.mode === 'correct';
  const editable = (props.editable ?? true) || correcting;
  const isNew = props.articleId === undefined;
  const [description, setDescription] = useState('');
  const [substantial, setSubstantial] = useState(true);

  const set =
    <K extends keyof EditorValues>(key: K) =>
    (value: EditorValues[K]) => {
      setValues((current) => ({ ...current, [key]: value }));
      setNotice('');
    };

  const setCitation = (index: number, patch: Partial<Citation>) => {
    setValues((current) => ({
      ...current,
      citations: current.citations.map((citation, at) =>
        at === index ? { ...citation, ...patch } : citation,
      ),
    }));
    setNotice('');
  };
  const addCitation = () => {
    setValues((current) => ({ ...current, citations: [...current.citations, newCitation()] }));
  };
  const removeCitation = (index: number) => {
    setValues((current) => ({
      ...current,
      citations: current.citations.filter((_, at) => at !== index),
    }));
  };

  async function showPreview() {
    setBusy(true);
    setErrors([]);
    try {
      const response = await send('POST', '/api/v1/os/articles/preview', {
        title: values.title,
        dek: values.dek,
        bodySource: values.bodySource,
        citations: values.citations,
      });
      if (response.status === 400) {
        const body = (await response.json()) as {
          error: { fields?: { path: string; rule: string }[] };
        };
        setErrors((body.error.fields ?? []).map((item) => describeField(item.path, item.rule)));
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as Preview & {
        warnings: Warning[];
        verification: VerificationLevel;
      };
      setPreview({ blocks: body.blocks, issues: body.issues, media: body.media });
      setWarnings(body.warnings);
      setVerification(body.verification);
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
      citations: values.citations,
    };
    try {
      const articlePath = `/api/v1/os/articles/${encodeURIComponent(props.articleId ?? '')}`;
      const revision = {
        ...payload,
        expectedVersion: version,
        changeNote: changeNote.trim() === '' ? (correcting ? 'Koreksi' : 'Revisi') : changeNote,
      };
      const response = isNew
        ? await send('POST', '/api/v1/os/articles', payload)
        : correcting
          ? await send('POST', `${articlePath}/correct`, { ...revision, description, substantial })
          : await send('PATCH', articlePath, revision);
      const body = (await response.json()) as {
        articleId?: string;
        version?: number;
        warnings?: Warning[];
        verification?: VerificationLevel;
        returnedToDraft?: boolean;
        substantial?: boolean;
        error?: { code: string; fields?: { path: string; rule: string }[] };
      };
      if (response.ok) {
        setWarnings(body.warnings ?? []);
        if (body.verification !== undefined) setVerification(body.verification);
        if (isNew && body.articleId !== undefined) {
          router.push(`/os/newsroom/${body.articleId}`);
          return;
        }
        setVersion(body.version ?? version);
        setChangeNote('');
        if (correcting) {
          // Next correction starts from the safe default: shown to readers.
          setDescription('');
          setSubstantial(true);
        }
        setNotice(
          correcting
            ? `Koreksi terbit sebagai versi ${String(body.version ?? version)}.${body.substantial === true ? ' Catatan koreksi tampil ke pembaca.' : ' Koreksi kecil: hanya tercatat di riwayat internal.'}`
            : body.returnedToDraft === true
              ? `Tersimpan sebagai versi ${String(body.version ?? version)}. Artikel kembali ke draft; review atau persetujuan sebelumnya batal.`
              : `Tersimpan sebagai versi ${String(body.version ?? version)}.`,
        );
        router.refresh();
      } else if (body.error?.code === 'VERSION_CONFLICT') {
        setErrors([
          'Artikel ini sudah diubah di tab atau perangkat lain. Salin perubahanmu, muat ulang halaman, lalu simpan lagi.',
        ]);
      } else if (body.error?.code === 'GATE_BLOCKED') {
        setErrors(
          (body.error.fields ?? []).map((field) => GATE_MESSAGES[field.rule] ?? field.rule),
        );
      } else if (body.error?.code === 'INVALID_TRANSITION') {
        setErrors(['Artikel ini sudah tidak terbit. Muat ulang halaman.']);
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
            &gt; — Nama, jabatan · angka: :::angka lalu baris nilai, satuan, periode, label, sumber:
            N, tutup dengan :::
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

          <fieldset className="citations-editor">
            <legend>Sumber</legend>
            <p className="hint">
              URL penerbit asli (https), bukan agregator. Centang “sumber primer” untuk rilis resmi,
              dokumen, atau data resmi. Centang “sudah dicek” hanya setelah kamu membuka sumbernya
              dan mencocokkan klaimnya. Di blok :::angka, tulis “sumber: N” sesuai nomor di bawah.
            </p>
            {values.citations.length === 0 && <p className="muted">Belum ada sumber.</p>}
            <ol>
              {values.citations.map((citation, index) => (
                <li key={citation.id} className="citation-row">
                  <label htmlFor={field(`c${String(index)}-url`)}>Sumber {index + 1}: URL</label>
                  <input
                    id={field(`c${String(index)}-url`)}
                    type="url"
                    inputMode="url"
                    value={citation.url}
                    onChange={(event) => {
                      setCitation(index, { url: event.target.value });
                    }}
                    placeholder="https://"
                  />
                  <div className="editor-row">
                    <div>
                      <label htmlFor={field(`c${String(index)}-publisher`)}>Penerbit</label>
                      <input
                        id={field(`c${String(index)}-publisher`)}
                        value={citation.publisher}
                        onChange={(event) => {
                          setCitation(index, { publisher: event.target.value });
                        }}
                        maxLength={120}
                      />
                    </div>
                    <div>
                      <label htmlFor={field(`c${String(index)}-date`)}>Tanggal akses</label>
                      <input
                        id={field(`c${String(index)}-date`)}
                        type="date"
                        value={citation.accessedAt}
                        onChange={(event) => {
                          setCitation(index, { accessedAt: event.target.value });
                        }}
                      />
                    </div>
                  </div>
                  <label htmlFor={field(`c${String(index)}-title`)}>Judul halaman</label>
                  <input
                    id={field(`c${String(index)}-title`)}
                    value={citation.title}
                    onChange={(event) => {
                      setCitation(index, { title: event.target.value });
                    }}
                    maxLength={300}
                  />
                  <label htmlFor={field(`c${String(index)}-claim`)}>Klaim yang didukung</label>
                  <input
                    id={field(`c${String(index)}-claim`)}
                    value={citation.claimNote}
                    onChange={(event) => {
                      setCitation(index, { claimNote: event.target.value });
                    }}
                    maxLength={500}
                  />
                  <div className="citation-flags">
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={citation.primary}
                        onChange={(event) => {
                          setCitation(index, { primary: event.target.checked });
                        }}
                      />
                      Sumber primer
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={citation.verified}
                        onChange={(event) => {
                          setCitation(index, { verified: event.target.checked });
                        }}
                      />
                      Sudah dicek
                    </label>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        removeCitation(index);
                      }}
                    >
                      Hapus sumber {index + 1}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" className="secondary" onClick={addCitation}>
              Tambah sumber
            </button>
          </fieldset>

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

          {correcting && (
            <fieldset className="correction">
              <legend>Koreksi</legend>
              <label htmlFor={field('correction')}>Apa yang dikoreksi</label>
              <textarea
                id={field('correction')}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
                minLength={10}
                maxLength={500}
                rows={2}
                placeholder="mis. Sebelumnya tertulis inflasi 3,1 persen; angka resmi BPS 2,8 persen."
              />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={substantial}
                  onChange={(event) => {
                    setSubstantial(event.target.checked);
                  }}
                />
                Koreksi substansial (fakta, angka, kutipan): tampilkan catatan ke pembaca
              </label>
            </fieldset>
          )}

          <div className="editor-actions">
            <button type="button" className="secondary" onClick={() => void showPreview()}>
              Pratinjau
            </button>
            <button type="submit">
              {isNew
                ? 'Simpan draft'
                : correcting
                  ? 'Terbitkan koreksi'
                  : `Simpan versi ${String(version + 1)}`}
            </button>
          </div>
        </fieldset>
        {!editable && <p className="muted">Artikel yang diarsipkan tidak bisa diubah lagi.</p>}
        {correcting && (
          <p className="notice-warn">
            Artikel ini sudah terbit. Perubahan langsung tayang sebagai koreksi (tetap melewati
            gerbang sumber); versi lama tetap tersimpan.
          </p>
        )}
        {editable && !correcting && props.status !== undefined && props.status !== 'draft' && (
          <p className="notice-warn">
            Menyimpan perubahan akan mengembalikan artikel ke draft dan membatalkan review atau
            persetujuan yang ada.
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
        {verification !== null && (
          <p className={`verification verification-${verification}`} data-testid="verification">
            Status sumber: <strong>{VERIFICATION_LABELS[verification] ?? verification}</strong>
          </p>
        )}
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
              <ArticleBody
                blocks={preview.blocks}
                citations={values.citations}
                media={preview.media}
                imageSrc={previewImageSrc}
                preview
              />
              <CitationList citations={values.citations} />
            </article>
          </>
        )}
      </section>
    </div>
  );
}
