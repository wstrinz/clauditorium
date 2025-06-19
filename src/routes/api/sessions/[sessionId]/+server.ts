import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Import shared sessions map (in production, use proper session management)
import { getSession, deleteSession } from '../session-store';

export const DELETE: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	
	const session = getSession(sessionId);
	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	try {
		session.process.kill();
		deleteSession(sessionId);
		
		return json({ status: 'terminated' });
	} catch (error) {
		console.error('Failed to terminate session:', error);
		return json({ error: 'Failed to terminate session' }, { status: 500 });
	}
};

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	
	const session = getSession(sessionId);
	if (!session) {
		return json({ error: 'Session not found' }, { status: 404 });
	}

	return json({
		sessionId,
		createdAt: session.createdAt,
		workingDirectory: session.workingDirectory,
		status: 'active'
	});
};