'use client';
// Publish one version, retract, or re-run a version's transform to prove it reproduces (P4-02).
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Dataset, DatasetVersion } from '../../../../../lib/api';
import { describeDataField } from '../../../../../lib/data-messages';
import { sendJson } from '../client';

export function VerifyButton(props: { readonly datasetId: string; readonly version: number }) {
  const [result, setResult] = useState('');
  return (
    <span>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          void sendJson<{ rawMatches: boolean; observationsMatch: boolean }>(
            'POST',
            `/api/v1/os/datasets/${encodeURIComponent(props.datasetId)}/versions/${String(props.version)}/verify`,
            {},
          ).then((answer) => {
            setResult(
              answer.ok && answer.body.rawMatches && answer.body.observationsMatch
                ? 'Cocok: file dan hasil olahan sama persis.'
                : 'TIDAK cocok. Jangan terbitkan versi ini.',
            );
          })
        }
      >
        Ulangi transformasi
      </button>{' '}
      {result !== '' && <span role="status">{result}</span>}
    </span>
  );
}

export function PublishPanel(props: {
  readonly dataset: Dataset;
  readonly versions: readonly DatasetVersion[];
}) {
  const router = useRouter();
  const { dataset } = props;
  const [chosen, setChosen] = useState(String(props.versions[0]?.version ?? ''));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function act(kind: 'publish' | 'retract') {
    setBusy(true);
    setErrors([]);
    try {
      const answer = await sendJson(
        'POST',
        `/api/v1/os/datasets/${encodeURIComponent(dataset.id)}/${kind}`,
        kind === 'publish'
          ? { version: Number(chosen), expectedVersion: dataset.version }
          : { expectedVersion: dataset.version },
      );
      if (answer.ok) router.refresh();
      else if (answer.body.error?.code === 'INTEGRITY_FAILED') {
        setErrors(['Versi ini tidak lagi menghasilkan data yang sama. Jangan terbitkan.']);
      } else {
        const fields = answer.body.error?.fields;
        setErrors(
          fields === undefined
            ? [`Gagal (${answer.body.error?.code ?? String(answer.status)}).`]
            : fields.map((f) => describeDataField(f.path, f.rule)),
        );
      }
    } catch {
      setErrors(['Gagal. Coba lagi.']);
    } finally {
      setBusy(false);
    }
  }

  if (props.versions.length === 0) {
    return <p className="muted">Tambahkan versi pertama dulu.</p>;
  }
  return (
    <div>
      <div className="inbox-actions">
        <label htmlFor="publish-version">Versi untuk pembaca</label>
        <select
          id="publish-version"
          value={chosen}
          disabled={busy}
          onChange={(event) => {
            setChosen(event.target.value);
          }}
        >
          {props.versions.map((version) => (
            <option key={version.version} value={version.version}>
              v{version.version} ({version.retrievedOn})
            </option>
          ))}
        </select>
        <button type="button" disabled={busy} onClick={() => void act('publish')}>
          Terbitkan versi ini
        </button>
        {dataset.status === 'published' && (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => void act('retract')}
          >
            Tarik dataset
          </button>
        )}
      </div>
      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
