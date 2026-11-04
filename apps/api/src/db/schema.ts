// Drizzle table definitions for typed queries. The SQL in db/migrations is the source of truth
// (ADR-010); tests/integration/db.test.ts fails if these definitions drift from the database.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
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
  actorType: text('actor_type', { enum: ['founder', 'system'] }).notNull(),
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
};
