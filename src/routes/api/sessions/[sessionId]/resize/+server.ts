import type { RequestHandler } from './$types';
import { getSession } from '../../session-store';

export const POST: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	const session = getSession(sessionId);
	
	if (!session) {
		return new Response('Session not found', { status: 404 });
	}

	try {
		const { cols, rows } = await request.json();
		
		// Resize the PTY
		if (session.process && cols && rows) {
			session.process.resize(cols, rows);
		}
		
		return new Response('OK');
	} catch (error) {
		console.error('Failed to resize session:', error);
		return new Response('Failed to resize session', { status: 500 });
	}
};