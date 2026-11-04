// A deliberately small, strict XML parser for RSS/Atom feeds (P2-03). Feeds are hostile input,
// and they need only a sliver of XML, so instead of a general library (and its dependency tree)
// this reads exactly: elements, attributes, text, CDATA, comments, the XML declaration and
// processing instructions, the five predefined entities and numeric character references.
//
// Refused outright: any DOCTYPE (so no external entities / XXE and no entity expansion bombs),
// undeclared entities, unbalanced or mismatched tags, text outside the root, and anything past
// the size, depth and node limits. Namespaces are kept as plain prefixes ("atom:link").

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}
export type XmlNode = XmlElement | string;

export type XmlRule =
  'too_large' | 'doctype' | 'malformed' | 'entity' | 'too_deep' | 'too_many_nodes' | 'no_root';

export class XmlError extends Error {
  readonly rule: XmlRule;
  constructor(rule: XmlRule) {
    super(`xml rejected: ${rule}`);
    this.name = 'XmlError';
    this.rule = rule;
  }
}

export interface XmlLimits {
  readonly maxChars?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

const NAME = /^[A-Za-z_][\w.:-]*$/;
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Not XML, but common in real feeds. Plain replacements: nothing can expand or nest.
  nbsp: '\u00a0',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '\u00ab',
  raquo: '\u00bb',
  copy: '\u00a9',
  reg: '\u00ae',
};

const fail = (rule: XmlRule): never => {
  throw new XmlError(rule);
};

/**
 * Decode the predefined entities, a few common HTML ones and numeric references. Any other named
 * entity is refused: it could only come from a DOCTYPE, which is never processed.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&([^;\s&<]{1,10});|&/g, (_match, name: string | undefined) => {
    // A bare "&" (invalid XML, common in sloppy feeds) stays a literal ampersand.
    if (name === undefined) return '&';
    const key = name;
    const named = ENTITIES[key];
    if (named !== undefined) return named;
    const numeric = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(key);
    if (numeric === null) return fail('entity');
    const code = numeric[1] !== undefined ? parseInt(numeric[1], 16) : Number(numeric[2]);
    // No NUL, surrogates or out-of-range code points.
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail('entity');
    return String.fromCodePoint(code);
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
  const pattern = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"<]*)"|'([^'<]*)')/gy;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (match === null) fail('malformed');
    const [whole = '', name = '', , double, single] = match ?? [];
    if (Object.hasOwn(attributes, name)) fail('malformed');
    attributes[name] = decodeEntities(double ?? single ?? '');
    index += whole.length;
  }
  return attributes;
}

export function parseXml(input: string, limits: XmlLimits = {}): XmlElement {
  const maxChars = limits.maxChars ?? 4 * 1024 * 1024;
  const maxDepth = limits.maxDepth ?? 32;
  const maxNodes = limits.maxNodes ?? 50_000;
  if (input.length > maxChars) fail('too_large');
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input;

  interface Open {
    name: string;
    attributes: Record<string, string>;
    children: XmlNode[];
  }
  const stack: Open[] = [];
  let root: XmlElement | undefined;
  let nodes = 0;
  let position = 0;

  const addChild = (node: XmlNode) => {
    nodes += 1;
    if (nodes > maxNodes) fail('too_many_nodes');
    const parent = stack.at(-1);
    if (parent === undefined) {
      // Outside the root only whitespace is allowed.
      if (typeof node === 'string') {
        if (node.trim() !== '') fail('malformed');
        return;
      }
      if (root !== undefined) fail('malformed');
      root = node;
      return;
    }
    parent.children.push(node);
  };

  while (position < text.length) {
    const lt = text.indexOf('<', position);
    if (lt === -1) {
      addChild(decodeEntities(text.slice(position)));
      break;
    }
    if (lt > position) addChild(decodeEntities(text.slice(position, lt)));

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) fail('malformed');
      position = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1 || stack.length === 0) fail('malformed');
      addChild(text.slice(lt + 9, end));
      position = end + 3;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      // DOCTYPE, ENTITY, ELEMENT…: never processed, always refused.
      fail(/^<!DOCTYPE/i.test(text.slice(lt, lt + 9)) ? 'doctype' : 'malformed');
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) fail('malformed');
      position = end + 2;
      continue;
    }
    const gt = text.indexOf('>', lt + 1);
    if (gt === -1) fail('malformed');
    const raw = text.slice(lt + 1, gt);
    position = gt + 1;

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (open?.name !== name) fail('malformed');
      const element: XmlElement = {
        name: open?.name ?? '',
        attributes: open?.attributes ?? {},
        children: open?.children ?? [],
      };
      addChild(element);
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    const name = nameMatch?.[1] ?? '';
    if (!NAME.test(name)) fail('malformed');
    const attributes = parseAttributes(body.slice(name.length));
    if (selfClosing) {
      addChild({ name, attributes, children: [] });
    } else {
      if (stack.length >= maxDepth) fail('too_deep');
      nodes += 1;
      if (nodes > maxNodes) fail('too_many_nodes');
      stack.push({ name, attributes, children: [] });
    }
  }
  if (stack.length > 0) fail('malformed');
  return root ?? fail('no_root');
}

/** Children elements with this name (namespace prefix included, e.g. "atom:link"). */
export function childElements(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement =>
      typeof child !== 'string' && (name === undefined || child.name === name),
  );
}

export function firstChild(element: XmlElement, ...names: string[]): XmlElement | undefined {
  for (const name of names) {
    const found = childElements(element, name)[0];
    if (found !== undefined) return found;
  }
  return undefined;
}

/** All text inside an element, CDATA included, in document order. */
export function textContent(element: XmlElement): string {
  return element.children
    .map((child) => (typeof child === 'string' ? child : textContent(child)))
    .join('');
}
