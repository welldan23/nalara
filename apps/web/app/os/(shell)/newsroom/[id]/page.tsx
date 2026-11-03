// Edit a draft (P1-02) or correct a published article (P1-07): editor with the latest revision,
// corrections, status events and the full revision history.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ApiUnauthorized, getArticle, listCategories } from '../../../../../lib/api';
import { EVENT_LABELS, STATUS_LABELS } from '../../../../../lib/editor-messages';
import { Editor } from '../editor';
import { WorkflowPanel } from '../workflow';

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
        editable={['draft', 'in_review', 'approved'].includes(article.status)}
        mode={article.status === 'published' ? 'correct' : 'edit'}
        status={article.status}
        verification={detail.verification}
        categories={categories}
        initial={{
          title: article.current.title,
          dek: article.current.dek,
          articleType: article.current.articleType,
          categoryId: article.current.categoryId,
          methodNote: article.current.methodNote ?? '',
          bodySource: article.current.bodySource,
          citations: article.current.citations,
        }}
      />
      <WorkflowPanel
        articleId={article.id}
        status={article.status}
        version={article.currentVersion}
        gate={detail.gate}
      />
      {detail.corrections.length > 0 && (
        <section aria-labelledby="corrections">
          <h2 id="corrections">Riwayat koreksi</h2>
          <ol className="revision-list" data-testid="corrections">
            {detail.corrections.map((correction, index) => (
              <li key={`${correction.createdAt}-${String(index)}`}>
                <strong>{correction.substantial ? 'Substansial' : 'Kecil'}</strong> ·{' '}
                {correction.description}{' '}
                <span className="muted">
                  · {dateFormat.format(new Date(correction.createdAt))} WIB
                  {correction.substantial ? ' · tampil ke pembaca' : ' · hanya internal'}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {detail.events.length > 0 && (
        <section aria-labelledby="events">
          <h2 id="events">Riwayat status</h2>
          <ol className="revision-list">
            {detail.events.map((event, index) => (
              <li key={`${event.createdAt}-${String(index)}`}>
                <strong>{EVENT_LABELS[event.action] ?? event.action}</strong>
                {event.note !== null && <> · {event.note}</>}{' '}
                <span className="muted">· {dateFormat.format(new Date(event.createdAt))} WIB</span>
              </li>
            ))}
          </ol>
        </section>
      )}
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
