'use client';
// Create or edit a registry source (P1-05). The API validates everything again.
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { Source } from '../../../../lib/api';
import {
  LICENSE_LABELS,
  SOURCE_STATUS_HELP,
  SOURCE_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  describeSourceField,
} from '../../../../lib/source-messages';

interface Values {
  name: string;
  organization: string;
  type: string;
  officialUrl: string;
  licenseStatus: string;
  licenseNote: string;
  attribution: string;
  status: string;
  notes: string;
  feedUrl: string;
}

const EMPTY: Values = {
  name: '',
  organization: '',
  type: 'statistics',
  officialUrl: 'https://',
  licenseStatus: 'unknown',
  licenseNote: '',
  attribution: '',
  status: 'candidate',
  notes: '',
  feedUrl: '',
};

function valuesOf(source: Source | undefined): Values {
  if (source === undefined) return EMPTY;
  return {
    name: source.name,
    organization: source.organization,
    type: source.type,
    officialUrl: source.officialUrl,
    licenseStatus: source.licenseStatus,
    licenseNote: source.licenseNote ?? '',
    attribution: source.attribution ?? '',
    status: source.status,
    notes: source.notes ?? '',
    feedUrl: source.feedUrl ?? '',
  };
}

async function csrfToken(): Promise<string> {
  const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
  if (!me.ok) throw new Error('session');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

export function SourceForm({ source }: { readonly source?: Source }) {
  const router = useRouter();
  const ids = useId();
  const [values, setValues] = useState<Values>(valuesOf(source));
  const [version, setVersion] = useState(source?.version ?? 0);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const isNew = source === undefined;
  const field = (name: string) => `${ids}-${name}`;
  const set = (key: keyof Values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setNotice('');
  };

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    setNotice('');
    try {
      const url = isNew
        ? '/api/v1/os/sources'
        : `/api/v1/os/sources/${encodeURIComponent(source.id)}`;
      const response = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
        body: JSON.stringify({ ...values, ...(isNew ? {} : { expectedVersion: version }) }),
      });
      const body = (await response.json()) as {
        source?: Source;
        error?: { code: string; fields?: { path: string; rule: string }[] };
      };
      if (response.ok && body.source !== undefined) {
        if (isNew) {
          router.push(`/os/sources/${body.source.id}`);
          return;
        }
        setVersion(body.source.version);
        setNotice(`Tersimpan (versi ${String(body.source.version)}).`);
        router.refresh();
      } else if (body.error?.code === 'VERSION_CONFLICT') {
        setErrors(['Sumber ini sudah diubah di tab lain. Muat ulang halaman, lalu ulangi.']);
      } else if (body.error?.code === 'VALIDATION_FAILED') {
        setErrors((body.error.fields ?? []).map((f) => describeSourceField(f.path, f.rule)));
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

  const options = (labels: Readonly<Record<string, string>>) =>
    Object.entries(labels).map(([value, label]) => (
      <option key={value} value={value}>
        {label}
      </option>
    ));

  return (
    <form className="editor-form source-form" onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy}>
        <label htmlFor={field('name')}>Nama sumber</label>
        <input
          id={field('name')}
          value={values.name}
          onChange={(event) => {
            set('name')(event.target.value);
          }}
          maxLength={160}
          required
          placeholder="mis. Berita Resmi Statistik"
        />
        <label htmlFor={field('organization')}>Lembaga</label>
        <input
          id={field('organization')}
          value={values.organization}
          onChange={(event) => {
            set('organization')(event.target.value);
          }}
          maxLength={160}
          required
          placeholder="mis. Badan Pusat Statistik"
        />
        <label htmlFor={field('type')}>Jenis</label>
        <select
          id={field('type')}
          value={values.type}
          onChange={(event) => {
            set('type')(event.target.value);
          }}
        >
          {options(SOURCE_TYPE_LABELS)}
        </select>
        <label htmlFor={field('url')}>URL resmi</label>
        <input
          id={field('url')}
          type="url"
          inputMode="url"
          value={values.officialUrl}
          onChange={(event) => {
            set('officialUrl')(event.target.value);
          }}
          maxLength={2048}
          required
        />
        <label htmlFor={field('license')}>Lisensi</label>
        <select
          id={field('license')}
          value={values.licenseStatus}
          onChange={(event) => {
            set('licenseStatus')(event.target.value);
          }}
        >
          {options(LICENSE_LABELS)}
        </select>
        <label htmlFor={field('licenseNote')}>Catatan lisensi (opsional)</label>
        <textarea
          id={field('licenseNote')}
          value={values.licenseNote}
          onChange={(event) => {
            set('licenseNote')(event.target.value);
          }}
          maxLength={500}
          rows={2}
          placeholder="mis. tautan halaman ketentuan penggunaan data"
        />
        <label htmlFor={field('attribution')}>Atribusi (wajib bila lisensi meminta)</label>
        <input
          id={field('attribution')}
          value={values.attribution}
          onChange={(event) => {
            set('attribution')(event.target.value);
          }}
          maxLength={300}
          placeholder="mis. Sumber: Badan Pusat Statistik"
        />
        <label htmlFor={field('status')}>Status</label>
        <select
          id={field('status')}
          value={values.status}
          onChange={(event) => {
            set('status')(event.target.value);
          }}
          aria-describedby={field('status-help')}
        >
          {options(SOURCE_STATUS_LABELS)}
        </select>
        <p id={field('status-help')} className="muted field-help">
          {SOURCE_STATUS_HELP}
        </p>
        <label htmlFor={field('feed')}>URL feed RSS/Atom (opsional)</label>
        <input
          id={field('feed')}
          type="url"
          inputMode="url"
          value={values.feedUrl}
          onChange={(event) => {
            set('feedUrl')(event.target.value);
          }}
          maxLength={2048}
          aria-describedby={field('feed-help')}
          placeholder="mis. https://www.bps.go.id/id/pressrelease/rss"
        />
        <p id={field('feed-help')} className="muted field-help">
          Hanya dipakai untuk sumber Terverifikasi. Isinya masuk ke inbox sebagai bahan untuk dicek,
          tidak pernah diterbitkan otomatis.
        </p>
        <label htmlFor={field('notes')}>Catatan internal (opsional)</label>
        <textarea
          id={field('notes')}
          value={values.notes}
          onChange={(event) => {
            set('notes')(event.target.value);
          }}
          maxLength={1000}
          rows={3}
        />
        <div className="editor-actions">
          <button type="submit">{isNew ? 'Simpan sumber' : 'Simpan perubahan'}</button>
        </div>
      </fieldset>
      <div aria-live="polite">
        {notice !== '' && <p className="notice">{notice}</p>}
        {errors.length > 0 && (
          <ul className="error" role="alert">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
