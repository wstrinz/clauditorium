import { json } from '@sveltejs/kit';
import { claudeSessionDiscovery } from '$lib/server/services/claude-session-discovery.js';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async () => {
	try {
		// This endpoint is now deprecated in favor of the selective import
		// But we keep it for backward compatibility
		const result = await claudeSessionDiscovery.syncDiscoveredSessions();
		
		return json({
			success: true,
			discovered: result.discovered,
			updated: result.updated,
			message: `Auto-imported ${result.discovered} new sessions and updated ${result.updated} existing sessions. Use /browse for selective import.`
		});
	} catch (error) {
		console.error('Error discovering Claude sessions:', error);
		return json(
			{ 
				success: false, 
				error: 'Failed to discover Claude sessions',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async () => {
	try {
		const sessions = await claudeSessionDiscovery.discoverSessions();
		
		return json({
			success: true,
			sessions: sessions.map(session => ({
				sessionId: session.sessionId,
				workingDirectory: session.workingDirectory,
				createdAt: session.createdAt.toISOString(),
				lastActiveAt: session.lastActiveAt.toISOString(),
				messageCount: session.messageCount,
				version: session.version,
				filePath: session.filePath
			}))
		});
	} catch (error) {
		console.error('Error listing Claude sessions:', error);
		return json(
			{ 
				success: false, 
				error: 'Failed to list Claude sessions',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};