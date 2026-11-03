import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository db/migrations, resolved the same way from src/ and from dist/. */
export const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'db',
  'migrations',
);
