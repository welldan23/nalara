// Radar (P5-01): groups inbox items into stories and gives each a deterministic 0-100 score, so
// the founder (and later the proposal job, P5-02) looks at the strongest stories first. Pure: no
// I/O, no AI. Learned from VORSA's collector (docs/phase-5/PLAN.md §3), rewritten for NALARA.

/** Items closer than this (token Jaccard on titles) belong to one story. */
export const CLUSTER_JACCARD = 0.5;
/** Titles this similar across outlets are one copied article (syndication, press release). */
export const SYNDICATION_JACCARD = 0.8;
/** How far back the radar looks. */
export const WINDOW_HOURS = 36;
/** A story older than this has no recency points left. */
export const MAX_AGE_HOURS = 24;
/** Big stories: the only ones that pass the quiet hours. */
export const BREAKING_SCORE = 85;
/** Quiet hours, Asia/Jakarta: 01:00-05:00. */
export const QUIET_HOURS = { from: 1, to: 5 } as const;

/** Official sources outrank media: a ministry's own release is the primary source. */
export const SOURCE_WEIGHT: Readonly<Record<string, number>> = {
  statistics: 1,
  central_bank: 1,
  ministry: 1,
  regulator: 1,
  legislation: 1,
  international: 0.9,
  academic: 0.9,
  media: 0.8,
  company: 0.6,
  other: 0.5,
};

/** Default keyword lists; the founder's topics (agent preferences) are added to the boost list. */
export const DEFAULT_KEYWORDS = {
  boost: [
    'inflasi',
    'rupiah',
    'BI rate',
    'suku bunga',
    'APBN',
    'pajak',
    'PHK',
    'upah',
    'harga',
    'subsidi',
    'BBM',
    'listrik',
    'beras',
    'kemiskinan',
    'pengangguran',
    'pertumbuhan ekonomi',
    'ekspor',
    'impor',
    'DPR',
    'undang-undang',
    'peraturan',
    'menteri',
    'presiden',
    'pemilu',
    'gempa',
    'banjir',
    'AI',
  ],
  penalty: [
    'tips',
    'cara',
    'rekomendasi',
    'daftar',
    'link nonton',
    'wajib dicoba',
    // Ceremonial releases from official sources rarely need explaining (lesson from VORSA × SENTINEL).
    'lantik',
    'melantik',
    'hadiri',
    'menghadiri',
    'kunjungan kerja',
    'silaturahmi',
    'apresiasi',
    'penghargaan',
  ],
  block: ['promo', 'diskon', 'sponsored', 'advertorial', 'ramalan', 'giveaway'],
} as const;

const STOPWORDS = new Set(
  (
    'yang dan di ke dari untuk dengan pada ini itu akan atau juga tidak dalam oleh sebagai adalah ' +
    'karena saat agar bagi para kata usai jadi bisa ada telah sudah masih soal hingga lebih ' +
    'the a an and or of to in on for with at by from is are was were be as it its this that'
  ).split(' '),
);

/** Lower-case words of a title, without stopwords and very short tokens. */
export function tokens(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return new Set(words);
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / (a.size + b.size - common);
}

export interface RadarItem {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly url: string;
  readonly publishedAt: Date | null;
  readonly firstSeenAt: Date;
  readonly source: {
    readonly id: string;
    readonly name: string;
    readonly organization: string;
    readonly type: string;
  };
}

export interface Keywords {
  readonly boost: readonly string[];
  readonly penalty: readonly string[];
  readonly block: readonly string[];
}

export interface Story {
  /** Stable for the same set of items: the id of the earliest item. */
  readonly id: string;
  readonly title: string;
  readonly score: number;
  readonly independentSources: number;
  readonly latestAt: Date;
  readonly keywords: readonly string[];
  /** Big enough to pass the quiet hours. */
  readonly breaking: boolean;
  readonly items: readonly RadarItem[];
  readonly parts: {
    readonly recency: number;
    readonly weight: number;
    readonly keywords: number;
    readonly coverage: number;
    readonly penalty: number;
  };
}

const when = (item: RadarItem) => item.publishedAt ?? item.firstSeenAt;

/** Whole-word, case-insensitive match (so "AI" does not match "pantai"). */
function matches(text: string, words: readonly string[]): string[] {
  const lower = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return words.filter((word) => {
    const needle = word
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    return needle !== '' && lower.includes(` ${needle} `);
  });
}

/** Distinct outlets: same organisation, or a near-identical headline elsewhere, counts once. */
export function independentSources(items: readonly RadarItem[]): number {
  const groups: { orgs: Set<string>; titles: Set<string>[] }[] = [];
  for (const item of items) {
    const org = item.source.organization.trim().toLowerCase();
    const title = tokens(item.title);
    const group = groups.find(
      (candidate) =>
        candidate.orgs.has(org) ||
        candidate.titles.some((other) => jaccard(title, other) >= SYNDICATION_JACCARD),
    );
    if (group === undefined) {
      groups.push({ orgs: new Set([org]), titles: [title] });
    } else {
      group.orgs.add(org);
      group.titles.push(title);
    }
  }
  return groups.length;
}

/** Single-link clustering on title similarity, oldest item first so the result is stable. */
export function clusterItems(items: readonly RadarItem[]): RadarItem[][] {
  const sorted = [...items].sort(
    (a, b) => when(a).getTime() - when(b).getTime() || a.id.localeCompare(b.id),
  );
  const clusters: { items: RadarItem[]; titles: Set<string>[] }[] = [];
  for (const item of sorted) {
    const title = tokens(item.title);
    const cluster = clusters.find((candidate) =>
      candidate.titles.some((other) => jaccard(title, other) >= CLUSTER_JACCARD),
    );
    if (cluster === undefined) clusters.push({ items: [item], titles: [title] });
    else {
      cluster.items.push(item);
      cluster.titles.push(title);
    }
  }
  return clusters.map((cluster) => cluster.items);
}

/**
 * Deterministic 0-100: recency 30 + source weight 20 + keywords 25 + independent coverage 25,
 * minus penalties up to 20. Returns null for blocked stories (promotions, horoscopes, ...).
 */
export function scoreStory(
  items: readonly RadarItem[],
  keywords: Keywords,
  now: Date,
): Story | null {
  const first = items[0];
  if (first === undefined) return null;
  const titles = items.map((item) => item.title).join(' ');
  const text = items.map((item) => `${item.title} ${item.summary}`).join(' ');
  if (matches(titles, keywords.block).length > 0) return null;

  const latestAt = new Date(Math.max(...items.map((item) => when(item).getTime())));
  const ageHours = Math.max(0, (now.getTime() - latestAt.getTime()) / 3_600_000);
  const recency = 30 * Math.max(0, 1 - ageHours / MAX_AGE_HOURS);
  const weight = 20 * Math.max(...items.map((item) => SOURCE_WEIGHT[item.source.type] ?? 0.5));
  const hits = [...new Set(matches(text, keywords.boost).map((word) => word.toLowerCase()))];
  const keywordPoints = Math.min(25, 9 * hits.length);
  const penaltyHits = new Set(matches(titles, keywords.penalty).map((word) => word.toLowerCase()));
  const penalty = Math.min(20, 10 * penaltyHits.size);
  const independent = independentSources(items);
  const coverage = independent >= 4 ? 25 : ({ 1: 0, 2: 12, 3: 20 }[independent] ?? 0);
  const score = Math.max(
    0,
    Math.min(100, Math.round(recency + weight + keywordPoints + coverage - penalty)),
  );
  // The title of the most official, then most recent, item names the story.
  const lead = [...items].sort(
    (a, b) =>
      (SOURCE_WEIGHT[b.source.type] ?? 0.5) - (SOURCE_WEIGHT[a.source.type] ?? 0.5) ||
      when(b).getTime() - when(a).getTime(),
  )[0];
  return {
    id: first.id,
    title: (lead ?? first).title,
    score,
    independentSources: independent,
    latestAt,
    keywords: hits.sort(),
    breaking: score >= BREAKING_SCORE,
    items,
    parts: {
      recency: Math.round(recency),
      weight: Math.round(weight),
      keywords: keywordPoints,
      coverage,
      penalty,
    },
  };
}

/** Hour of the day in Asia/Jakarta (UTC+7, no daylight saving). */
export function jakartaHour(now: Date): number {
  return (now.getUTCHours() + 7) % 24;
}

export function inQuietHours(now: Date): boolean {
  const hour = jakartaHour(now);
  return hour >= QUIET_HOURS.from && hour < QUIET_HOURS.to;
}

/** Stories, highest score first (ties: newest first, then id), blocked ones left out. */
export function rankStories(items: readonly RadarItem[], keywords: Keywords, now: Date): Story[] {
  return clusterItems(items)
    .map((cluster) => scoreStory(cluster, keywords, now))
    .filter((story): story is Story => story !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.latestAt.getTime() - a.latestAt.getTime() ||
        a.id.localeCompare(b.id),
    );
}

/** The founder's topics join the default boost list (case-insensitive, no duplicates). */
export function keywordsWith(topics: readonly string[]): Keywords {
  const boost: string[] = [...DEFAULT_KEYWORDS.boost];
  for (const topic of topics) {
    if (!boost.some((word) => word.toLowerCase() === topic.toLowerCase())) boost.push(topic);
  }
  return { boost, penalty: DEFAULT_KEYWORDS.penalty, block: DEFAULT_KEYWORDS.block };
}
