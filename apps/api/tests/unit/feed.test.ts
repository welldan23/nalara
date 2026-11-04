// P2-03 feed parsing: the strict XML reader refuses DOCTYPE/entities (XXE, billion laughs),
// malformed and oversized input; RSS 2.0, RSS 1.0 and Atom become plain-text items with
// canonical http(s) links. Feeds are hostile input: nothing here may come out as HTML.
import { describe, expect, it } from 'vitest';
import { FeedError, canonicalUrl, htmlToText, parseFeed } from '../../src/modules/feeds/feed.ts';
import { XmlError, decodeEntities, parseXml, textContent } from '../../src/modules/feeds/xml.ts';

const FEED_URL = 'https://www.bps.go.id/id/pressrelease/feed';
const feed = (xml: string) => parseFeed(Buffer.from(xml, 'utf8'), FEED_URL);
const rule = (fn: () => unknown) => {
  try {
    fn();
    return 'no error';
  } catch (error) {
    return error instanceof XmlError || error instanceof FeedError ? error.rule : String(error);
  }
};

describe('strict XML', () => {
  it('reads elements, attributes, text, CDATA and character references', () => {
    const root = parseXml(
      '<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b>t&#233;&#x41;</b><c><![CDATA[<i>raw</i>]]></c><d/></a>',
    );
    expect(root.name).toBe('a');
    expect(root.attributes).toEqual({ x: '1 & 2' });
    expect(textContent(root)).toBe('téA<i>raw</i>');
  });

  it.each([
    ['<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>', 'doctype'],
    ['<!DOCTYPE a [<!ENTITY l "lol"><!ENTITY l2 "&l;&l;&l;">]><a>&l2;</a>', 'doctype'],
    ['<a>&undefined;</a>', 'entity'],
    ['<a>&#0;</a>', 'entity'],
    ['<a>&#xD800;</a>', 'entity'],
    ['<a><b></a>', 'malformed'],
    ['<a></b>', 'malformed'],
    ['<a>', 'malformed'],
    ['<a x="1" x="2"/>', 'malformed'],
    ['<a x=1/>', 'malformed'],
    ['<a/><b/>', 'malformed'],
    ['text<a/>', 'malformed'],
    ['', 'no_root'],
  ])('refuses %s → %s', (xml, expected) => {
    expect(rule(() => parseXml(xml))).toBe(expected);
  });

  it('enforces depth, node and size limits', () => {
    expect(rule(() => parseXml(`${'<a>'.repeat(40)}${'</a>'.repeat(40)}`))).toBe('too_deep');
    expect(rule(() => parseXml(`<a>${'<b/>'.repeat(60_000)}</a>`))).toBe('too_many_nodes');
    expect(rule(() => parseXml(`<a>${'x'.repeat(100)}</a>`, { maxChars: 50 }))).toBe('too_large');
  });

  it('keeps a bare ampersand literal and knows common HTML entities', () => {
    expect(decodeEntities('AT&T &nbsp;&mdash;')).toBe('AT&T  —');
  });

  it('does not let attribute names reach Object.prototype', () => {
    const root = parseXml('<a __proto__="x" constructor="y"/>');
    expect(Object.getPrototypeOf(root.attributes)).toBeNull();
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });
});

describe('canonicalUrl and htmlToText', () => {
  it('keeps http(s) only, resolves relative links, drops fragments and trackers', () => {
    expect(
      canonicalUrl('/id/brs/1?utm_source=x&id=7&fbclid=abc#top', 'https://WWW.BPS.go.id/feed'),
    ).toBe('https://www.bps.go.id/id/brs/1?id=7');
    expect(canonicalUrl('https://bi.go.id/a?utm_medium=rss')).toBe('https://bi.go.id/a');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>',
      'ftp://x.test/a',
      'https://u:p@x.test/',
      '',
    ]) {
      expect(canonicalUrl(bad, FEED_URL), bad).toBeNull();
    }
  });

  it('turns description HTML into one line of plain text, without scripts', () => {
    expect(
      htmlToText(
        '<p>Inflasi <b>2,8%</b>&nbsp;yoy</p><script>steal()</script><style>x{}</style><!-- c --><img src=x onerror=alert(1)>',
        500,
      ),
    ).toBe('Inflasi 2,8% yoy');
    expect(htmlToText('a'.repeat(600), 500)).toHaveLength(500);
    expect(htmlToText('x\u0007y\u0000z', 50)).toBe('xyz');
  });
});

describe('parseFeed', () => {
  it('reads RSS 2.0 items with plain-text summaries and canonical links', () => {
    const parsed = feed(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0"><channel><title>BPS &#8211; Berita Resmi</title>
        <item>
          <title>Inflasi Oktober 2026</title>
          <link>https://www.bps.go.id/id/pressrelease/2026/11/01/inflasi.html?utm_source=rss</link>
          <guid isPermaLink="false">brs-2026-11-01</guid>
          <pubDate>Sun, 01 Nov 2026 03:00:00 GMT</pubDate>
          <description><![CDATA[<p>Inflasi <script>alert(1)</script>tahunan 2,8 persen.</p>]]></description>
        </item>
        <item><title>Tanpa tautan</title></item>
        <item><title>Tautan berbahaya</title><link>javascript:alert(1)</link></item>
        <item><title>Relatif</title><link>/id/brs/2</link></item>
      </channel></rss>`);
    expect(parsed.format).toBe('rss');
    expect(parsed.title).toBe('BPS – Berita Resmi');
    expect(parsed.items).toEqual([
      {
        title: 'Inflasi Oktober 2026',
        url: 'https://www.bps.go.id/id/pressrelease/2026/11/01/inflasi.html',
        canonicalUrl: 'https://www.bps.go.id/id/pressrelease/2026/11/01/inflasi.html',
        guid: 'brs-2026-11-01',
        publishedAt: new Date('2026-11-01T03:00:00Z'),
        summary: 'Inflasi tahunan 2,8 persen.',
      },
      expect.objectContaining({ title: 'Relatif', url: 'https://www.bps.go.id/id/brs/2' }),
    ]);
  });

  it('reads Atom (alternate link, id, published) and RSS 1.0', () => {
    const atom = feed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>BI</title>
      <entry><title type="html">Suku &lt;b&gt;bunga&lt;/b&gt;</title>
        <link rel="self" href="https://bi.go.id/self"/><link rel="alternate" href="https://bi.go.id/siaran/1"/>
        <id>tag:bi.go.id,2026:1</id><published>2026-11-02T07:00:00+07:00</published>
        <summary>Ringkas.</summary></entry></feed>`);
    expect(atom).toMatchObject({
      format: 'atom',
      title: 'BI',
      items: [
        {
          title: 'Suku bunga',
          url: 'https://bi.go.id/siaran/1',
          guid: 'tag:bi.go.id,2026:1',
          publishedAt: new Date('2026-11-02T00:00:00Z'),
          summary: 'Ringkas.',
        },
      ],
    });
    const rdf =
      feed(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel rdf:about="x"><title>OJK</title></channel>
      <item rdf:about="https://ojk.go.id/a"><title>Aturan baru</title><link>https://ojk.go.id/a</link><dc:date>2026-11-03</dc:date></item>
      </rdf:RDF>`);
    expect(rdf).toMatchObject({
      format: 'rdf',
      title: 'OJK',
      items: [
        { title: 'Aturan baru', guid: 'https://ojk.go.id/a', publishedAt: new Date('2026-11-03') },
      ],
    });
  });

  it('caps the number of items and refuses non-feeds, HTML pages and bad encodings', () => {
    const many = `<rss><channel><title>x</title>${Array.from(
      { length: 250 },
      (_, index) =>
        `<item><title>T${String(index)}</title><link>https://x.test/${String(index)}</link></item>`,
    ).join('')}</channel></rss>`;
    expect(feed(many).items).toHaveLength(200);
    expect(rule(() => feed('<html><body>Not a feed</body></html>'))).toBe('not_a_feed');
    expect(rule(() => feed('<rss></rss>'))).toBe('not_a_feed');
    expect(rule(() => feed('<!DOCTYPE rss><rss/>'))).toBe('xml_doctype');
    expect(
      rule(() => parseFeed(Buffer.from('<?xml version="1.0" encoding="UTF-7"?><rss/>'), FEED_URL)),
    ).toBe('encoding');
    expect(rule(() => parseFeed(Buffer.from([0x3c, 0x61, 0x3e, 0xff, 0xfe, 0x3c]), FEED_URL))).toBe(
      'encoding',
    );
  });

  it('decodes a declared Latin-1 feed and skips a UTF-8 byte order mark', () => {
    const latin = Buffer.concat([
      Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><title>Caf'),
      Buffer.from([0xe9]),
      Buffer.from('</title></channel></rss>'),
    ]);
    expect(parseFeed(latin, FEED_URL).title).toBe('Café');
    const bom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(
        '<?xml version="1.0" encoding="utf-8"?><rss><channel><title>ok</title></channel></rss>',
      ),
    ]);
    expect(parseFeed(bom, FEED_URL).title).toBe('ok');
  });
});
