import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { spawn as ptySpawn } from '@lydell/node-pty';
import { getSession, deleteSession, addSession, broadcastOutput } from '../../session-store';
import * as sessionDb from '$lib/server/services/session-db';
import { db } from '$lib/server/db';
import { sessions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ params }) => {
	const { sessionId } = params;

	// Get existing session from memory and database
	const existingSession = getSession(sessionId);
	const dbSession = await sessionDb.getSession(sessionId);
	
	if (!dbSession) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	// Kill existing process if running
	if (existingSession?.process) {
		try {
			existingSession.process.kill();
		} catch (error) {
			console.error('Failed to kill existing process:', error);
		}
	}

	// Remove from session store
	deleteSession(sessionId);

	// Determine restart strategy based on session type
	let claudeArgs: string[] = [];
	if (dbSession.claudeSessionId) {
		// Session has a Claude session ID - use --resume
		claudeArgs = ['--resume', dbSession.claudeSessionId];
	} else {
		// Regular session - use --continue to restart in same directory
		claudeArgs = ['--continue'];
	}

	// Start new Claude process
	try {
		const claudeProcess = ptySpawn('claude', claudeArgs, {
			name: 'xterm-color',
			cols: 80,
			rows: 24,
			cwd: dbSession.workingDirectory,
			env: {
				...process.env,
				TERM: 'xterm-256color'
			}
		});

		// Add new session to store
		addSession(sessionId, {
			process: claudeProcess,
			sessionId,
			createdAt: dbSession.createdAt,
			workingDirectory: dbSession.workingDirectory,
			inputStream: claudeProcess
		});

		// Handle process output
		claudeProcess.onData((data: string) => {
			broadcastOutput(sessionId, data);
		});

		// Handle process exit
		claudeProcess.onExit(({ exitCode, signal }) => {
			console.log(`Session ${sessionId} process exited with code ${exitCode}, signal ${signal}`);
			
			// Update database status
			updateSessionStatus(sessionId, exitCode === 0 ? 'terminated' : 'crashed');
			
			// Clean up
			deleteSession(sessionId);
		});

		// Update database
		await updateSessionStatus(sessionId, 'active');

		return json({
			sessionId,
			status: 'restarted',
			workingDirectory: dbSession.workingDirectory,
			isClaudeSession: dbSession.isClaudeSession,
			claudeSessionId: dbSession.claudeSessionId
		});
	} catch (error: any) {
		console.error('Failed to restart session:', error);
		return json({ error: error.message || 'Failed to restart session' }, { status: 500 });
	}
};

async function updateSessionStatus(sessionId: string, status: string) {
	try {
		await db.update(sessions)
			.set({ 
				status,
				lastActiveAt: new Date()
			})
			.where(eq(sessions.sessionId, sessionId));
	} catch (error) {
		console.error('Failed to update session status in database:', error);
		// Continue even if DB update fails
	}
}