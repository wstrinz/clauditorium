import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Import shared sessions map (in production, use proper session management)
import { getSession, deleteSession } from '../session-store';
import * as sessionDb from '$lib/server/services/session-db';

export const DELETE: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	
	const session = getSession(sessionId);
	if (session) {
		// Kill active process if exists
		try {
			session.process.kill();
			deleteSession(sessionId);
		} catch (error) {
			console.error('Failed to terminate process:', error);
		}
	}

	// Delete from database
	try {
		await sessionDb.deleteSession(sessionId);
		return json({ status: 'deleted' });
	} catch (error) {
		console.error('Failed to delete session:', error);
		return json({ error: 'Failed to delete session' }, { status: 500 });
	}
};

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	
	// Check if session is active in memory
	const memorySession = getSession(sessionId);
	
	// Get session from database
	const dbSession = await sessionDb.getSession(sessionId);
	
	if (!dbSession) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	return json({
		...dbSession,
		// Override status if session is active in memory
		status: memorySession ? 'active' : dbSession.status,
		hasBackendProcess: !!memorySession || dbSession.hasBackendProcess
	});
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	
	try {
		const body = await request.json();
		
		// Get existing session
		const existingSession = await sessionDb.getSession(sessionId);
		if (!existingSession) {
			return json({ error: 'Session not found' }, { status: 404 });
		}
		
		// Update session with new name
		if (body.name !== undefined) {
			await sessionDb.updateSession(sessionId, { name: body.name });
		}
		
		// Return updated session
		const updatedSession = await sessionDb.getSession(sessionId);
		return json(updatedSession);
		
	} catch (error) {
		console.error('Failed to update session:', error);
		return json({ error: 'Failed to update session' }, { status: 500 });
	}
};