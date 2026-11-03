// Server-side calls from Next.js to the API (ADR-002). The web app holds no database
// credentials and makes no authorization decisions: it forwards the browser's cookies and
// trusts only what the API answers.
import 'server-only';

export interface Founder {
  readonly id: string;
  readonly email: string;
  readonly role: 'founder';
  readonly mfaEnabled: boolean;
}

function apiBaseUrl(): string {
  const value = process.env['API_BASE_URL'];
  if (value === undefined || !/^https?:\/\/[^/\s]+$/.test(value)) {
    throw new Error('API_BASE_URL must be set to the internal API origin, e.g. http://api:4000');
  }
  return value;
}

/** The current founder, or null when the API says the request is not authenticated. */
export async function currentFounder(cookieHeader: string | null): Promise<Founder | null> {
  if (cookieHeader === null || cookieHeader === '') return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/auth/me`, {
    headers: { cookie: cookieHeader, accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`API answered ${String(response.status)} for /auth/me`);
  const body = (await response.json()) as { user: Founder };
  return body.user;
}
