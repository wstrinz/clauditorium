import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import { randomBytes } from 'crypto';
import * as sessionDb from '$lib/server/services/session-db';
import { initDatabase } from '$lib/server/db/init';
import { activeSdkSessions, type ActiveSdkSession } from '$lib/server/services/sdk-sessions';

// Initialize database on first load
let dbInitialized = false;
try {
	initDatabase();
	dbInitialized = true;
} catch (error) {
	console.error('Failed to initialize database:', error);
}

// Active SDK sessions are now imported from the shared module

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { 
			prompt,
			workingDirectory = process.env.HOME || '~', 
			name = 'New SDK Session',
			maxTurns = 10,
			resumeSessionId = null // For resuming SDK sessions
		} = await request.json();
		
		if (!prompt) {
			return json({ error: 'Prompt is required' }, { status: 400 });
		}
		
		const sessionId = `sdk-session-${Date.now()}-${randomBytes(4).toString('hex')}`;
		const abortController = new AbortController();
		
		// Save session to database if available
		let createdAt = new Date();
		if (dbInitialized) {
			try {
				const dbSession = await sessionDb.createSession({
					sessionId,
					name,
					status: 'active',
					workingDirectory,
					hasBackendProcess: true,
					useContinueFlag: false,
					canReinitialize: false,
					metadata: {
						source: 'sdk',
						prompt,
						maxTurns
					},
					sessionType: 'sdk',
					claudeSessionId: undefined,
					isClaudeSession: false,
					claudeSessionPath: undefined,
					discoveredAt: undefined
				});
				createdAt = dbSession.createdAt;
			} catch (dbError) {
				console.error('Failed to save session to database:', dbError);
			}
		}

		// Store session in memory
		const sessionData: ActiveSdkSession = {
			abortController,
			sessionId,
			createdAt,
			workingDirectory,
			messages: [],
			isCompleted: false
		};
		activeSdkSessions.set(sessionId, sessionData);

		// Start SDK query in background
		(async () => {
			try {
				for await (const message of query({
					prompt,
					abortController,
					options: {
						maxTurns,
						...(resumeSessionId ? { resumeSessionId } : {})
					},
				})) {
					sessionData.messages.push(message);
					
					// Save message to database
					if (dbInitialized) {
						try {
							// Note: This would require the sdkMessages table to exist
							// For now, we'll store in session history as JSON
							await sessionDb.addSessionHistory({
								sessionId,
								timestamp: new Date(),
								type: 'output',
								content: JSON.stringify(message)
							});
						} catch (dbError) {
							console.error('Failed to save SDK message:', dbError);
						}
					}
				}
				
				sessionData.isCompleted = true;
				
				// Update session status in database
				if (dbInitialized) {
					try {
						await sessionDb.updateSession(sessionId, {
							status: 'completed' as const,
							hasBackendProcess: false,
							lastActiveAt: new Date()
						});
					} catch (dbError) {
						console.error('Failed to update session status:', dbError);
					}
				}
				
			} catch (error) {
				console.error('SDK query failed:', error);
				sessionData.isCompleted = true;
				
				// Mark session as crashed
				if (dbInitialized) {
					try {
						await sessionDb.updateSession(sessionId, {
							status: 'crashed' as const,
							hasBackendProcess: false,
							lastActiveAt: new Date()
						});
					} catch (dbError) {
						console.error('Failed to update session status:', dbError);
					}
				}
			}
		})();

		return json({
			sessionId,
			name,
			status: 'created',
			workingDirectory,
			createdAt,
			hasBackendProcess: true,
			sessionType: 'sdk',
			prompt,
			maxTurns
		});
	} catch (error) {
		console.error('Failed to create SDK session:', error);
		return json({ 
			error: 'Failed to create SDK session', 
			details: error instanceof Error ? error.message : String(error) 
		}, { status: 500 });
	}
};

export const GET: RequestHandler = async ({ url }) => {
	try {
		const sessionId = url.searchParams.get('sessionId');
		
		if (sessionId) {
			// Get specific session
			const session = activeSdkSessions.get(sessionId);
			if (!session) {
				return json({ error: 'Session not found' }, { status: 404 });
			}
			
			return json({
				sessionId: session.sessionId,
				messages: session.messages,
				isCompleted: session.isCompleted,
				createdAt: session.createdAt,
				workingDirectory: session.workingDirectory
			});
		} else {
			// List all SDK sessions
			const sessions = Array.from(activeSdkSessions.values()).map(session => ({
				sessionId: session.sessionId,
				messageCount: session.messages.length,
				isCompleted: session.isCompleted,
				createdAt: session.createdAt,
				workingDirectory: session.workingDirectory
			}));
			
			return json({ sessions });
		}
	} catch (error) {
		console.error('Failed to get SDK sessions:', error);
		return json({ error: 'Failed to get SDK sessions' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url }) => {
	try {
		const sessionId = url.searchParams.get('sessionId');
		
		if (!sessionId) {
			return json({ error: 'Session ID required' }, { status: 400 });
		}
		
		const session = activeSdkSessions.get(sessionId);
		if (!session) {
			return json({ error: 'Session not found' }, { status: 404 });
		}
		
		// Abort the session
		session.abortController.abort();
		activeSdkSessions.delete(sessionId);
		
		// Update database
		if (dbInitialized) {
			try {
				await sessionDb.updateSession(sessionId, {
					status: 'terminated' as const,
					hasBackendProcess: false,
					lastActiveAt: new Date()
				});
			} catch (dbError) {
				console.error('Failed to update session status:', dbError);
			}
		}
		
		return json({ success: true });
	} catch (error) {
		console.error('Failed to delete SDK session:', error);
		return json({ error: 'Failed to delete SDK session' }, { status: 500 });
	}
};