// robots.txt (P1-08). Before launch, or when the API cannot confirm launch, everything is
// disallowed. After launch the public site is open; /os and /api never are.
import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { siteLaunched } from '../lib/launch';
import { absoluteUrl, siteOrigin } from '../lib/site';

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const origin = siteOrigin();
  if (origin === null || !(await siteLaunched())) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/os', '/api/'] },
    sitemap: absoluteUrl(origin, '/sitemap.xml'),
  };
}
