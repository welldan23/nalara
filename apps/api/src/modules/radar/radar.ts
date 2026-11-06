// Radar (P5-01): the stories in the inbox, clustered and scored (see score.ts). Read-only.
import { and, gte, inArray, sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { agentPreferences, discoveredItems, sources } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { WINDOW_HOURS, inQuietHours, keywordsWith, rankStories } from './score.ts';
import type { RadarItem, Story } from './score.ts';

type Db = NodePgDatabase<typeof schema>;

/** Enough for a busy day of feeds; clustering is quadratic only within this bound. */
const MAX_ITEMS = 1500;

export interface RadarView {
  readonly generatedAt: Date;
  /** 01:00-05:00 WIB: only breaking stories would be proposed (P5-02). */
  readonly quietHours: boolean;
  readonly stories: readonly Story[];
}

export async function loadRadar(
  db: Db,
  options: { now?: Date; limit?: number } = {},
): Promise<RadarView> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);
  const rows = await db
    .select({
      id: discoveredItems.id,
      title: discoveredItems.title,
      summary: discoveredItems.summary,
      url: discoveredItems.canonicalUrl,
      publishedAt: discoveredItems.publishedAt,
      firstSeenAt: discoveredItems.firstSeenAt,
      sourceId: sources.id,
      sourceName: sources.name,
      organization: sources.organization,
      type: sources.type,
    })
    .from(discoveredItems)
    .innerJoin(sources, eq(sources.id, discoveredItems.sourceId))
    .where(
      and(
        inArray(discoveredItems.status, ['new', 'seen']),
        gte(sql`coalesce(${discoveredItems.publishedAt}, ${discoveredItems.firstSeenAt})`, since),
      ),
    )
    .orderBy(sql`${discoveredItems.firstSeenAt} DESC`)
    .limit(MAX_ITEMS);
  const items: RadarItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    publishedAt: row.publishedAt,
    firstSeenAt: row.firstSeenAt,
    source: {
      id: row.sourceId,
      name: row.sourceName,
      organization: row.organization,
      type: row.type,
    },
  }));
  const [preferences] = await db.select({ topics: agentPreferences.topics }).from(agentPreferences);
  const stories = rankStories(items, keywordsWith(preferences?.topics ?? []), now);
  return {
    generatedAt: now,
    quietHours: inQuietHours(now),
    stories: stories.slice(0, options.limit ?? 20),
  };
}

/** JSON shape for the OS and the agent: dates as ISO strings, items trimmed to what is shown. */
export function radarView(radar: RadarView) {
  return {
    generatedAt: radar.generatedAt.toISOString(),
    quietHours: radar.quietHours,
    stories: radar.stories.map((story) => ({
      id: story.id,
      title: story.title,
      score: story.score,
      breaking: story.breaking,
      independentSources: story.independentSources,
      latestAt: story.latestAt.toISOString(),
      keywords: story.keywords,
      parts: story.parts,
      items: story.items.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        source: { name: item.source.name, organization: item.source.organization },
      })),
    })),
  };
}
