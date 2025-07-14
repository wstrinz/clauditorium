import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomBytes } from 'crypto';
import * as sessionDb from '$lib/server/services/session-db';
import { initDatabase } from '$lib/server/db/init';
import { activeSdkSessions } from '$lib/server/services/sdk-sessions';
import { SdkSessionManager } from '$lib/server/services/sdk-session-manager';

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
			continueFrom = null // For continuing from existing sessions
		} = await request.json();
		
		if (!prompt) {
			return json({ error: 'Prompt is required' }, { status: 400 });
		}
		
		const sessionId = `sdk-session-${Date.now()}-${randomBytes(4).toString('hex')}`;
		
		// Start session using the new session manager
		const sessionData = await SdkSessionManager.startSession({
			sessionId,
			prompt,
			workingDirectory,
			maxTurns,
			name,
			continueFrom
		});

		return json({
			sessionId: sessionData.sessionId,
			name,
			status: 'created',
			workingDirectory: sessionData.workingDirectory,
			createdAt: sessionData.createdAt,
			hasBackendProcess: true,
			sessionType: 'sdk',
			prompt,
			maxTurns,
			claudeSessionId: sessionData.claudeSessionId
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
			
			// Try to get additional metadata from database
			let metadata = {};
			try {
				const dbSession = await sessionDb.getSession(sessionId);
				if (dbSession && dbSession.metadata) {
					metadata = {
						prompt: dbSession.metadata.prompt,
						maxTurns: dbSession.metadata.maxTurns,
						name: dbSession.name
					};
				}
			} catch (error) {
				console.error('Failed to fetch session metadata:', error);
			}
			
			return json({
				sessionId: session.sessionId,
				messages: session.messages,
				isCompleted: session.isCompleted,
				createdAt: session.createdAt,
				workingDirectory: session.workingDirectory,
				...metadata
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
		
		// Terminate the session using the session manager
		SdkSessionManager.terminateSession(sessionId);
		
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