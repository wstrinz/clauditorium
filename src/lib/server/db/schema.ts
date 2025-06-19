import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	sessionId: text('session_id').notNull().unique(),
	name: text('name').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	lastActiveAt: integer('last_active_at', { mode: 'timestamp' }).notNull(),
	status: text('status').notNull(), // 'active' | 'inactive' | 'terminated' | 'crashed'
	workingDirectory: text('working_directory').notNull(),
	hasBackendProcess: integer('has_backend_process', { mode: 'boolean' }).default(false),
	useContinueFlag: integer('use_continue_flag', { mode: 'boolean' }).default(false),
	canReinitialize: integer('can_reinitialize', { mode: 'boolean' }).default(false),
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>()
});

export const sessionHistory = sqliteTable('session_history', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
	timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
	type: text('type').notNull(), // 'input' | 'output'
	content: text('content').notNull()
});
