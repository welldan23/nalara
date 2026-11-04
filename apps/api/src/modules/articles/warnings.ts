// Editorial style warnings (pattern from VORSA x SENTINEL, P1-02). Advice only: they never block
// a save. The founder decides; the rules that block publishing live in the publish gate (P1-03).
import type { Block, RevisionContent } from './content.ts';

export type WarningCode =
  | 'cliche'
  | 'title_all_caps'
  | 'title_too_long'
  | 'title_excess_punctuation'
  | 'dek_missing'
  | 'no_headings';

export interface StyleWarning {
  readonly code: WarningCode;
  /** The matched phrase for `cliche`; nothing else is echoed back. */
  readonly detail?: string;
}

/** Stock phrases that make writing read as generic or machine-made (VORSA EDITORIAL.md). */
export const CLICHES = [
  'di era digital ini',
  'mari kita simak',
  'tidak dapat dipungkiri',
  'tak dapat dipungkiri',
  'dalam dunia yang terus berkembang',
  'menjadi sorotan',
  'game changer',
  'kesimpulannya',
  'kamu tidak akan percaya',
  'ternyata',
  'yuk',
] as const;

const TITLE_WORD_LIMIT = 14;

function blockText(block: Block): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return block.content.map((part) => part.text).join('');
    case 'list':
      return block.items.map((item) => item.map((part) => part.text).join('')).join(' ');
    case 'quote':
      return block.content.map((part) => part.text).join('');
    case 'stat':
      return `${block.label} ${block.value} ${block.unit}`;
    case 'image':
      return '';
  }
}

export function styleWarnings(
  content: Pick<RevisionContent, 'title' | 'dek' | 'body'>,
): StyleWarning[] {
  const warnings: StyleWarning[] = [];
  const title = content.title.trim();
  const letters = title.replace(/[^A-Za-z]/g, '');
  if (letters.length > 10 && letters === letters.toUpperCase())
    warnings.push({ code: 'title_all_caps' });
  if (title.split(/\s+/).filter(Boolean).length > TITLE_WORD_LIMIT) {
    warnings.push({ code: 'title_too_long' });
  }
  if (/[!?]{2,}/.test(title)) warnings.push({ code: 'title_excess_punctuation' });
  if (content.dek.trim() === '') warnings.push({ code: 'dek_missing' });
  if (content.body.length > 3 && !content.body.some((block) => block.type === 'heading')) {
    warnings.push({ code: 'no_headings' });
  }

  const text = [title, content.dek, ...content.body.map(blockText)].join(' ').toLowerCase();
  for (const phrase of CLICHES) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${phrase.replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`,
      'u',
    );
    if (pattern.test(text)) warnings.push({ code: 'cliche', detail: phrase });
  }
  return warnings;
}
