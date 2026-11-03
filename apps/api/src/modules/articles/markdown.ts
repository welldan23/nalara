// Restricted Markdown → content blocks (ADR-011, P1-02). Deliberately small: only what an
// explainer article needs. Anything else (HTML, images, code, tables) is refused with the line
// number, instead of being passed through or silently dropped.
//
//   ## Heading / ### Subheading
//   paragraph text, **bold**, *italic* or _italic_, [link text](https://…)
//   - item / * item       (unordered list)
//   1. item               (ordered list)
//   > quoted text
//   > — Name, role        (attribution, required as the last quote line)
//   :::angka              (a checkable number, P1-04; every field required)
//   nilai: 2,8
//   satuan: persen (yoy)
//   periode: Oktober 2026
//   label: Inflasi tahunan
//   sumber: 1             (number of the citation in the article's source list)
//   :::
import type { Block } from './content.ts';

export type ParseRule =
  | 'h1_not_allowed'
  | 'html_not_supported'
  | 'image_not_supported'
  | 'code_not_supported'
  | 'table_not_supported'
  | 'link_must_be_https'
  | 'link_malformed'
  | 'quote_needs_attribution'
  | 'empty_heading'
  | 'too_many_blocks'
  | 'stat_unclosed'
  | 'stat_field_missing'
  | 'stat_field_unknown'
  | 'stat_source_unknown';

export interface ParseIssue {
  readonly line: number;
  readonly rule: ParseRule;
}

export interface ParseResult {
  readonly blocks: Block[];
  readonly issues: ParseIssue[];
}

type Inline = Extract<Block, { type: 'paragraph' }>['content'][number];

const MAX_BLOCKS = 500;
const HTML_TAG = /<\/?[a-zA-Z!][^>]*>/;

class InlineError extends Error {
  readonly rule: ParseRule;

  constructor(rule: ParseRule) {
    super(rule);
    this.rule = rule;
  }
}

function pushText(out: Inline[], text: string, bold: boolean, italic: boolean): void {
  if (text === '') return;
  const last = out.at(-1);
  if (last?.type === 'text' && (last.bold ?? false) === bold && (last.italic ?? false) === italic) {
    out[out.length - 1] = { ...last, text: last.text + text };
    return;
  }
  out.push({
    type: 'text',
    text,
    ...(bold ? { bold: true } : {}),
    ...(italic ? { italic: true } : {}),
  });
}

// Inline spans: **bold**, *italic* or _italic_, [text](https://url). Unclosed markers stay text.
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let index = 0;
  let bold = false;
  let italic = false;
  let buffer = '';
  const flush = () => {
    pushText(out, buffer, bold, italic);
    buffer = '';
  };

  while (index < source.length) {
    const rest = source.slice(index);
    if (rest.startsWith('**')) {
      if (bold || source.includes('**', index + 2)) {
        flush();
        bold = !bold;
      } else {
        // Unclosed: both asterisks are literal, never two italic markers.
        buffer += '**';
      }
      index += 2;
      continue;
    }
    const char = source[index] ?? '';
    if ((char === '*' || char === '_') && (italic || source.includes(char, index + 1))) {
      // `_` inside a word (snake_case) is literal text.
      const prev = source[index - 1] ?? ' ';
      if (char === '_' && /\w/.test(prev) && !italic) {
        buffer += char;
        index += 1;
        continue;
      }
      flush();
      italic = !italic;
      index += 1;
      continue;
    }
    if (char === '[') {
      const link = /^\[([^\]\n]+)\]\(([^)\s]*)\)/.exec(rest);
      if (link !== null) {
        const [whole, text = '', href = ''] = link;
        let url: URL;
        try {
          url = new URL(href);
        } catch {
          throw new InlineError('link_malformed');
        }
        if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
          throw new InlineError('link_must_be_https');
        }
        flush();
        out.push({ type: 'link', text, href });
        index += whole.length;
        continue;
      }
    }
    buffer += char;
    index += 1;
  }
  flush();
  return out;
}

const STAT_FIELDS = {
  nilai: 'value',
  satuan: 'unit',
  periode: 'period',
  label: 'label',
  sumber: 'source',
} as const;

export interface ParseOptions {
  /** Citation ids in list order; `sumber: N` refers to the N-th (1-based). */
  readonly citationIds?: readonly string[];
}

/** Parse the editor source. Blocks are separated by blank lines or by a change of block type. */
export function parseMarkdown(source: string, options: ParseOptions = {}): ParseResult {
  const citationIds = options.citationIds ?? [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const issues: ParseIssue[] = [];
  let index = 0;

  const inline = (text: string, line: number): Inline[] | null => {
    try {
      const content = parseInline(text.trim());
      return content.length > 0 ? content : null;
    } catch (error) {
      if (error instanceof InlineError) issues.push({ line, rule: error.rule });
      else throw error;
      return null;
    }
  };

  const lineIssue = (text: string): ParseRule | null => {
    if (/^\s*```/.test(text) || /^( {4}|\t)\S/.test(text)) return 'code_not_supported';
    if (/!\[[^\]]*\]\(/.test(text)) return 'image_not_supported';
    if (HTML_TAG.test(text)) return 'html_not_supported';
    if (/^\s*\|.*\|\s*$/.test(text)) return 'table_not_supported';
    if (/^#\s/.test(text) || text.trim() === '#') return 'h1_not_allowed';
    return null;
  };

  while (index < lines.length) {
    const raw = lines[index] ?? '';
    const lineNo = index + 1;
    if (raw.trim() === '') {
      index += 1;
      continue;
    }
    const problem = lineIssue(raw);
    if (problem !== null) {
      issues.push({ line: lineNo, rule: problem });
      index += 1;
      continue;
    }

    if (raw.trim() === ':::angka') {
      const start = lineNo;
      const fields: Partial<Record<(typeof STAT_FIELDS)[keyof typeof STAT_FIELDS], string>> = {};
      let closed = false;
      let broken = false;
      index += 1;
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim();
        index += 1;
        if (current === ':::') {
          closed = true;
          break;
        }
        if (current === '') continue;
        const match = /^([a-z]+)\s*:\s*(.*)$/.exec(current);
        const key = match?.[1] as keyof typeof STAT_FIELDS | undefined;
        if (match === null || key === undefined || !(key in STAT_FIELDS)) {
          issues.push({ line: index, rule: 'stat_field_unknown' });
          broken = true;
          continue;
        }
        const bad = lineIssue(current);
        if (bad !== null) {
          issues.push({ line: index, rule: bad });
          broken = true;
          continue;
        }
        fields[STAT_FIELDS[key]] = (match[2] ?? '').trim();
      }
      if (!closed) {
        issues.push({ line: start, rule: 'stat_unclosed' });
        continue;
      }
      if (broken) continue;
      const { value, unit, period, label, source: sourceRef } = fields;
      if (!value || !unit || !period || !label || !sourceRef) {
        issues.push({ line: start, rule: 'stat_field_missing' });
        continue;
      }
      const citationId = /^\d+$/.test(sourceRef) ? citationIds[Number(sourceRef) - 1] : undefined;
      if (citationId === undefined) {
        issues.push({ line: start, rule: 'stat_source_unknown' });
        continue;
      }
      blocks.push({ type: 'stat', value, unit, period, label, citationId });
      continue;
    }

    const heading = /^(#{2,3})\s+(.*)$/.exec(raw);
    if (heading !== null) {
      const [, hashes = '##', text = ''] = heading;
      if (text.trim() === '') issues.push({ line: lineNo, rule: 'empty_heading' });
      else {
        const content = inline(text, lineNo);
        if (content !== null)
          blocks.push({ type: 'heading', level: hashes.length === 2 ? 2 : 3, content });
      }
      index += 1;
      continue;
    }

    const listMatch = (text: string) => /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(text);
    const first = listMatch(raw);
    if (first !== null) {
      const ordered = first[2] !== undefined;
      const items: Inline[][] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const match = listMatch(current);
        if (match === null || (match[2] !== undefined) !== ordered) break;
        const bad = lineIssue(current);
        if (bad !== null) issues.push({ line: index + 1, rule: bad });
        else {
          const content = inline(match[3] ?? '', index + 1);
          if (content !== null) items.push(content);
        }
        index += 1;
      }
      if (items.length > 0) blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (/^>\s?/.test(raw)) {
      const start = lineNo;
      const quoteLines: { text: string; line: number }[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quoteLines.push({ text: (lines[index] ?? '').replace(/^>\s?/, ''), line: index + 1 });
        index += 1;
      }
      const last = quoteLines.at(-1);
      const attribution = last === undefined ? null : /^(?:—|--)\s*(.+)$/.exec(last.text.trim());
      if (attribution === null || quoteLines.length < 2) {
        issues.push({ line: start, rule: 'quote_needs_attribution' });
        continue;
      }
      const body = quoteLines
        .slice(0, -1)
        .map((item) => item.text)
        .join(' ');
      const bad = quoteLines
        .map((item) => lineIssue(item.text))
        .find((rule): rule is ParseRule => rule !== null);
      if (bad !== undefined) {
        issues.push({ line: start, rule: bad });
        continue;
      }
      const content = inline(body, start);
      if (content !== null) {
        blocks.push({ type: 'quote', content, attribution: (attribution[1] ?? '').trim() });
      }
      continue;
    }

    // Paragraph: consecutive lines until a blank line or another block starts.
    const start = lineNo;
    const parts: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim() === '' || /^(#{1,3}\s|>|\s*(?:[-*]|\d+\.)\s)/.test(current)) break;
      const bad = lineIssue(current);
      if (bad !== null) issues.push({ line: index + 1, rule: bad });
      else parts.push(current.trim());
      index += 1;
    }
    if (parts.length > 0) {
      const content = inline(parts.join(' '), start);
      if (content !== null) blocks.push({ type: 'paragraph', content });
    }
  }

  if (blocks.length > MAX_BLOCKS) issues.push({ line: lines.length, rule: 'too_many_blocks' });
  return { blocks, issues };
}
