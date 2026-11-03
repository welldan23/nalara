// Newsroom list (P1-02): every article with its status and latest version.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiUnauthorized, listArticles, listCategories } from '../../../../lib/api';
import { STATUS_LABELS } from '../../../../lib/editor-messages';

export const metadata: Metadata = { title: 'Newsroom' };
export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

export default async function NewsroomPage() {
  const cookie = (await headers()).get('cookie');
  let data;
  try {
    data = await Promise.all([listArticles(cookie), listCategories(cookie)]);
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  const [articles, categories] = data;
  const topic = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <>
      <div className="page-head">
        <h1>Newsroom</h1>
        <Link className="button" href="/os/newsroom/baru">
          Draft baru
        </Link>
      </div>
      {articles.length === 0 ? (
        <p className="muted">Belum ada artikel. Mulai dengan draft baru.</p>
      ) : (
        <ul className="article-list">
          {articles.map((article) => (
            <li key={article.id}>
              <Link href={`/os/newsroom/${article.id}`}>{article.title}</Link>
              <p className="muted">
                <span className={`status status-${article.status}`}>
                  {STATUS_LABELS[article.status] ?? article.status}
                </span>{' '}
                · {topic.get(article.categoryId) ?? 'Topik?'} · v{article.currentVersion} · diubah{' '}
                {dateFormat.format(new Date(article.updatedAt))} WIB
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
