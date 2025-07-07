import { db } from '$lib/server/db';
import { sessions, sessionHistory } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

export interface SessionData {
	sessionId: string;
	name: string;
	createdAt: Date;
	lastActiveAt: Date;
	status: 'active' | 'inactive' | 'terminated' | 'crashed';
	workingDirectory: string;
	hasBackendProcess: boolean;
	useContinueFlag: boolean;
	canReinitialize: boolean;
	metadata?: Record<string, any>;
	claudeSessionId?: string;
	claudeSessionPath?: string;
	isClaudeSession?: boolean;
	discoveredAt?: Date;
}

export interface SessionHistoryData {
	sessionId: string;
	timestamp: Date;
	type: 'input' | 'output';
	content: string;
}

export async function createSession(data: Omit<SessionData, 'createdAt' | 'lastActiveAt'>): Promise<SessionData> {
	const now = new Date();
	const [inserted] = await db.insert(sessions).values({
		sessionId: data.sessionId,
		name: data.name,
		createdAt: now,
		lastActiveAt: now,
		status: data.status,
		workingDirectory: data.workingDirectory,
		hasBackendProcess: data.hasBackendProcess,
		useContinueFlag: data.useContinueFlag,
		canReinitialize: data.canReinitialize,
		metadata: data.metadata,
		claudeSessionId: data.claudeSessionId,
		claudeSessionPath: data.claudeSessionPath,
		isClaudeSession: data.isClaudeSession ?? false,
		discoveredAt: data.discoveredAt
	}).returning();

	return {
		...inserted,
		status: inserted.status as 'active' | 'inactive' | 'terminated' | 'crashed',
		hasBackendProcess: inserted.hasBackendProcess ?? false,
		useContinueFlag: inserted.useContinueFlag ?? false,
		canReinitialize: inserted.canReinitialize ?? false,
		metadata: inserted.metadata ?? undefined,
		claudeSessionId: inserted.claudeSessionId ?? undefined,
		claudeSessionPath: inserted.claudeSessionPath ?? undefined,
		isClaudeSession: inserted.isClaudeSession ?? false,
		discoveredAt: inserted.discoveredAt ?? undefined,
		createdAt: inserted.createdAt,
		lastActiveAt: inserted.lastActiveAt
	};
}

export async function getSession(sessionId: string): Promise<SessionData | null> {
	const result = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId)).limit(1);
	
	if (result.length === 0) {
		return null;
	}

	const session = result[0];
	return {
		...session,
		status: session.status as 'active' | 'inactive' | 'terminated' | 'crashed',
		hasBackendProcess: session.hasBackendProcess ?? false,
		useContinueFlag: session.useContinueFlag ?? false,
		canReinitialize: session.canReinitialize ?? false,
		metadata: session.metadata ?? undefined,
		claudeSessionId: session.claudeSessionId ?? undefined,
		claudeSessionPath: session.claudeSessionPath ?? undefined,
		isClaudeSession: session.isClaudeSession ?? false,
		discoveredAt: session.discoveredAt ?? undefined,
		createdAt: session.createdAt,
		lastActiveAt: session.lastActiveAt
	};
}

export async function getSessionByClaudeId(claudeSessionId: string): Promise<SessionData | null> {
	const result = await db.select().from(sessions).where(eq(sessions.claudeSessionId, claudeSessionId)).limit(1);
	
	if (result.length === 0) {
		return null;
	}

	const session = result[0];
	return {
		...session,
		status: session.status as 'active' | 'inactive' | 'terminated' | 'crashed',
		hasBackendProcess: session.hasBackendProcess ?? false,
		useContinueFlag: session.useContinueFlag ?? false,
		canReinitialize: session.canReinitialize ?? false,
		metadata: session.metadata ?? undefined,
		claudeSessionId: session.claudeSessionId ?? undefined,
		claudeSessionPath: session.claudeSessionPath ?? undefined,
		isClaudeSession: session.isClaudeSession ?? false,
		discoveredAt: session.discoveredAt ?? undefined,
		createdAt: session.createdAt,
		lastActiveAt: session.lastActiveAt
	};
}

export async function getAllSessions(): Promise<SessionData[]> {
	const results = await db.select().from(sessions).orderBy(desc(sessions.lastActiveAt));
	
	return results.map(session => ({
		...session,
		status: session.status as 'active' | 'inactive' | 'terminated' | 'crashed',
		hasBackendProcess: session.hasBackendProcess ?? false,
		useContinueFlag: session.useContinueFlag ?? false,
		canReinitialize: session.canReinitialize ?? false,
		metadata: session.metadata ?? undefined,
		claudeSessionId: session.claudeSessionId ?? undefined,
		claudeSessionPath: session.claudeSessionPath ?? undefined,
		isClaudeSession: session.isClaudeSession ?? false,
		discoveredAt: session.discoveredAt ?? undefined,
		createdAt: session.createdAt,
		lastActiveAt: session.lastActiveAt
	}));
}

export async function updateSession(sessionId: string, updates: Partial<SessionData>): Promise<void> {
	const updateData: any = {};
	
	if (updates.name !== undefined) updateData.name = updates.name;
	if (updates.status !== undefined) updateData.status = updates.status;
	if (updates.lastActiveAt !== undefined) updateData.lastActiveAt = updates.lastActiveAt;
	if (updates.hasBackendProcess !== undefined) updateData.hasBackendProcess = updates.hasBackendProcess;
	if (updates.useContinueFlag !== undefined) updateData.useContinueFlag = updates.useContinueFlag;
	if (updates.canReinitialize !== undefined) updateData.canReinitialize = updates.canReinitialize;
	if (updates.metadata !== undefined) updateData.metadata = updates.metadata;

	await db.update(sessions).set(updateData).where(eq(sessions.sessionId, sessionId));
}

export async function deleteSession(sessionId: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.sessionId, sessionId));
}

export async function addSessionHistory(data: SessionHistoryData): Promise<void> {
	await db.insert(sessionHistory).values({
		sessionId: data.sessionId,
		timestamp: data.timestamp,
		type: data.type,
		content: data.content
	});
}

export async function getSessionHistory(sessionId: string, limit: number = 1000): Promise<SessionHistoryData[]> {
	const results = await db.select()
		.from(sessionHistory)
		.where(eq(sessionHistory.sessionId, sessionId))
		.orderBy(desc(sessionHistory.timestamp))
		.limit(limit);
	
	return results.map(entry => ({
		sessionId: entry.sessionId,
		timestamp: entry.timestamp,
		type: entry.type as 'input' | 'output',
		content: entry.content
	}));
}