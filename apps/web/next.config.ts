import { join } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Private founder pages are never indexed, even if a link leaks (P1-08).
  headers() {
    return Promise.resolve(
      ['/os', '/os/:path*'].map((source) => ({
        source,
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
      })),
    );
  },
  // Self-contained server for the Docker image (P0-012); trace files from the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: join(process.cwd(), '..', '..'),
  // Local development without the reverse proxy: forward same-origin /api calls to the API.
  // In production Caddy routes /api/* to the API before requests reach Next.js (ADR-006).
  rewrites() {
    const api = process.env['API_BASE_URL'];
    return Promise.resolve(
      api === undefined ? [] : [{ source: '/api/:path*', destination: `${api}/api/:path*` }],
    );
  },
};

export default nextConfig;
