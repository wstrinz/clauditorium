import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawn as ptySpawn } from '@lydell/node-pty';
import { randomBytes } from 'crypto';
import { addSession, getAllSessions as getMemorySessions, deleteSession, broadcastOutput } from './session-store';
import * as sessionDb from '$lib/server/services/session-db';
import { initDatabase } from '$lib/server/db/init';

// Initialize database on first load
let dbInitialized = false;
try {
	initDatabase();
	dbInitialized = true;
} catch (error) {
	console.error('Failed to initialize database:', error);
	// Continue without database if initialization fails
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { 
			workingDirectory = process.env.HOME || '~', 
			useContinueFlag = false,
			name = 'New Session'
		} = await request.json();
		
		const sessionId = `session-${Date.now()}-${randomBytes(4).toString('hex')}`;
		
		// Build claude command arguments
		const claudeArgs = useContinueFlag ? ['--continue'] : [];
		
		// Spawn claude code process with PTY
		const claudeProcess = ptySpawn('claude', claudeArgs, {
			name: 'xterm-color',
			cols: 80,
			rows: 24,
			cwd: workingDirectory,
			env: {
				...process.env,
				TERM: 'xterm-256color'
			}
		});

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
					useContinueFlag,
					canReinitialize: false,
					metadata: {}
				});
				createdAt = dbSession.createdAt;
			} catch (dbError) {
				console.error('Failed to save session to database:', dbError);
				// Continue without database
			}
		}

		// Set up process I/O handling
		claudeProcess.onData(async (data: string) => {
			broadcastOutput(sessionId, data);
			// Save output to database if available
			if (dbInitialized) {
				try {
					await sessionDb.addSessionHistory({
						sessionId,
						timestamp: new Date(),
						type: 'output',
						content: data
					});
				} catch (dbError) {
					// Ignore database errors for output logging
				}
			}
		});

		addSession(sessionId, {
			process: claudeProcess,
			sessionId,
			createdAt: createdAt,
			workingDirectory,
			inputStream: claudeProcess
		});

		// Clean up on process exit
		claudeProcess.onExit(async () => {
			deleteSession(sessionId);
			// Update session status in database if available
			if (dbInitialized) {
				try {
					await sessionDb.updateSession(sessionId, {
						status: 'terminated',
						hasBackendProcess: false,
						canReinitialize: true
					});
				} catch (dbError) {
					// Ignore database errors on exit
				}
			}
		});

		return json({
			sessionId,
			name,
			status: 'created',
			workingDirectory,
			createdAt: createdAt,
			hasBackendProcess: true,
			useContinueFlag,
			canReinitialize: false
		});
	} catch (error) {
		console.error('Failed to create session:', error);
		// Log more details about the error
		if (error instanceof Error) {
			console.error('Error message:', error.message);
			console.error('Error stack:', error.stack);
		}
		return json({ 
			error: 'Failed to create session', 
			details: error instanceof Error ? error.message : String(error) 
		}, { status: 500 });
	}
};

export const GET: RequestHandler = async () => {
	try {
		let sessions: any[] = [];
		
		// Try to get sessions from database first
		if (dbInitialized) {
			try {
				const dbSessions = await sessionDb.getAllSessions();
				sessions = dbSessions;
			} catch (dbError) {
				console.error('Failed to get sessions from database:', dbError);
			}
		}
		
		// Get active sessions from memory
		const memorySessions = getMemorySessions();
		
		// If no database sessions, create from memory sessions
		if (sessions.length === 0 && memorySessions.size > 0) {
			sessions = Array.from(memorySessions.entries()).map(([id, session]) => ({
				sessionId: id,
				name: 'Session',
				createdAt: session.createdAt,
				lastActiveAt: new Date(),
				workingDirectory: session.workingDirectory,
				status: 'active' as const,
				hasBackendProcess: true,
				useContinueFlag: false,
				canReinitialize: false
			}));
		} else {
			// Merge database sessions with memory state
			sessions = sessions.map(dbSession => {
				const isActive = memorySessions.has(dbSession.sessionId);
				return {
					...dbSession,
					// Override status if session is active in memory
					status: isActive ? 'active' : dbSession.status,
					hasBackendProcess: isActive || dbSession.hasBackendProcess
				};
			});
		}

		return json({ sessions });
	} catch (error) {
		console.error('Failed to get sessions:', error);
		return json({ sessions: [] });
	}
};