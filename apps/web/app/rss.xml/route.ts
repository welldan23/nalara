// RSS 2.0 feed of the 30 newest published articles (P1-08). 404 before launch.
import { publicArticles } from '../../lib/public-api';
import { xmlEscape } from '../../lib/xml';
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl, siteOrigin } from '../../lib/site';

export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(): Promise<Response> {
  const origin = siteOrigin();
  if (origin === null) return notFound();
  let latest;
  try {
    latest = await publicArticles({ limit: 30 });
  } catch {
    return new Response('Unavailable', { status: 503 });
  }
  if (latest === null) return notFound();
  const items = latest.articles
    .map((article) => {
      const link = xmlEscape(absoluteUrl(origin, `/artikel/${article.slug}`));
      return [
        '<item>',
        `<title>${xmlEscape(article.title)}</title>`,
        `<link>${link}</link>`,
        `<guid isPermaLink="true">${link}</guid>`,
        `<pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>`,
        `<category>${xmlEscape(article.category.name)}</category>`,
        article.dek === '' ? '' : `<description>${xmlEscape(article.dek)}</description>`,
        '</item>',
      ].join('');
    })
    .join('\n');
  const home = xmlEscape(absoluteUrl(origin, '/'));
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${SITE_NAME}</title>
<link>${home}</link>
<description>${xmlEscape(SITE_DESCRIPTION)}</description>
<language>id</language>
<atom:link href="${xmlEscape(absoluteUrl(origin, '/rss.xml'))}" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>
`;
  return new Response(body, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
