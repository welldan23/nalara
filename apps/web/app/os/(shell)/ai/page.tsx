// AI agents (P3-02): the kill switch, daily quotas, what the agents should focus on, and which
// runner credentials exist. Agents only ever file proposals or drafts (see Usulan).
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiUnauthorized, getAiOverview } from '../../../../lib/api';
import { KillSwitch, PreferencesForm, QuotaForm } from './ai-forms';

export const metadata: Metadata = { title: 'Agent AI' };
export const dynamic = 'force-dynamic';

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});
const numberFormat = new Intl.NumberFormat('id-ID');

export default async function AiPage() {
  let overview;
  try {
    overview = await getAiOverview((await headers()).get('cookie'));
  } catch (error) {
    if (error instanceof ApiUnauthorized) redirect('/os/login');
    throw error;
  }
  if (overview === null) redirect('/os');
  const { settings, usage, preferences, credentials } = overview;
  const active = credentials.filter((row) => row.revokedAt === null);

  return (
    <>
      <h1>Agent AI</h1>
      <p className="muted">
        Agent hanya bisa membuat <Link href="/os/usulan">usulan</Link> dan draft. Mereka tidak bisa
        menyetujui, menerbitkan, atau menghapus apa pun.
      </p>

      <section aria-labelledby="switch">
        <h2 id="switch">Saklar</h2>
        <p data-testid="ai-state">
          AI sekarang <strong>{settings.aiEnabled ? 'menyala' : 'mati'}</strong>
          <span className="muted">
            {' '}
            · diubah {dateFormat.format(new Date(settings.updatedAt))} WIB
          </span>
        </p>
        {!settings.aiEnabled && (
          <p className="muted">
            Selama mati, agent tidak bisa melakukan apa pun. Provider AI belum dipilih (D-25), jadi
            menyalakan saklar ini baru berarti setelah runner agent dipasang.
          </p>
        )}
        <KillSwitch settings={settings} />
      </section>

      <section aria-labelledby="usage">
        <h2 id="usage">Pemakaian 24 jam terakhir</h2>
        <ul>
          <li>
            Draft: {usage.drafts} dari {settings.dailyDraftQuota}
          </li>
          <li>
            Usulan: {usage.proposals} dari {settings.dailyProposalQuota}
          </li>
          <li>
            Token AI: {numberFormat.format(usage.tokens)} dari{' '}
            {numberFormat.format(settings.dailyTokenQuota)}
          </li>
        </ul>
        <QuotaForm key={settings.version} settings={settings} />
      </section>

      <section aria-labelledby="preferences">
        <h2 id="preferences">Preferensi agent</h2>
        <PreferencesForm key={preferences.version} preferences={preferences} />
      </section>

      <section aria-labelledby="credentials">
        <h2 id="credentials">Kredensial runner</h2>
        {active.length === 0 ? (
          <p className="muted">
            Belum ada. Dibuat di server dengan perintah <code>agent:credential create</code>.
            Tokennya hanya tampil sekali dan tidak pernah ditempel di chat.
          </p>
        ) : (
          <ul>
            {active.map((row) => (
              <li key={row.label}>
                <code>{row.label}</code> · dibuat {dateFormat.format(new Date(row.createdAt))} WIB
                {row.lastUsedAt !== null
                  ? ` · terakhir dipakai ${dateFormat.format(new Date(row.lastUsedAt))} WIB`
                  : ' · belum pernah dipakai'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
