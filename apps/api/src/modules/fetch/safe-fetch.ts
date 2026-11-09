// The only way the worker talks to the internet (P2-01, PRD v4 §8; pattern from VORSA netsafe).
//
// - Schemes: https on 443 and http on 80 only; no credentials in URLs.
// - Every address a host name resolves to must pass the address policy (public only by default).
//   The connection then goes to the address that was checked, never to a second lookup, so DNS
//   rebinding cannot swap in an internal address between the check and the connect.
// - IP literals are checked the same way (the URL parser already normalises 0x7f.1, 2130706433…).
// - Redirects are followed by hand, at most `maxRedirects`, and every hop is checked again.
// - One deadline for the whole fetch, a byte limit on the body after decompression (gzip bombs),
//   and an allowlist of content types.
// - GET by default. POST (P3-03, calls to an AI provider) sends a JSON body and never follows a
//   redirect: a provider that redirects is refused rather than having the body replayed elsewhere.
// Every refusal is a FetchBlocked with a stable reason; nothing here throws the URL or body back.
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { PUBLIC_ONLY } from './address-policy.ts';
import type { AddressPolicy } from './address-policy.ts';

export type FetchBlockReason =
  | 'invalid_url'
  | 'scheme'
  | 'port'
  | 'credentials'
  | 'address'
  | 'dns'
  | 'redirect_limit'
  | 'redirect_invalid'
  | 'too_large'
  | 'timeout'
  | 'content_type'
  | 'network';

export class FetchBlocked extends Error {
  readonly reason: FetchBlockReason;
  constructor(reason: FetchBlockReason) {
    super(`fetch refused: ${reason}`);
    this.name = 'FetchBlocked';
    this.reason = reason;
  }
}

export interface Resolved {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface SafeFetchOptions {
  /** Body limit in bytes, after decompression. Default 2 MiB. */
  readonly maxBytes?: number;
  /** Deadline for the whole fetch, redirects included. Default 15 s. */
  readonly timeoutMs?: number;
  /** Default 3. */
  readonly maxRedirects?: number;
  /** Lower-case media types accepted for a 200 answer (parameters ignored). Empty: any. */
  readonly contentTypes?: readonly string[];
  /** Extra request headers (e.g. If-None-Match). Host and Connection cannot be set. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly userAgent?: string;
  /** Default GET. POST sends `body` as JSON and refuses redirects. */
  readonly method?: 'GET' | 'POST';
  /** JSON request body for POST; at most 1 MiB once serialised. */
  readonly body?: unknown;
  /**
   * Instead of `body`: bytes sent as they are with this content type (a multipart upload to
   * Telegram, P5-04b). At most 20 MiB.
   */
  readonly rawBody?: { readonly data: Buffer; readonly contentType: string };
  /** Tests only. Production uses PUBLIC_ONLY. */
  readonly policy?: AddressPolicy;
  /** Tests only: replaces DNS. */
  readonly resolve?: (host: string) => Promise<readonly Resolved[]>;
  /** Tests only: an extra trusted CA (PEM) for a local HTTPS server. Production uses the system store. */
  readonly ca?: string;
  /** Tests only: ports allowed per scheme. Default http 80, https 443. */
  readonly ports?: { readonly 'http:': readonly number[]; readonly 'https:': readonly number[] };
}

export interface SafeResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  /** The URL that answered, after redirects. */
  readonly url: string;
  readonly redirects: number;
}

export const DEFAULT_USER_AGENT = 'NALARA-Ingest/1.0 (+https://nalara.media/tentang)';
const DEFAULT_PORTS = { 'http:': [80], 'https:': [443] } as const;

async function systemResolve(host: string): Promise<readonly Resolved[]> {
  const results = await dnsLookup(host, { all: true, order: 'verbatim' });
  return results.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
}

interface Target {
  readonly url: URL;
  readonly host: string;
  readonly port: number;
  readonly address: Resolved;
}

function checkUrl(raw: string, options: SafeFetchOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlocked('invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchBlocked('scheme');
  if (url.username !== '' || url.password !== '') throw new FetchBlocked('credentials');
  const ports = (options.ports ?? DEFAULT_PORTS)[url.protocol];
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!ports.includes(port)) throw new FetchBlocked('port');
  return url;
}

async function resolveTarget(url: URL, options: SafeFetchOptions): Promise<Target> {
  const policy = options.policy ?? PUBLIC_ONLY;
  // URL keeps IPv6 literals in brackets.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  const family = isIP(host);
  let addresses: readonly Resolved[];
  if (family !== 0) {
    addresses = [{ address: host, family: family === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await (options.resolve ?? systemResolve)(host);
    } catch {
      throw new FetchBlocked('dns');
    }
  }
  if (addresses.length === 0) throw new FetchBlocked('dns');
  // Every address must be allowed: a mixed answer is how rebinding and split DNS sneak in.
  if (!addresses.every((entry) => policy.allows(entry.address))) {
    throw new FetchBlocked('address');
  }
  const [first] = addresses;
  if (first === undefined) throw new FetchBlocked('dns');
  return { url, host, port, address: first };
}

function decoded(response: http.IncomingMessage): Readable {
  const encoding = (response.headers['content-encoding'] ?? '').toLowerCase().trim();
  if (encoding === 'gzip' || encoding === 'x-gzip') return response.pipe(createGunzip());
  if (encoding === 'deflate') return response.pipe(createInflate());
  if (encoding === 'br') return response.pipe(createBrotliDecompress());
  return response;
}

function flatHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

const FORBIDDEN_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding']);

function request(
  target: Target,
  options: SafeFetchOptions,
  signal: AbortSignal,
  payload: Buffer | null,
): Promise<{ response: http.IncomingMessage; request: http.ClientRequest }> {
  // Hand Node the address we already checked: no second DNS lookup can change it.
  const pinned: LookupFunction = (_host, lookupOptions, callback) => {
    if (lookupOptions.all === true) {
      callback(null, [{ address: target.address.address, family: target.address.family }]);
    } else {
      callback(null, target.address.address, target.address.family);
    }
  };
  const headers: Record<string, string> = {
    'user-agent': options.userAgent ?? DEFAULT_USER_AGENT,
    accept: '*/*',
    'accept-encoding': 'gzip, deflate, br',
  };
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (!FORBIDDEN_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = value;
  }
  if (payload !== null) {
    headers['content-type'] = options.rawBody?.contentType ?? 'application/json';
    headers['content-length'] = String(payload.length);
  }
  const client = target.url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: target.url.protocol,
        hostname: target.host,
        port: target.port,
        path: `${target.url.pathname}${target.url.search}`,
        method: payload === null ? 'GET' : 'POST',
        headers,
        lookup: pinned,
        signal,
        // SNI and certificate checks use the real host name, not the address.
        ...(target.url.protocol === 'https:' && isIP(target.host) === 0
          ? { servername: target.host }
          : {}),
        ...(options.ca === undefined ? {} : { ca: options.ca }),
      },
      (response) => {
        resolve({ response, request: req });
      },
    );
    req.on('error', (error) => {
      reject(signal.aborted ? new FetchBlocked('timeout') : error);
    });
    req.end(payload ?? undefined);
  });
}

async function readBody(response: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers['content-length'] ?? 'NaN');
  if (Number.isFinite(declared) && declared > maxBytes && !response.headers['content-encoding']) {
    response.destroy();
    throw new FetchBlocked('too_large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const stream = decoded(response);
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > maxBytes) {
        response.destroy();
        stream.destroy();
        throw new FetchBlocked('too_large');
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof FetchBlocked) throw error;
    throw new FetchBlocked('network');
  }
  return Buffer.concat(chunks);
}

export async function safeFetch(
  raw: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const post = options.method === 'POST';
  const maxRedirects = post ? 0 : (options.maxRedirects ?? 3);
  let payload: Buffer | null = null;
  if (post) {
    if (options.rawBody === undefined) {
      payload = Buffer.from(JSON.stringify(options.body ?? null), 'utf8');
      if (payload.length > 1024 * 1024) throw new FetchBlocked('too_large');
    } else {
      // No CR/LF in a header value: the type is the caller's own constant, but check anyway.
      if (/[\r\n]/.test(options.rawBody.contentType)) throw new FetchBlocked('invalid_url');
      payload = options.rawBody.data;
      if (payload.length > 20 * 1024 * 1024) throw new FetchBlocked('too_large');
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? 15_000);
  try {
    let url = checkUrl(raw, options);
    for (let redirects = 0; ; redirects += 1) {
      const target = await resolveTarget(url, options);
      let response: http.IncomingMessage;
      try {
        ({ response } = await request(target, options, controller.signal, payload));
      } catch (error) {
        if (error instanceof FetchBlocked) throw error;
        throw new FetchBlocked(controller.signal.aborted ? 'timeout' : 'network');
      }
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        const location = response.headers.location;
        if (location === undefined) throw new FetchBlocked('redirect_invalid');
        if (redirects >= maxRedirects) throw new FetchBlocked('redirect_limit');
        let next: string;
        try {
          next = new URL(location, url).toString();
        } catch {
          throw new FetchBlocked('redirect_invalid');
        }
        url = checkUrl(next, options);
        continue;
      }
      if (status === 200 && (options.contentTypes ?? []).length > 0) {
        const type = (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
        if (type === undefined || !(options.contentTypes ?? []).includes(type)) {
          response.resume();
          throw new FetchBlocked('content_type');
        }
      }
      let body: Buffer;
      try {
        body = await readBody(response, maxBytes);
      } catch (error) {
        if (controller.signal.aborted) throw new FetchBlocked('timeout');
        throw error;
      }
      return {
        status,
        headers: flatHeaders(response.headers),
        body,
        url: url.toString(),
        redirects,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
