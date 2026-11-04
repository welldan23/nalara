// P2-01 safe fetch: the SSRF tests of PRD v4 §11 (loopback, private ranges, cloud metadata,
// redirect to private, DNS rebinding) plus scheme, port, size, time and type limits. A local
// HTTP server plays the outside world; a fake resolver plays DNS.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_ONLY, onlyAddresses } from '../../src/modules/fetch/address-policy.ts';
import { FetchBlocked, safeFetch } from '../../src/modules/fetch/safe-fetch.ts';
import type { SafeFetchOptions } from '../../src/modules/fetch/safe-fetch.ts';

let server: Server;
let port = 0;
const seen: {
  host: string | undefined;
  path: string | undefined;
  headers: IncomingMessage['headers'];
}[] = [];

const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
  '/feed': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8', etag: '"v1"' });
    res.end('<rss><channel><title>ok</title></channel></rss>');
  },
  '/html': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html></html>');
  },
  '/big': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(Buffer.alloc(3 * 1024 * 1024, 0x61));
  },
  '/bomb': (_req, res) => {
    // 64 KiB on the wire, 20 MiB once decompressed.
    res.writeHead(200, { 'content-type': 'application/xml', 'content-encoding': 'gzip' });
    res.end(gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x61)));
  },
  '/gzip': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/xml', 'content-encoding': 'gzip' });
    res.end(gzipSync(Buffer.from('<rss/>')));
  },
  '/slow': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.write('<rss>');
    // never ends
  },
  '/not-modified': (req, res) => {
    res.writeHead(req.headers['if-none-match'] === '"v1"' ? 304 : 200, {
      'content-type': 'application/xml',
    });
    res.end();
  },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ host: req.headers.host, path: req.url, headers: req.headers });
    const path = req.url?.split('?')[0] ?? '';
    const redirect = /^\/redirect\/(\d+)$/.exec(path);
    if (redirect !== null) {
      const hops = Number(redirect[1]);
      res.writeHead(302, { location: hops > 0 ? `/redirect/${String(hops - 1)}` : '/feed' });
      res.end();
      return;
    }
    if (path === '/to-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    if (path === '/to-private-name') {
      res.writeHead(301, { location: `http://internal.test:${String(port)}/feed` });
      res.end();
      return;
    }
    if (path === '/to-file') {
      res.writeHead(302, { location: 'file:///etc/passwd' });
      res.end();
      return;
    }
    const route = routes[path];
    if (route === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    route(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

// The test world: "feed.test" is our local server, "internal.test" is a private address,
// "rebind.test" answers with a public and a private address at once.
const DNS: Record<string, { address: string; family: 4 | 6 }[]> = {
  'feed.test': [{ address: '127.0.0.1', family: 4 }],
  'internal.test': [{ address: '10.0.0.5', family: 4 }],
  'rebind.test': [
    { address: '127.0.0.1', family: 4 },
    { address: '192.168.1.1', family: 4 },
  ],
};
const local = (overrides: SafeFetchOptions = {}): SafeFetchOptions => ({
  policy: onlyAddresses(['127.0.0.1']),
  resolve: (host) => {
    const answer = DNS[host];
    return answer === undefined ? Promise.reject(new Error('NXDOMAIN')) : Promise.resolve(answer);
  },
  // Port 80 too, so redirects to well-known internal targets reach the address check.
  ports: { 'http:': [port, 80], 'https:': [443] },
  timeoutMs: 2_000,
  ...overrides,
});
const url = (path: string, host = 'feed.test') => `http://${host}:${String(port)}${path}`;
const reason = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'no error';
  } catch (error) {
    return error instanceof FetchBlocked ? error.reason : `unexpected: ${String(error)}`;
  }
};

describe('address policy (default: public only)', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.250.10', // the Compose frontend network
    '192.168.0.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '64:ff9b::a00:1', // NAT64 of 10.0.0.1
    '2002:a00:1::1', // 6to4 of 10.0.0.1
    'ff02::1',
    'not-an-ip',
  ])('refuses %s', (address) => {
    expect(PUBLIC_ONLY.allows(address)).toBe(false);
  });

  it.each(['93.184.215.14', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001::1'])(
    'allows public %s',
    (address) => {
      expect(PUBLIC_ONLY.allows(address)).toBe(true);
    },
  );
});

describe('safeFetch', () => {
  it('fetches through the checked address with the real Host header', async () => {
    const response = await safeFetch(
      url('/feed'),
      local({ contentTypes: ['application/rss+xml'] }),
    );
    expect(response.status).toBe(200);
    expect(response.body.toString()).toContain('<rss>');
    expect(response.headers['etag']).toBe('"v1"');
    expect(seen.at(-1)?.host).toBe(`feed.test:${String(port)}`);
    expect(seen.at(-1)?.headers['user-agent']).toMatch(/^NALARA-Ingest\//);
  });

  it('refuses loopback, private and metadata addresses with the default policy (no connection)', async () => {
    const before = seen.length;
    for (const target of [
      'http://127.0.0.1/',
      'http://localhost/',
      'http://[::1]/',
      'http://0.0.0.0/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/',
      'http://2130706433/', // 127.0.0.1 as a decimal
      'http://0x7f.1/', // 127.0.0.1 in hex
      'http://0177.0.0.1/', // 127.0.0.1 in octal
      'http://[::ffff:7f00:1]/',
    ]) {
      // Real DNS for "localhost"; the rest are IP literals.
      expect(await reason(safeFetch(target, { timeoutMs: 2_000 })), target).toBe('address');
    }
    expect(seen.length).toBe(before);
  });

  it('refuses a host whose DNS answer includes any private address (rebinding)', async () => {
    expect(await reason(safeFetch(url('/feed', 'rebind.test'), local()))).toBe('address');
    expect(await reason(safeFetch(url('/feed', 'internal.test'), local()))).toBe('address');
    expect(await reason(safeFetch(url('/feed', 'missing.test'), local()))).toBe('dns');
  });

  it('checks every redirect hop again', async () => {
    expect(await reason(safeFetch(url('/to-metadata'), local()))).toBe('address');
    expect(await reason(safeFetch(url('/to-private-name'), local()))).toBe('address');
    expect(await reason(safeFetch(url('/to-file'), local()))).toBe('scheme');
    const followed = await safeFetch(url('/redirect/2'), local());
    expect(followed).toMatchObject({ status: 200, redirects: 3 });
    expect(await reason(safeFetch(url('/redirect/3'), local()))).toBe('redirect_limit');
  });

  it('refuses other schemes, ports and credentials before connecting', async () => {
    for (const [target, why] of [
      ['ftp://feed.test/feed', 'scheme'],
      ['file:///etc/passwd', 'scheme'],
      ['gopher://feed.test:70/', 'scheme'],
      ['http://feed.test:8080/feed', 'port'],
      ['https://feed.test:8443/feed', 'port'],
      [`http://user:pass@feed.test:${String(port)}/feed`, 'credentials'],
      ['not a url', 'invalid_url'],
    ]) {
      expect(await reason(safeFetch(target ?? '', local())), target).toBe(why);
    }
    // Default ports are 80/443 only.
    expect(await reason(safeFetch('http://93.184.215.14:8080/'))).toBe('port');
  });

  it('enforces the byte limit, also after decompression, and the deadline', async () => {
    expect(await reason(safeFetch(url('/big'), local()))).toBe('too_large');
    expect(await reason(safeFetch(url('/bomb'), local()))).toBe('too_large');
    expect((await safeFetch(url('/gzip'), local())).body.toString()).toBe('<rss/>');
    const started = Date.now();
    expect(await reason(safeFetch(url('/slow'), local({ timeoutMs: 300 })))).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('enforces the content-type allowlist and passes conditional headers', async () => {
    expect(
      await reason(safeFetch(url('/html'), local({ contentTypes: ['application/rss+xml'] }))),
    ).toBe('content_type');
    const notModified = await safeFetch(
      url('/not-modified'),
      local({ headers: { 'If-None-Match': '"v1"', Host: 'evil.test' } }),
    );
    expect(notModified.status).toBe(304);
    // A caller cannot override Host.
    expect(seen.at(-1)?.host).toBe(`feed.test:${String(port)}`);
  });
});
