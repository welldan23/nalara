// Zod-based request validation helper. Reports field paths and rule codes, never values.
import type { z } from 'zod';
import { AppError } from './errors.ts';

export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new AppError(
    'VALIDATION_FAILED',
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || '(root)',
      // Custom refinements carry a fixed rule identifier as their message (never input).
      rule: issue.code === 'custom' ? issue.message : issue.code,
    })),
  );
}
