// Drizzle table definitions for typed queries. The SQL in db/migrations is the source of truth
// (ADR-010); tests/integration/db.test.ts fails if these definitions drift from the database.
import { sql } from 'drizzle-orm';
import { boolean, customType, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['founder'] }).notNull(),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
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

export const schema = { users, sessions, auditEvents };
