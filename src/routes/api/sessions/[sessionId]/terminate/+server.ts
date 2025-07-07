import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getSession, deleteSession } from '../../session-store.js';
import * as sessionDb from '$lib/server/services/session-db.js';

export const POST: RequestHandler = async ({ params }) => {
	const { sessionId } = params;

	if (!sessionId) {
		return json({ success: false, error: 'Session ID is required' }, { status: 400 });
	}

	try {
		// Get the running session
		const runningSession = getSession(sessionId);
		
		if (runningSession?.process) {
			try {
				// Kill the process
				runningSession.process.kill('SIGTERM');
			} catch (error) {
				console.error('Failed to kill process:', error);
				// Try force kill
				try {
					runningSession.process.kill('SIGKILL');
				} catch (forceError) {
					console.error('Failed to force kill process:', forceError);
				}
			}
		}

		// Remove from memory store
		deleteSession(sessionId);

		// Update database to mark as terminated (not deleted)
		await sessionDb.updateSession(sessionId, {
			status: 'terminated',
			hasBackendProcess: false,
			lastActiveAt: new Date()
		});

		return json({
			success: true,
			sessionId,
			status: 'terminated'
		});
	} catch (error) {
		console.error('Failed to terminate session:', error);
		return json(
			{ 
				success: false, 
				error: 'Failed to terminate session',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};