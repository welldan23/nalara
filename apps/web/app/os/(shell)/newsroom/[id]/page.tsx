// Edit a draft (P1-02): editor with the latest revision and the full revision history.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ApiUnauthorized, getArticle, listCategories } from '../../../../../lib/api';
import { STATUS_LABELS } from '../../../../../lib/editor-messages';
import { Editor } from '../editor';

export const metadata: Metadata = { title: 'Editor' };
export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

export default async function EditDraftPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookie = (await headers()).get('cookie');
  let data;
  try {
    data = await Promise.all([getArticle(id, cookie), listCategories(cookie)]);
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  const [detail, categories] = data;
  if (detail === null) notFound();
  const { article, revisions } = detail;

  return (
    <>
      <h1>{article.current.title}</h1>
      <p className="muted">
        {STATUS_LABELS[article.status] ?? article.status} · slug <code>{article.slug}</code>
      </p>
      <Editor
        articleId={article.id}
        version={article.currentVersion}
        editable={article.status === 'draft'}
        categories={categories}
        initial={{
          title: article.current.title,
          dek: article.current.dek,
          articleType: article.current.articleType,
          categoryId: article.current.categoryId,
          methodNote: article.current.methodNote ?? '',
          bodySource: article.current.bodySource,
        }}
      />
      <section aria-labelledby="history">
        <h2 id="history">Riwayat revisi</h2>
        <ol className="revision-list" reversed>
          {[...revisions].reverse().map((revision) => (
            <li key={revision.id}>
              <strong>v{revision.version}</strong> · {revision.changeNote}{' '}
              <span className="muted">· {dateFormat.format(new Date(revision.createdAt))} WIB</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
