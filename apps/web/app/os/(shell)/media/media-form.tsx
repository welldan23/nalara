'use client';
// Upload an image or edit its description (P1-09). The API recognises the file by its bytes,
// strips metadata and re-checks every field; this form only collects them.
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import type { Media } from '../../../../lib/api';
import {
  MAX_UPLOAD_BYTES,
  USAGE_BASIS_LABELS,
  describeMediaField,
} from '../../../../lib/media-messages';

interface Values {
  altText: string;
  caption: string;
  usageBasis: string;
  license: string;
  attribution: string;
}

async function csrfToken(): Promise<string> {
  const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
  if (!me.ok) throw new Error('session');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => {
      reject(new Error('read'));
    };
    reader.readAsDataURL(file);
  });
}

export function MediaForm({ media }: { readonly media?: Media }) {
  const router = useRouter();
  const ids = useId();
  const isNew = media === undefined;
  const [values, setValues] = useState<Values>({
    altText: media?.altText ?? '',
    caption: media?.caption ?? '',
    usageBasis: media?.usageBasis ?? 'own_work',
    license: media?.license ?? '',
    attribution: media?.attribution ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState(media?.version ?? 0);
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
    setErrors([]);
    setNotice('');
    if (isNew && file === null) {
      setErrors(['Pilih berkas gambar dulu.']);
      return;
    }
    if (file !== null && file.size > MAX_UPLOAD_BYTES) {
      setErrors(['Berkas lebih dari 5 MB. Perkecil dulu, lalu unggah lagi.']);
      return;
    }
    setBusy(true);
    try {
      const described = {
        altText: values.altText,
        caption: values.caption,
        usageBasis: values.usageBasis,
        license: values.license,
        attribution: values.attribution,
      };
      const response = isNew
        ? await fetch('/api/v1/os/media', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
            body: JSON.stringify({ ...described, data: await base64(file ?? new File([], '')) }),
          })
        : await fetch(`/api/v1/os/media/${encodeURIComponent(media.id)}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
            body: JSON.stringify({ ...described, expectedVersion: version }),
          });
      const body = (await response.json()) as {
        media?: Media;
        error?: { code: string; fields?: { path: string; rule: string }[] };
      };
      if (response.ok && body.media !== undefined) {
        if (isNew) {
          router.push(`/os/media/${body.media.id}`);
          return;
        }
        setVersion(body.media.version);
        setNotice(`Tersimpan (versi ${String(body.media.version)}).`);
        router.refresh();
      } else if (body.error?.code === 'VERSION_CONFLICT') {
        setErrors(['Gambar ini sudah diubah di tab lain. Muat ulang halaman, lalu ulangi.']);
      } else if (body.error?.code === 'VALIDATION_FAILED') {
        setErrors((body.error.fields ?? []).map((f) => describeMediaField(f.path, f.rule)));
      } else if (response.status === 413) {
        setErrors(['Berkas terlalu besar (maksimal 5 MB).']);
      } else if (response.status === 401) {
        setErrors(['Sesi berakhir. Masuk lagi, lalu ulangi.']);
      } else {
        setErrors([`Gagal menyimpan (${body.error?.code ?? String(response.status)}).`]);
      }
    } catch {
      setErrors(['Gagal menyimpan. Periksa koneksi lalu coba lagi.']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="editor-form source-form" onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy}>
        {isNew && (
          <>
            <label htmlFor={field('file')}>Berkas gambar (PNG, JPEG, atau WebP, maks. 5 MB)</label>
            <input
              id={field('file')}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
              aria-describedby={field('file-help')}
            />
            <p id={field('file-help')} className="muted field-help">
              Data tersembunyi seperti lokasi GPS, merek kamera, dan tanggal foto dibuang otomatis
              sebelum disimpan.
            </p>
          </>
        )}
        <label htmlFor={field('alt')}>Teks alternatif (wajib)</label>
        <textarea
          id={field('alt')}
          value={values.altText}
          onChange={(event) => {
            set('altText')(event.target.value);
          }}
          maxLength={300}
          rows={2}
          required
          placeholder="mis. Grafik garis inflasi bulanan Januari–Oktober 2026"
        />
        <label htmlFor={field('caption')}>Keterangan (opsional, tampil di bawah gambar)</label>
        <input
          id={field('caption')}
          value={values.caption}
          onChange={(event) => {
            set('caption')(event.target.value);
          }}
          maxLength={300}
        />
        <label htmlFor={field('basis')}>Dasar pemakaian</label>
        <select
          id={field('basis')}
          value={values.usageBasis}
          onChange={(event) => {
            set('usageBasis')(event.target.value);
          }}
        >
          {Object.entries(USAGE_BASIS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor={field('license')}>Lisensi (wajib sebelum terbit)</label>
        <input
          id={field('license')}
          value={values.license}
          onChange={(event) => {
            set('license')(event.target.value);
          }}
          maxLength={200}
          placeholder="mis. Milik NALARA, CC BY 4.0, Izin tertulis dari ..."
        />
        <label htmlFor={field('attribution')}>Atribusi (wajib sebelum terbit)</label>
        <input
          id={field('attribution')}
          value={values.attribution}
          onChange={(event) => {
            set('attribution')(event.target.value);
          }}
          maxLength={300}
          placeholder="mis. Foto: NALARA"
        />
        <div className="editor-actions">
          <button type="submit">{isNew ? 'Unggah gambar' : 'Simpan perubahan'}</button>
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
