// New registry source (P1-05).
import type { Metadata } from 'next';
import { SourceForm } from '../source-form';

export const metadata: Metadata = { title: 'Sumber baru' };

export default function NewSourcePage() {
  return (
    <>
      <h1>Sumber baru</h1>
      <SourceForm />
    </>
  );
}
