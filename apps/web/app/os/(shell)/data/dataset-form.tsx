'use client';
// Create or edit a dataset's description (P4-02). Slug and source are fixed once created.
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { Dataset, Source } from '../../../../lib/api';
import { FREQUENCY_LABELS, describeDataField } from '../../../../lib/data-messages';
import { LICENSE_LABELS } from '../../../../lib/source-messages';
import { sendJson } from './client';

interface Values {
  slug: string;
  sourceId: string;
  title: string;
  description: string;
  sourcePageUrl: string;
  unit: string;
  frequency: string;
  methodology: string;
  licenseStatus: string;
  licenseNote: string;
  attribution: string;
}

export function DatasetForm(props: {
  readonly dataset?: Dataset;
  readonly sources?: readonly Pick<Source, 'id' | 'name' | 'organization'>[];
}) {
  const router = useRouter();
  const ids = useId();
  const { dataset } = props;
  const [values, setValues] = useState<Values>({
    slug: dataset?.slug ?? '',
    sourceId: dataset?.sourceId ?? props.sources?.[0]?.id ?? '',
    title: dataset?.title ?? '',
    description: dataset?.description ?? '',
    sourcePageUrl: dataset?.sourcePageUrl ?? 'https://',
    unit: dataset?.unit ?? '',
    frequency: dataset?.frequency ?? 'monthly',
    methodology: dataset?.methodology ?? '',
    licenseStatus: dataset?.licenseStatus ?? 'unknown',
    licenseNote: dataset?.licenseNote ?? '',
    attribution: dataset?.attribution ?? '',
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const field = (name: string) => `${ids}-${name}`;
  const set = (key: keyof Values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setNotice('');
  };

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const { slug, sourceId, ...metadata } = values;
      const answer =
        dataset === undefined
          ? await sendJson<{ id: string }>('POST', '/api/v1/os/datasets', {
              slug,
              sourceId,
              ...metadata,
            })
          : await sendJson<{ version: number }>(
              'PUT',
              `/api/v1/os/datasets/${encodeURIComponent(dataset.id)}`,
              { ...metadata, expectedVersion: dataset.version },
            );
      if (answer.ok) {
        if (dataset === undefined) {
          router.push(`/os/data/${(answer.body as { id: string }).id}`);
          return;
        }
        setNotice('Tersimpan.');
        router.refresh();
      } else if (answer.body.error?.code === 'VERSION_CONFLICT') {
        setErrors(['Dataset ini sudah diubah di tab lain. Muat ulang halaman.']);
      } else {
        setErrors(
          (answer.body.error?.fields ?? [])
            .map((f) => describeDataField(f.path, f.rule))
            .concat(
              answer.body.error?.fields === undefined
                ? [`Gagal menyimpan (${answer.body.error?.code ?? String(answer.status)}).`]
                : [],
            ),
        );
      }
    } catch {
      setErrors(['Gagal menyimpan. Periksa koneksi lalu coba lagi.']);
    } finally {
      setBusy(false);
    }
  }

  const text = (
    key: keyof Values,
    label: string,
    max: number,
    extra: Record<string, unknown> = {},
  ) => (
    <>
      <label htmlFor={field(key)}>{label}</label>
      <input
        id={field(key)}
        value={values[key]}
        maxLength={max}
        onChange={(event) => {
          set(key)(event.target.value);
        }}
        {...extra}
      />
    </>
  );
  const area = (key: keyof Values, label: string, max: number) => (
    <>
      <label htmlFor={field(key)}>{label}</label>
      <textarea
        id={field(key)}
        value={values[key]}
        maxLength={max}
        rows={3}
        onChange={(event) => {
          set(key)(event.target.value);
        }}
      />
    </>
  );

  return (
    <form className="editor-form source-form" onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy}>
        {dataset === undefined && (
          <>
            {text('slug', 'Slug (untuk alamat /data/…)', 80, {
              required: true,
              pattern: '[a-z0-9]+(-[a-z0-9]+)*',
              placeholder: 'mis. inflasi-bulanan',
            })}
            <label htmlFor={field('source')}>Sumber (dari Source Registry)</label>
            <select
              id={field('source')}
              value={values.sourceId}
              onChange={(event) => {
                set('sourceId')(event.target.value);
              }}
            >
              {(props.sources ?? []).map((source) => (
                <option key={source.id} value={source.id}>
                  {source.organization} · {source.name}
                </option>
              ))}
            </select>
          </>
        )}
        {text('title', 'Judul', 200, { required: true })}
        {area('description', 'Deskripsi', 2000)}
        {text('sourcePageUrl', 'URL halaman data di situs penerbit', 2048, {
          type: 'url',
          required: true,
        })}
        {text('unit', 'Satuan', 60, { required: true, placeholder: 'mis. persen (yoy)' })}
        <label htmlFor={field('frequency')}>Frekuensi</label>
        <select
          id={field('frequency')}
          value={values.frequency}
          onChange={(event) => {
            set('frequency')(event.target.value);
          }}
        >
          {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {area('methodology', 'Metodologi (cara data diambil dan diolah)', 4000)}
        <label htmlFor={field('license')}>Lisensi data</label>
        <select
          id={field('license')}
          value={values.licenseStatus}
          onChange={(event) => {
            set('licenseStatus')(event.target.value);
          }}
        >
          {Object.entries(LICENSE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {area('licenseNote', 'Catatan lisensi (wajib bila "perlu izin": tulis izinnya)', 500)}
        {text('attribution', 'Atribusi (wajib bila lisensi meminta)', 300)}
        <button type="submit">{dataset === undefined ? 'Buat dataset' : 'Simpan'}</button>
      </fieldset>
      {notice !== '' && <p role="status">{notice}</p>}
      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
