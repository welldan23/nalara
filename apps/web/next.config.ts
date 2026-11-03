import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
