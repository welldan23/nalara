// RSS 2.0, RSS 1.0 (RDF) and Atom → a flat list of items (P2-03). Only what the inbox needs:
// title, link to the original publisher, a stable id, the publication time and a short plain-text
// summary. All HTML is removed; links must be absolute http(s) without credentials; tracking
// parameters are dropped so the same story is recognised by its canonical URL (P2-04 dedup).
import { XmlError, childElements, firstChild, parseXml, textContent } from './xml.ts';
import type { XmlElement } from './xml.ts';

export const MAX_ITEMS = 200;
export const MAX_TITLE = 300;
export const MAX_SUMMARY = 500;

export interface FeedItem {
  readonly title: string;
  readonly url: string;
  readonly canonicalUrl: string;
  /** Publisher's own id (guid / id / rdf:about), or the canonical URL. */
  readonly guid: string;
  readonly publishedAt: Date | null;
  readonly summary: string;
}

export interface Feed {
  readonly format: 'rss' | 'atom' | 'rdf';
  readonly title: string;
  readonly items: readonly FeedItem[];
}

export type FeedRule = 'not_a_feed' | 'encoding' | `xml_${string}`;

export class FeedError extends Error {
  readonly rule: FeedRule;
  constructor(rule: FeedRule) {
    super(`feed rejected: ${rule}`);
    this.name = 'FeedError';
    this.rule = rule;
  }
}

const TRACKING =
  /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|yclid)$/i;

/** Absolute http(s) URL without credentials, fragment or tracking parameters, or null. */
export function canonicalUrl(raw: string, base?: string): string | null {
  // An empty link would resolve to the feed's own URL: it means "no link", not "the feed".
  if (raw.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  if (url.search === '?') url.search = '';
  return url.toString();
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** HTML (as feeds put it in descriptions) → one line of plain text. Never rendered as HTML. */
export function htmlToText(html: string, max: number): string {
  const text = html
    .replace(/<(script|style|noscript|iframe|object|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (match, ref: string) => {
      const lower = ref.toLowerCase();
      if (lower.startsWith('#')) {
        const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : Number(lower.slice(1));
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : ' ';
      }
      return HTML_ENTITIES[lower] ?? match;
    })
    // Control characters (except whitespace) out, whitespace collapsed.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') // eslint-disable-line no-control-regex -- removing them is the point
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function decode(bytes: Buffer): string {
  // A UTF-8 byte order mark is skipped; the XML declaration names any other encoding.
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const head = bytes.subarray(bom, bom + 200).toString('latin1');
  const declared = /^<\?xml[^>]*encoding=["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1];
  const encoding = (declared ?? 'utf-8').toLowerCase();
  const supported: Readonly<Record<string, string>> = {
    'utf-8': 'utf-8',
    utf8: 'utf-8',
    'iso-8859-1': 'windows-1252',
    latin1: 'windows-1252',
    'windows-1252': 'windows-1252',
    'us-ascii': 'utf-8',
  };
  const label = supported[encoding];
  if (label === undefined) throw new FeedError('encoding');
  try {
    return new TextDecoder(label, { fatal: label === 'utf-8' }).decode(bytes.subarray(bom));
  } catch {
    throw new FeedError('encoding');
  }
}

function date(element: XmlElement, ...names: string[]): Date | null {
  for (const name of names) {
    const found = firstChild(element, name);
    if (found === undefined) continue;
    const value = new Date(textContent(found).trim());
    if (!Number.isNaN(value.getTime())) return value;
  }
  return null;
}

function text(element: XmlElement, max: number, ...names: string[]): string {
  const found = firstChild(element, ...names);
  return found === undefined ? '' : htmlToText(textContent(found), max);
}

function atomLink(entry: XmlElement): string | undefined {
  const links = childElements(entry, 'link');
  const alternate =
    links.find((link) => (link.attributes['rel'] ?? 'alternate') === 'alternate') ?? links[0];
  return alternate?.attributes['href'];
}

function item(
  element: XmlElement,
  base: string,
  fields: { readonly link: string | undefined; readonly id: string | undefined },
): FeedItem | null {
  const url = fields.link === undefined ? null : canonicalUrl(fields.link, base);
  if (url === null) return null; // no usable link to the original: useless in the inbox
  const title = text(element, MAX_TITLE, 'title');
  if (title === '') return null;
  const guid = (fields.id ?? '').trim().slice(0, 500) || url;
  return {
    title,
    url,
    canonicalUrl: url,
    guid,
    publishedAt: date(element, 'pubDate', 'published', 'updated', 'dc:date'),
    summary: text(element, MAX_SUMMARY, 'description', 'summary', 'content'),
  };
}

/** Parse a fetched feed. `feedUrl` resolves relative links. Throws FeedError. */
export function parseFeed(bytes: Buffer, feedUrl: string): Feed {
  let root: XmlElement;
  try {
    root = parseXml(decode(bytes));
  } catch (error) {
    if (error instanceof XmlError) throw new FeedError(`xml_${error.rule}`);
    throw error;
  }
  const items: FeedItem[] = [];
  const push = (value: FeedItem | null) => {
    if (value !== null && items.length < MAX_ITEMS) items.push(value);
  };

  if (root.name === 'rss') {
    const channel = firstChild(root, 'channel');
    if (channel === undefined) throw new FeedError('not_a_feed');
    for (const entry of childElements(channel, 'item')) {
      const guid = firstChild(entry, 'guid');
      const link = firstChild(entry, 'link');
      push(
        item(entry, feedUrl, {
          link: link === undefined ? undefined : textContent(link),
          id: guid === undefined ? undefined : textContent(guid),
        }),
      );
    }
    return { format: 'rss', title: text(channel, MAX_TITLE, 'title'), items };
  }
  if (root.name === 'feed' || root.name.endsWith(':feed')) {
    for (const entry of childElements(root, 'entry')) {
      const id = firstChild(entry, 'id');
      push(
        item(entry, feedUrl, {
          link: atomLink(entry),
          id: id === undefined ? undefined : textContent(id),
        }),
      );
    }
    return { format: 'atom', title: text(root, MAX_TITLE, 'title'), items };
  }
  if (root.name === 'rdf:RDF') {
    const channel = firstChild(root, 'channel');
    for (const entry of childElements(root, 'item')) {
      const link = firstChild(entry, 'link');
      push(
        item(entry, feedUrl, {
          link: link === undefined ? undefined : textContent(link),
          id: entry.attributes['rdf:about'],
        }),
      );
    }
    return {
      format: 'rdf',
      title: channel === undefined ? '' : text(channel, MAX_TITLE, 'title'),
      items,
    };
  }
  throw new FeedError('not_a_feed');
}
