'use client';

// Founder sign-in: password → (first time) MFA enrolment | (later) TOTP or recovery code.
// The API holds every secret and decides every step; this component only renders its answers.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

type Step =
  | { readonly kind: 'password' }
  | { readonly kind: 'enrol'; readonly secret: string; readonly otpauthUri: string }
  | { readonly kind: 'mfa'; readonly useRecovery: boolean }
  | { readonly kind: 'recovery-codes'; readonly codes: readonly string[] };

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const MESSAGES: Record<number, string> = {
  400: 'Isian belum lengkap atau formatnya salah.',
  401: 'Data masuk salah atau sudah kedaluwarsa.',
  403: 'Permintaan ditolak.',
  429: 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
};

function messageFor(status: number): string {
  return MESSAGES[status] ?? 'Terjadi gangguan. Coba lagi beberapa saat lagi.';
}

export function LoginFlow() {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(messageFor(0));
    } finally {
      setBusy(false);
    }
  }

  function field(form: HTMLFormElement, name: string): string {
    const value = new FormData(form).get(name);
    return typeof value === 'string' ? value : '';
  }

  function onPassword(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void run(async () => {
      const response = await postJson('/api/v1/auth/login', {
        email: field(form, 'email'),
        password: field(form, 'password'),
      });
      if (!response.ok) {
        setError(messageFor(response.status));
        return;
      }
      const { next } = (await response.json()) as { next: 'mfa' | 'mfa_enrolment' };
      if (next === 'mfa') {
        setStep({ kind: 'mfa', useRecovery: false });
        return;
      }
      const setup = await postJson('/api/v1/auth/mfa/setup', {});
      if (!setup.ok) {
        setError(messageFor(setup.status));
        return;
      }
      const { secret, otpauthUri } = (await setup.json()) as { secret: string; otpauthUri: string };
      setStep({ kind: 'enrol', secret, otpauthUri });
    });
  }

  function onCode(event: SubmitEvent<HTMLFormElement>, useRecovery: boolean) {
    event.preventDefault();
    const form = event.currentTarget;
    void run(async () => {
      const body = useRecovery
        ? { recoveryCode: field(form, 'recoveryCode') }
        : { code: field(form, 'code').replace(/\s/g, '') };
      const response = await postJson('/api/v1/auth/mfa/verify', body);
      if (!response.ok) {
        setError(messageFor(response.status));
        return;
      }
      const result = (await response.json()) as { recoveryCodes?: string[] };
      if (result.recoveryCodes !== undefined) {
        setStep({ kind: 'recovery-codes', codes: result.recoveryCodes });
      } else {
        router.push('/os');
      }
    });
  }

  const errorBox = error !== null && (
    <p role="alert" className="error">
      {error}
    </p>
  );

  if (step.kind === 'password') {
    return (
      <form onSubmit={onPassword} noValidate aria-describedby="login-help">
        <p id="login-help" className="muted">
          Khusus founder. Setelah password, kamu akan diminta kode dari aplikasi authenticator.
        </p>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required maxLength={254} />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
          />
        </label>
        {errorBox}
        <button type="submit" disabled={busy}>
          {busy ? 'Memeriksa…' : 'Lanjut'}
        </button>
      </form>
    );
  }

  if (step.kind === 'enrol') {
    return (
      <form
        onSubmit={(event) => {
          onCode(event, false);
        }}
        noValidate
      >
        <h2>Aktifkan verifikasi dua langkah</h2>
        <p>
          Tambahkan akun ke aplikasi authenticator (misalnya Aegis, 1Password, atau Google
          Authenticator) dengan kunci berikut, lalu masukkan kode 6 digit yang muncul.
        </p>
        <p>
          Kunci: <code data-testid="totp-secret">{step.secret}</code>
        </p>
        <p className="muted">
          Atau buka tautan ini di perangkat yang sama:{' '}
          <a href={step.otpauthUri}>tambahkan ke authenticator</a>
        </p>
        <label>
          Kode 6 digit
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </label>
        {errorBox}
        <button type="submit" disabled={busy}>
          {busy ? 'Memeriksa…' : 'Aktifkan & masuk'}
        </button>
      </form>
    );
  }

  if (step.kind === 'mfa') {
    return (
      <form
        onSubmit={(event) => {
          onCode(event, step.useRecovery);
        }}
        noValidate
      >
        {step.useRecovery ? (
          <label>
            Kode pemulihan
            <input name="recoveryCode" autoComplete="off" maxLength={32} required />
          </label>
        ) : (
          <label>
            Kode 6 digit dari authenticator
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </label>
        )}
        {errorBox}
        <button type="submit" disabled={busy}>
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setError(null);
            setStep({ kind: 'mfa', useRecovery: !step.useRecovery });
          }}
        >
          {step.useRecovery ? 'Pakai kode authenticator' : 'Pakai kode pemulihan'}
        </button>
      </form>
    );
  }

  return (
    <section aria-labelledby="codes-title">
      <h2 id="codes-title">Simpan kode pemulihan</h2>
      <p>
        Kode ini hanya ditampilkan <strong>sekali</strong>. Simpan di tempat aman (password manager
        atau kertas). Setiap kode hanya bisa dipakai satu kali jika perangkat authenticator hilang.
      </p>
      <ul className="codes" data-testid="recovery-codes">
        {step.codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          router.push('/os');
        }}
      >
        Sudah saya simpan, lanjut
      </button>
    </section>
  );
}
