// Article content model (ADR-011) and its canonical hash (ADR-012).
// Content is a list of typed blocks validated here, never HTML: the web renders each block with
// React components, so nothing a founder types can become markup or script.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ARTICLE_TYPES } from '../../db/schema.ts';

export const LIMITS = {
  title: 200,
  dek: 400,
  methodNote: 2000,
  changeNote: 300,
  bodySource: 100_000,
  blocks: 500,
  inlinePerBlock: 200,
  textPerInline: 10_000,
  listItems: 100,
  url: 2048,
  statField: 200,
} as const;

/** https only, no credentials, no whitespace (ADR-019). Link text stays plain text. */
export const httpsUrl = z
  .string()
  .max(LIMITS.url)
  .refine((value) => {
    if (/\s/.test(value)) return false;
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.hostname !== '' &&
        url.username === '' &&
        url.password === ''
      );
    } catch {
      return false;
    }
  }, 'must be an absolute https URL without credentials');

/** Control characters other than tab, newline and carriage return have no place in text. */
function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

const plainText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !hasControlCharacters(value), 'control characters');

const inline = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    text: plainText(LIMITS.textPerInline).min(1),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('link'),
    text: plainText(LIMITS.textPerInline).min(1),
    href: httpsUrl,
  }),
]);

const inlineList = z.array(inline).min(1).max(LIMITS.inlinePerBlock);

export const blockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('paragraph'), content: inlineList }),
  z.strictObject({
    type: z.literal('heading'),
    level: z.union([z.literal(2), z.literal(3)]),
    content: inlineList,
  }),
  z.strictObject({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(inlineList).min(1).max(LIMITS.listItems),
  }),
  z.strictObject({
    type: z.literal('quote'),
    content: inlineList,
    attribution: plainText(LIMITS.statField).min(1),
  }),
  // A number the reader must be able to check: value, unit, period and the citation it comes
  // from are all required (PRD v4 §7). The citation must exist and be verified (P1-04).
  z.strictObject({
    type: z.literal('stat'),
    value: plainText(LIMITS.statField).min(1),
    unit: plainText(LIMITS.statField).min(1),
    period: plainText(LIMITS.statField).min(1),
    label: plainText(LIMITS.statField).min(1),
    citationId: z.uuid(),
  }),
]);

export type Block = z.infer<typeof blockSchema>;

export const bodySchema = z.array(blockSchema).max(LIMITS.blocks);

/** Everything that makes up one revision's content. The hash covers exactly these fields. */
export const revisionContentSchema = z.strictObject({
  title: plainText(LIMITS.title).trim().min(1),
  dek: plainText(LIMITS.dek).trim(),
  articleType: z.enum(ARTICLE_TYPES),
  categoryId: z.uuid(),
  body: bodySchema,
  bodySource: z.string().max(LIMITS.bodySource),
  methodNote: plainText(LIMITS.methodNote).trim().nullable(),
});

export type RevisionContent = z.infer<typeof revisionContentSchema>;

/** Why this revision exists, shown in the history ("Perbaiki angka inflasi"). */
export const changeNoteSchema = plainText(LIMITS.changeNote).trim().min(1);

/** JSON with object keys sorted at every level, so equal content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

/**
 * SHA-256 of the canonical published content. bodySource is excluded on purpose: it is the
 * editor's input, and two inputs that produce the same blocks are the same article.
 */
export function contentSha256(content: RevisionContent): Buffer {
  const hashed = {
    title: content.title,
    dek: content.dek,
    articleType: content.articleType,
    categoryId: content.categoryId,
    body: content.body,
    methodNote: content.methodNote,
  };
  return createHash('sha256').update(canonicalJson(hashed), 'utf8').digest();
}
