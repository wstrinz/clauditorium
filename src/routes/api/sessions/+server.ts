import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawn as ptySpawn } from '@lydell/node-pty';
import { randomBytes } from 'crypto';
import { addSession, getAllSessions, deleteSession, broadcastOutput } from './session-store';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { workingDirectory = process.env.HOME || '~' } = await request.json();
		
		const sessionId = `session-${Date.now()}-${randomBytes(4).toString('hex')}`;
		
		// Spawn claude code process with PTY
		const claudeProcess = ptySpawn('claude', [], {
			name: 'xterm-color',
			cols: 80,
			rows: 24,
			cwd: workingDirectory,
			env: {
				...process.env,
				TERM: 'xterm-256color'
			}
		});

		// Set up process I/O handling
		claudeProcess.onData((data: string) => {
			broadcastOutput(sessionId, data);
		});

		addSession(sessionId, {
			process: claudeProcess,
			sessionId,
			createdAt: new Date(),
			workingDirectory,
			inputStream: claudeProcess
		});

		// Clean up on process exit
		claudeProcess.onExit(() => {
			deleteSession(sessionId);
		});

		return json({
			sessionId,
			status: 'created',
			workingDirectory
		});
	} catch (error) {
		console.error('Failed to create session:', error);
		return json({ error: 'Failed to create session' }, { status: 500 });
	}
};

export const GET: RequestHandler = async () => {
	const sessions = getAllSessions();
	const activeSessions = Array.from(sessions.entries()).map(([id, session]) => ({
		sessionId: id,
		createdAt: session.createdAt,
		workingDirectory: session.workingDirectory,
		status: 'active'
	}));

	return json({ sessions: activeSessions });
};