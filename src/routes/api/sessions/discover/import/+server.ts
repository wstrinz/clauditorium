import { json } from '@sveltejs/kit';
import { claudeSessionDiscovery } from '$lib/server/services/claude-session-discovery.js';
import * as sessionDb from '$lib/server/services/session-db.js';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { claudeSessionIds } = await request.json();
		
		if (!Array.isArray(claudeSessionIds) || claudeSessionIds.length === 0) {
			return json(
				{ success: false, error: 'No session IDs provided' },
				{ status: 400 }
			);
		}

		// Get all discoverable sessions
		const discoverableSessions = await claudeSessionDiscovery.discoverSessions();
		const sessionMap = new Map(
			discoverableSessions.map(s => [s.sessionId, s])
		);

		let imported = 0;
		const errors: string[] = [];

		for (const claudeSessionId of claudeSessionIds) {
			const claudeSession = sessionMap.get(claudeSessionId);
			
			if (!claudeSession) {
				errors.push(`Session ${claudeSessionId} not found`);
				continue;
			}

			try {
				// Check if already exists
				const existing = await sessionDb.getSessionByClaudeId(claudeSessionId);
				if (existing) {
					errors.push(`Session ${claudeSessionId} already imported`);
					continue;
				}

				// Generate session name
				const sessionName = generateSessionName(claudeSession);
				
				// Import the session
				await sessionDb.createSession({
					sessionId: `claude-${claudeSession.sessionId}`,
					name: sessionName,
					status: 'inactive',
					workingDirectory: claudeSession.workingDirectory,
					hasBackendProcess: false,
					useContinueFlag: false,
					canReinitialize: true,
					claudeSessionId: claudeSession.sessionId,
					claudeSessionPath: claudeSession.filePath,
					isClaudeSession: true,
					discoveredAt: new Date(),
					metadata: {
						messageCount: claudeSession.messageCount,
						version: claudeSession.version,
						source: 'imported'
					}
				});
				
				imported++;
			} catch (error) {
				console.error(`Error importing session ${claudeSessionId}:`, error);
				errors.push(`Failed to import ${claudeSessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		}

		return json({
			success: true,
			imported,
			errors,
			message: `Successfully imported ${imported} sessions${errors.length > 0 ? ` (${errors.length} errors)` : ''}`
		});
	} catch (error) {
		console.error('Error importing Claude sessions:', error);
		return json(
			{ 
				success: false, 
				error: 'Failed to import Claude sessions',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};

function generateSessionName(claudeSession: { workingDirectory: string; createdAt: Date }): string {
	const dirName = claudeSession.workingDirectory.split('/').pop() || 'Unknown';
	const date = claudeSession.createdAt.toLocaleDateString();
	const time = claudeSession.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	return `${dirName} - ${date} ${time}`;
}