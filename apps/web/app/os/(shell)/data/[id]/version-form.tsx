'use client';
// New dataset version (P4-02): the raw CSV, where it came from, and how to read it. "Pratinjau"
// runs the same transform on the server without storing anything; "Simpan versi" stores the
// file, the rules and the result as an immutable version.
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { PERIOD_FORMAT_LABELS, describeDataField } from '../../../../../lib/data-messages';
import { sendJson } from '../client';

interface Preview {
  observationCount: number;
  series: string[];
  periodStart: string;
  periodEnd: string;
  rowsRead: number;
  rowsMissing: number;
  sha256: string;
  sample: { series: string | null; period: string; value: number }[];
}

const MAX_BYTES = 5 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

export function VersionForm(props: { readonly datasetId: string }) {
  const router = useRouter();
  const ids = useId();
  const field = (name: string) => `${ids}-${name}`;
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [fileUrl, setFileUrl] = useState('https://');
  const [retrievedOn, setRetrievedOn] = useState(today());
  const [note, setNote] = useState('');
  const [spec, setSpec] = useState({
    delimiter: ',',
    decimal: '.',
    thousands: '',
    skipRows: '0',
    periodColumn: '',
    periodFormat: 'month',
    valueColumn: '',
    seriesColumn: '',
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const setSpecField = (key: keyof typeof spec) => (value: string) => {
    setSpec((current) => ({ ...current, [key]: value }));
    setPreview(null);
  };
  const specPayload = () => ({
    format: 'csv',
    delimiter: spec.delimiter === 'tab' ? '\t' : spec.delimiter,
    decimal: spec.decimal,
    thousands: spec.thousands === 'space' ? ' ' : spec.thousands,
    skipRows: Number(spec.skipRows),
    periodColumn: spec.periodColumn,
    periodFormat: spec.periodFormat,
    valueColumn: spec.valueColumn,
    ...(spec.seriesColumn.trim() === '' ? {} : { seriesColumn: spec.seriesColumn }),
  });

  async function pick(input: HTMLInputElement) {
    setPreview(null);
    setErrors([]);
    const chosen = input.files?.[0];
    if (chosen === undefined) return;
    if (chosen.size > MAX_BYTES) {
      setErrors(['File lebih dari 5 MB.']);
      setFile(null);
      return;
    }
    const bytes = new Uint8Array(await chosen.arrayBuffer());
    setFile({
      name: chosen.name.replace(/[^A-Za-z0-9._ ()-]/g, '_').slice(0, 120),
      base64: toBase64(bytes),
    });
  }

  async function run(kind: 'preview' | 'save', event?: SyntheticEvent) {
    event?.preventDefault();
    if (file === null) {
      setErrors(['Pilih file CSV dulu.']);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const answer =
        kind === 'preview'
          ? await sendJson<Preview>('POST', '/api/v1/os/datasets/preview', {
              file: file.base64,
              spec: specPayload(),
            })
          : await sendJson<{ version: number }>(
              'POST',
              `/api/v1/os/datasets/${encodeURIComponent(props.datasetId)}/versions`,
              {
                file: file.base64,
                filename: file.name,
                fileUrl,
                retrievedOn,
                spec: specPayload(),
                revisionNote: note,
              },
            );
      if (answer.ok) {
        if (kind === 'preview') setPreview(answer.body as Preview);
        else {
          setFile(null);
          setPreview(null);
          setNote('');
          router.refresh();
        }
      } else {
        const fields = answer.body.error?.fields;
        setErrors(
          fields === undefined
            ? [`Gagal (${answer.body.error?.code ?? String(answer.status)}).`]
            : fields.map((f) => describeDataField(f.path, f.rule)),
        );
      }
    } catch {
      setErrors(['Gagal. Periksa koneksi lalu coba lagi.']);
    } finally {
      setBusy(false);
    }
  }

  const select = (key: keyof typeof spec, label: string, options: [string, string][]) => (
    <>
      <label htmlFor={field(key)}>{label}</label>
      <select
        id={field(key)}
        value={spec[key]}
        onChange={(event) => {
          setSpecField(key)(event.target.value);
        }}
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </>
  );
  const input = (key: keyof typeof spec, label: string, extra: Record<string, unknown> = {}) => (
    <>
      <label htmlFor={field(key)}>{label}</label>
      <input
        id={field(key)}
        value={spec[key]}
        maxLength={100}
        onChange={(event) => {
          setSpecField(key)(event.target.value);
        }}
        {...extra}
      />
    </>
  );

  return (
    <form className="editor-form source-form" onSubmit={(event) => void run('save', event)}>
      <fieldset disabled={busy}>
        <label htmlFor={field('file')}>File CSV dari penerbit (maks. 5 MB)</label>
        <input
          id={field('file')}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void pick(event.target)}
        />
        <label htmlFor={field('fileUrl')}>URL file asli</label>
        <input
          id={field('fileUrl')}
          type="url"
          value={fileUrl}
          maxLength={2048}
          required
          onChange={(event) => {
            setFileUrl(event.target.value);
          }}
        />
        <label htmlFor={field('retrievedOn')}>Tanggal diambil</label>
        <input
          id={field('retrievedOn')}
          type="date"
          value={retrievedOn}
          max={today()}
          required
          onChange={(event) => {
            setRetrievedOn(event.target.value);
          }}
        />
        {select('delimiter', 'Pemisah kolom', [
          [',', 'Koma (,)'],
          [';', 'Titik koma (;)'],
          ['tab', 'Tab'],
          ['|', 'Garis tegak (|)'],
        ])}
        {select('decimal', 'Tanda desimal', [
          ['.', 'Titik (2.8)'],
          [',', 'Koma (2,8)'],
        ])}
        {select('thousands', 'Pemisah ribuan', [
          ['', 'Tidak ada'],
          ['.', 'Titik (1.234)'],
          [',', 'Koma (1,234)'],
          ['space', 'Spasi (1 234)'],
        ])}
        {input('skipRows', 'Baris dilewati sebelum judul kolom', {
          type: 'number',
          min: 0,
          max: 50,
        })}
        {input('periodColumn', 'Nama kolom periode', { required: true })}
        {select('periodFormat', 'Format periode', Object.entries(PERIOD_FORMAT_LABELS))}
        {input('valueColumn', 'Nama kolom nilai', { required: true })}
        {input('seriesColumn', 'Nama kolom seri (opsional, untuk beberapa garis)')}
        <label htmlFor={field('note')}>Catatan revisi</label>
        <textarea
          id={field('note')}
          value={note}
          maxLength={1000}
          rows={2}
          required
          placeholder="mis. Versi pertama, atau: Revisi angka September oleh BPS"
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <div className="inbox-actions">
          <button type="button" className="secondary" onClick={() => void run('preview')}>
            Pratinjau
          </button>
          <button type="submit">Simpan versi</button>
        </div>
      </fieldset>
      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {preview !== null && (
        <section aria-label="Pratinjau" data-testid="preview">
          <p>
            {preview.observationCount} titik data · {preview.periodStart} sampai {preview.periodEnd}
            {preview.series.length > 0 ? ` · ${String(preview.series.length)} seri` : ''} ·{' '}
            {preview.rowsMissing} baris tanpa nilai
          </p>
          <p className="muted hash">SHA-256 hasil: {preview.sha256}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {preview.series.length > 0 && <th scope="col">Seri</th>}
                  <th scope="col">Periode</th>
                  <th scope="col">Nilai</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((row) => (
                  <tr key={`${row.series ?? ''}-${row.period}`}>
                    {preview.series.length > 0 && <td>{row.series}</td>}
                    <td>{row.period}</td>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </form>
  );
}
