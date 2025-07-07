import { json } from '@sveltejs/kit';
import { claudeSessionDiscovery } from '$lib/server/services/claude-session-discovery.js';
import * as sessionDb from '$lib/server/services/session-db.js';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
	try {
		// Get all discoverable sessions
		const discoverableSessions = await claudeSessionDiscovery.discoverSessions();
		
		// Get sessions already in our database
		const existingSessions = await sessionDb.getAllSessions();
		const existingClaudeIds = new Set(
			existingSessions
				.filter(s => s.claudeSessionId)
				.map(s => s.claudeSessionId!)
		);

		// Filter out sessions we've already imported
		const newSessions = discoverableSessions.filter(
			session => !existingClaudeIds.has(session.sessionId)
		);

		return json({
			success: true,
			sessions: newSessions.map(session => ({
				claudeSessionId: session.sessionId,
				workingDirectory: session.workingDirectory,
				createdAt: session.createdAt.toISOString(),
				lastActiveAt: session.lastActiveAt.toISOString(),
				messageCount: session.messageCount,
				version: session.version,
				filePath: session.filePath,
				projectName: session.workingDirectory.split('/').pop() || 'Unknown'
			})),
			totalFound: discoverableSessions.length,
			alreadyImported: existingClaudeIds.size
		});
	} catch (error) {
		console.error('Error browsing Claude sessions:', error);
		return json(
			{ 
				success: false, 
				error: 'Failed to browse Claude sessions',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};