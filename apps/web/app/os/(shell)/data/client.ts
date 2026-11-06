// Shared browser helpers for the NALARA Data pages (P4-02).
export async function csrfToken(): Promise<string> {
  const me = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
  if (!me.ok) throw new Error('session');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

export interface ApiAnswer<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly body: T & { error?: { code: string; fields?: { path: string; rule: string }[] } };
}

export async function sendJson<T>(
  method: 'POST' | 'PUT',
  url: string,
  payload: unknown,
): Promise<ApiAnswer<T>> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as ApiAnswer<T>['body'];
  return { ok: response.ok, status: response.status, body };
}
