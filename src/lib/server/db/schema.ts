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
	metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
	// Session type: 'terminal' (PTY) or 'sdk' (Claude Code SDK)
	sessionType: text('session_type').notNull().default('terminal'), // 'terminal' | 'sdk'
	// Claude CLI session integration fields
	claudeSessionId: text('claude_session_id').unique(), // The actual Claude session ID from ~/.claude
	claudeSessionPath: text('claude_session_path'), // Path to the .jsonl file
	isClaudeSession: integer('is_claude_session', { mode: 'boolean' }).default(false), // Whether this is a discovered Claude session
	discoveredAt: integer('discovered_at', { mode: 'timestamp' }) // When this session was discovered
});

export const sessionHistory = sqliteTable('session_history', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
	timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
	type: text('type').notNull(), // 'input' | 'output'
	content: text('content').notNull()
});

// SDK session messages for Claude Code SDK interactions
export const sdkMessages = sqliteTable('sdk_messages', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	sessionId: text('session_id').notNull().references(() => sessions.sessionId, { onDelete: 'cascade' }),
	timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
	messageType: text('message_type').notNull(), // 'system' | 'assistant' | 'user' | 'result'
	subtype: text('subtype'), // 'init' | 'success' | 'error' etc.
	content: text('content', { mode: 'json' }).$type<Record<string, any>>().notNull(), // Full message JSON
	parentToolUseId: text('parent_tool_use_id'), // For tool use tracking
	claudeSessionId: text('claude_session_id') // SDK session ID
});
