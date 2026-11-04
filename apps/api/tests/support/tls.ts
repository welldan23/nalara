// A throwaway TLS certificate for local HTTPS test servers (P2-07), generated at test time with
// openssl so no private key is ever committed. Valid for the given host names for one day.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function testCertificate(hosts: readonly string[]): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'nalara-tls-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-days',
        '1',
        '-subj',
        `/CN=${hosts[0] ?? 'localhost'}`,
        '-addext',
        `subjectAltName=${hosts.map((host) => `DNS:${host}`).join(',')}`,
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    return {
      key: readFileSync(join(dir, 'key.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
