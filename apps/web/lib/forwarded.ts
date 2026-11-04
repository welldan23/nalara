// Reader IP for the API's per-client rate limit (P1-10, R-12). Server-side calls reach the API
// from the web container, so without this every reader would share one bucket. Caddy sets
// X-Forwarded-For to the reader's address; the web passes it on unchanged, and the API trusts it
// only because the web container's fixed address is in TRUSTED_PROXIES (compose.prod.yaml).
// Nothing here is a security decision: the API ignores the header from anyone it does not trust.
import 'server-only';
import { headers } from 'next/headers';

const FORWARDED = /^[0-9A-Fa-f:.]+(\s*,\s*[0-9A-Fa-f:.]+)*$/;

export async function forwardedFor(): Promise<Record<string, string>> {
  try {
    const value = (await headers()).get('x-forwarded-for');
    return value !== null && value.length <= 200 && FORWARDED.test(value)
      ? { 'x-forwarded-for': value }
      : {};
  } catch {
    // Outside a request (e.g. at build time) there is no reader to forward.
    return {};
  }
}
