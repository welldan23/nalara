// Publish gate (PRD v4 §7, ADR-012, ADR-019). Pure: given one revision's content it lists every
// reason it may not be approved or published. The workflow checks it at approve AND again at
// publish, inside the same transaction that changes the status.
import type { Citation, RevisionContent } from './content.ts';
import { verificationLevel } from './verification.ts';
import type { VerificationLevel } from './verification.ts';

export type GateBlocker =
  /** No verified source and no written exception from the founder. */
  | 'no_verified_source'
  /** A number points at a citation that has not been checked. */
  | 'stat_source_unverified'
  /** Nothing to publish. */
  | 'empty_body'
  /** Publish only: the current revision is not exactly the approved one (set by the workflow). */
  | 'revision_changed_after_approval'
  /** An image without a known licence and credit line, or missing from the library (P1-09). */
  | 'image_license_missing'
  /** A chart of a dataset version that does not exist or is not published (P4-03). */
  | 'chart_dataset_unpublished';

/** What the gate needs to know about each image an article uses. */
export interface GateMedia {
  readonly license: string | null;
  readonly attribution: string | null;
}

/** What the gate needs to know about each chart an article uses (P4-03). */
export interface GateChart {
  readonly published: boolean;
}

export interface GateResult {
  readonly verification: VerificationLevel;
  readonly blockers: readonly GateBlocker[];
}

export function publishGate(
  content: Pick<RevisionContent, 'body' | 'citations'>,
  options: {
    readonly sourceException?: string | null;
    /** Every image the body references, by id. A missing entry blocks publishing. */
    readonly media?: ReadonlyMap<string, GateMedia>;
    /** Every chart the body references, by `dataset@version`. A missing entry blocks. */
    readonly charts?: ReadonlyMap<string, GateChart>;
  } = {},
): GateResult {
  const verification = verificationLevel(content.citations);
  const blockers: GateBlocker[] = [];
  if (content.body.length === 0) blockers.push('empty_body');
  const hasException = (options.sourceException ?? '').trim().length >= 20;
  if (verification === 'BELUM_TERVERIFIKASI' && !hasException) {
    blockers.push('no_verified_source');
  }
  const byId = new Map<string, Citation>(
    content.citations.map((citation) => [citation.id, citation]),
  );
  const unverifiedStat = content.body.some(
    (block) => block.type === 'stat' && byId.get(block.citationId)?.verified !== true,
  );
  // Unverified statistics are blocked even with an exception: the exception covers "no source",
  // never "a number we have not checked" (PRD v4 §7).
  if (unverifiedStat) blockers.push('stat_source_unverified');
  const media = options.media ?? new Map<string, GateMedia>();
  const unlicensed = content.body.some((block) => {
    if (block.type !== 'image') return false;
    const asset = media.get(block.mediaId);
    return asset?.license == null || asset.attribution == null;
  });
  if (unlicensed) blockers.push('image_license_missing');
  const charts = options.charts ?? new Map<string, GateChart>();
  const unpublishedChart = content.body.some(
    (block) =>
      block.type === 'chart' &&
      charts.get(`${block.dataset}@${String(block.version)}`)?.published !== true,
  );
  if (unpublishedChart) blockers.push('chart_dataset_unpublished');
  return { verification, blockers };
}
