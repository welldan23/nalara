// New draft (P1-02).
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiUnauthorized, listCategories } from '../../../../../lib/api';
import { ARTICLE_TEMPLATE } from '../../../../../lib/editor-messages';
import { Editor } from '../editor';

export const metadata: Metadata = { title: 'Draft baru' };
export const dynamic = 'force-dynamic';

export default async function NewDraftPage() {
  let categories;
  try {
    categories = await listCategories((await headers()).get('cookie'));
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  return (
    <>
      <h1>Draft baru</h1>
      <Editor
        categories={categories}
        initial={{
          title: '',
          dek: '',
          articleType: 'explainer',
          categoryId: categories[0]?.id ?? '',
          methodNote: '',
          bodySource: ARTICLE_TEMPLATE,
        }}
      />
    </>
  );
}
