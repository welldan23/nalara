// Drizzle table definitions for typed queries. The SQL in db/migrations is the source of truth
// (ADR-010); tests/integration/db.test.ts fails if these definitions drift from the database.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['founder'] }).notNull(),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  totpSecretEnc: bytea('totp_secret_enc'),
  totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: bytea('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

export const loginChallenges = pgTable('login_challenges', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: bytea('token_hash').notNull(),
  scope: text('scope', { enum: ['enrolment', 'mfa'] }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  pendingTotpSecretEnc: bytea('pending_totp_secret_enc'),
  failedAttempts: integer('failed_attempts').notNull().default(0),
});

export const recoveryCodes = pgTable('recovery_codes', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  codeHash: bytea('code_hash').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  actorType: text('actor_type', { enum: ['founder', 'system', 'agent'] }).notNull(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  result: text('result', { enum: ['success', 'failure', 'denied'] }).notNull(),
  requestId: text('request_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ARTICLE_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'published',
  'archived',
] as const;
export const ARTICLE_TYPES = ['explainer', 'analysis', 'opinion'] as const;

export const articles = pgTable('articles', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  slug: text('slug').notNull(),
  status: text('status', { enum: ARTICLE_STATUSES }).notNull().default('draft'),
  currentVersion: integer('current_version').notNull().default(0),
  currentRevisionId: uuid('current_revision_id'),
  approvedRevisionId: uuid('approved_revision_id'),
  approvedContentSha256: bytea('approved_content_sha256'),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  firstPublishedAt: timestamp('first_published_at', { withTimezone: true }),
  sourceException: text('source_exception'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const articleRevisions = pgTable('article_revisions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  articleId: uuid('article_id')
    .notNull()
    .references(() => articles.id),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  dek: text('dek').notNull().default(''),
  articleType: text('article_type', { enum: ARTICLE_TYPES }).notNull(),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  body: jsonb('body').$type<unknown[]>().notNull(),
  bodySource: text('body_source').notNull(),
  methodNote: text('method_note'),
  citations: jsonb('citations').$type<unknown[]>().notNull().default([]),
  changeNote: text('change_note').notNull(),
  contentSha256: bytea('content_sha256').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const PUBLICATION_ACTIONS = [
  'submit',
  'return',
  'approve',
  'publish',
  'archive',
  'correct',
] as const;

export const publicationEvents = pgTable('publication_events', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  articleId: uuid('article_id')
    .notNull()
    .references(() => articles.id),
  revisionId: uuid('revision_id').notNull(),
  action: text('action', { enum: PUBLICATION_ACTIONS }).notNull(),
  fromStatus: text('from_status').notNull(),
  toStatus: text('to_status').notNull(),
  contentSha256: bytea('content_sha256').notNull(),
  verification: text('verification', {
    enum: ['TERVERIFIKASI', 'SEBAGIAN', 'BELUM_TERVERIFIKASI'],
  }).notNull(),
  note: text('note'),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const corrections = pgTable('corrections', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  articleId: uuid('article_id')
    .notNull()
    .references(() => articles.id),
  revisionId: uuid('revision_id').notNull(),
  description: text('description').notNull(),
  substantial: boolean('substantial').notNull(),
  visibleAt: timestamp('visible_at', { withTimezone: true }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const SOURCE_TYPES = [
  'statistics',
  'central_bank',
  'ministry',
  'regulator',
  'legislation',
  'company',
  'academic',
  'international',
  'media',
  'other',
] as const;
export const LICENSE_STATUSES = [
  'unknown',
  'open',
  'attribution_required',
  'permission_required',
  'restricted',
] as const;
export const SOURCE_STATUSES = ['candidate', 'verified', 'paused', 'disabled'] as const;
export const FEED_STATUSES = ['none', 'unchecked', 'ok', 'failing', 'quarantined'] as const;

/** Source Registry (P1-05). Never deleted: disabled instead; changes are audited. */
export const sources = pgTable('sources', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  name: text('name').notNull(),
  organization: text('organization').notNull(),
  type: text('type', { enum: SOURCE_TYPES }).notNull(),
  officialUrl: text('official_url').notNull(),
  licenseStatus: text('license_status', { enum: LICENSE_STATUSES }).notNull().default('unknown'),
  licenseNote: text('license_note'),
  attribution: text('attribution'),
  status: text('status', { enum: SOURCE_STATUSES }).notNull().default('candidate'),
  notes: text('notes'),
  // Feed (P2-03b). Written by the founder (feedUrl) and by the worker (the rest).
  feedUrl: text('feed_url'),
  feedStatus: text('feed_status', { enum: FEED_STATUSES }).notNull().default('none'),
  feedTitle: text('feed_title'),
  feedCheckedAt: timestamp('feed_checked_at', { withTimezone: true }),
  feedError: text('feed_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  nextFetchAt: timestamp('next_fetch_at', { withTimezone: true }),
  etag: text('etag'),
  lastModified: text('last_modified'),
  feedQuarantinedAt: timestamp('feed_quarantined_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const MEDIA_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const USAGE_BASES = [
  'own_work',
  'licensed',
  'official_release',
  'public_domain',
  'ai_generated',
] as const;

/** Media library (P1-09, ADR-020). Bytes immutable (column grants); never deleted. */
export const mediaAssets = pgTable('media_assets', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  mime: text('mime', { enum: MEDIA_MIMES }).notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  byteSize: integer('byte_size').notNull(),
  data: bytea('data').notNull(),
  sha256: bytea('sha256').notNull(),
  altText: text('alt_text').notNull(),
  caption: text('caption'),
  usageBasis: text('usage_basis', { enum: USAGE_BASES }).notNull(),
  license: text('license'),
  attribution: text('attribution'),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const JOB_KINDS = ['feed_check', 'feed_fetch', 'evidence_snapshot'] as const;
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;

/** Worker job queue (P2-02). The API enqueues; the worker claims with a lease. */
export const jobRuns = pgTable('job_runs', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  kind: text('kind', { enum: JOB_KINDS }).notNull(),
  subjectId: uuid('subject_id'),
  status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  lockedBy: text('locked_by'),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/** Every feed check (P2-03b). Immutable. */
export const sourceChecks = pgTable('source_checks', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id),
  ok: boolean('ok').notNull(),
  httpStatus: integer('http_status'),
  feedFormat: text('feed_format', { enum: ['rss', 'atom', 'rdf'] }),
  itemCount: integer('item_count'),
  error: text('error'),
  durationMs: integer('duration_ms'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
});

export const INBOX_STATUSES = ['new', 'seen', 'dismissed', 'used'] as const;

/** Every feed fetch by the worker (P2-04). Immutable. */
export const ingestionRuns = pgTable('ingestion_runs', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id),
  httpStatus: integer('http_status'),
  notModified: boolean('not_modified').notNull().default(false),
  itemsSeen: integer('items_seen').notNull().default(0),
  itemsNew: integer('items_new').notNull().default(0),
  error: text('error'),
  durationMs: integer('duration_ms'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Items found in feeds (P2-04): inbox material, never public. */
export const discoveredItems = pgTable('discovered_items', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id),
  runId: uuid('run_id')
    .notNull()
    .references(() => ingestionRuns.id),
  canonicalUrl: text('canonical_url').notNull(),
  guid: text('guid').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  fingerprint: bytea('fingerprint').notNull(),
  status: text('status', { enum: INBOX_STATUSES }).notNull().default('new'),
  statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

export const EVIDENCE_STATUSES = ['pending', 'captured', 'failed'] as const;

/** Evidence vault (P2-07): byte copies of checked citations. Immutable once captured. */
export const evidenceSnapshots = pgTable('evidence_snapshots', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  url: text('url').notNull(),
  status: text('status', { enum: EVIDENCE_STATUSES }).notNull().default('pending'),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => users.id),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  httpStatus: integer('http_status'),
  contentType: text('content_type'),
  finalUrl: text('final_url'),
  byteSize: integer('byte_size'),
  sha256: bytea('sha256'),
  body: bytea('body'),
  error: text('error'),
});

export const PROPOSAL_KINDS = [
  'sources.propose_create',
  'sources.propose_update',
  'preferences.propose_update',
  'inbox.propose_flag',
  'articles.propose_note',
] as const;
export const AGENT_ROLES = ['radar', 'penulis', 'pemeriksa', 'periset', 'pemantau'] as const;
export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected', 'failed', 'expired'] as const;
export const PROPOSAL_TARGETS = ['source', 'preferences', 'discovered_item', 'article'] as const;

/** Agent proposals (P3-01): written once, decided once by the founder. */
export const aiActionProposals = pgTable('ai_action_proposals', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  kind: text('kind', { enum: PROPOSAL_KINDS }).notNull(),
  agentRole: text('agent_role', { enum: AGENT_ROLES }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  targetType: text('target_type', { enum: PROPOSAL_TARGETS }),
  targetId: uuid('target_id'),
  targetVersion: integer('target_version'),
  status: text('status', { enum: PROPOSAL_STATUSES }).notNull().default('pending'),
  failure: text('failure'),
  resultId: uuid('result_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

/** One immutable decision per proposal. */
export const approvals = pgTable('approvals', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  proposalId: uuid('proposal_id')
    .notNull()
    .references(() => aiActionProposals.id),
  decision: text('decision', { enum: ['approve', 'reject'] }).notNull(),
  channel: text('channel', { enum: ['os', 'telegram'] }).notNull(),
  decidedBy: uuid('decided_by')
    .notNull()
    .references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The founder's wishes for the agents; a single versioned row. */
export const agentPreferences = pgTable('agent_preferences', {
  id: smallint('id').primaryKey().default(1),
  topics: text('topics')
    .array()
    .notNull()
    .default(sql`'{}'`),
  notes: text('notes').notNull().default(''),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Gateway credentials for the agent runner (P3-02): only the token's SHA-256 is stored. */
export const agentCredentials = pgTable('agent_credentials', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  label: text('label').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/** Kill switch and daily quotas; a single versioned row, AI off by default. */
export const systemSettings = pgTable('system_settings', {
  id: smallint('id').primaryKey().default(1),
  aiEnabled: boolean('ai_enabled').notNull().default(false),
  dailyDraftQuota: integer('daily_draft_quota').notNull().default(3),
  dailyProposalQuota: integer('daily_proposal_quota').notNull().default(30),
  dailyTokenQuota: integer('daily_token_quota').notNull().default(200000),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Token use per model call, reported by the runner. Immutable. */
export const agentUsage = pgTable('agent_usage', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  credentialId: uuid('credential_id')
    .notNull()
    .references(() => agentCredentials.id),
  agentRole: text('agent_role', { enum: AGENT_ROLES }).notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Single-use Telegram approval tokens (P3-04): only the SHA-256 is stored. */
export const approvalTokens = pgTable('approval_tokens', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  proposalId: uuid('proposal_id')
    .notNull()
    .references(() => aiActionProposals.id),
  decision: text('decision', { enum: ['approve', 'reject'] }).notNull(),
  tokenHash: bytea('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const DATASET_FREQUENCIES = [
  'annual',
  'quarterly',
  'monthly',
  'daily',
  'irregular',
] as const;
export const DATASET_STATUSES = ['draft', 'published', 'retracted'] as const;

/** NALARA Data catalogue (P4-02, ADR-021). Never deleted: retracted instead. */
export const datasets = pgTable('datasets', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id),
  sourcePageUrl: text('source_page_url').notNull(),
  unit: text('unit').notNull(),
  frequency: text('frequency', { enum: DATASET_FREQUENCIES }).notNull(),
  methodology: text('methodology').notNull().default(''),
  licenseStatus: text('license_status', { enum: LICENSE_STATUSES }).notNull().default('unknown'),
  licenseNote: text('license_note'),
  attribution: text('attribution'),
  status: text('status', { enum: DATASET_STATUSES }).notNull().default('draft'),
  publishedVersion: integer('published_version'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One immutable version: raw file + transform + observations, each with its SHA-256. */
export const datasetVersions = pgTable('dataset_versions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  datasetId: uuid('dataset_id')
    .notNull()
    .references(() => datasets.id),
  version: integer('version').notNull(),
  raw: bytea('raw').notNull(),
  rawSha256: bytea('raw_sha256').notNull(),
  rawFilename: text('raw_filename').notNull(),
  fileUrl: text('file_url').notNull(),
  retrievedOn: date('retrieved_on', { mode: 'string' }).notNull(),
  spec: jsonb('spec').$type<Record<string, unknown>>().notNull(),
  observations: jsonb('observations')
    .$type<{ series: string | null; period: string; value: number }[]>()
    .notNull(),
  observationsSha256: bytea('observations_sha256').notNull(),
  observationCount: integer('observation_count').notNull(),
  series: text('series')
    .array()
    .notNull()
    .default(sql`'{}'`),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  revisionNote: text('revision_note').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  users,
  sessions,
  loginChallenges,
  recoveryCodes,
  auditEvents,
  categories,
  articles,
  articleRevisions,
  publicationEvents,
  corrections,
  sources,
  mediaAssets,
  jobRuns,
  sourceChecks,
  ingestionRuns,
  discoveredItems,
  evidenceSnapshots,
  aiActionProposals,
  approvals,
  agentPreferences,
  agentCredentials,
  systemSettings,
  agentUsage,
  approvalTokens,
  datasets,
  datasetVersions,
};
