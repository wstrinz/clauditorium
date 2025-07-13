import type { RequestHandler } from './$types';
import { activeSdkSessions } from '$lib/server/services/sdk-sessions';
import { SdkSessionManager } from '$lib/server/services/sdk-session-manager';
import { json } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	const { message, toolApprovals } = await request.json();
	
	// Handle tool approvals
	if (toolApprovals) {
		try {
			for (const [toolUseId, approved] of Object.entries(toolApprovals as Record<string, boolean>)) {
				SdkSessionManager.approveToolUse(sessionId, toolUseId, approved);
			}
			return json({ success: true, message: 'Tool approvals processed' });
		} catch (error) {
			console.error('Failed to process tool approvals:', error);
			return json({ 
				error: 'Failed to process tool approvals',
				details: error instanceof Error ? error.message : 'Unknown error'
			}, { status: 500 });
		}
	}
	
	// Handle new message
	if (!message || typeof message !== 'string') {
		return json({ error: 'Message is required' }, { status: 400 });
	}
	
	// Get the active SDK session
	const session = activeSdkSessions.get(sessionId);
	if (!session) {
		return json({ error: 'Session not found or inactive' }, { status: 404 });
	}
	
	// For completed sessions, we allow resuming via continueSession
	// The session manager will handle resetting the completion status
	
	try {
		// Continue the conversation using the session manager
		await SdkSessionManager.continueSession(sessionId, message);
		
		return json({ 
			success: true, 
			message: 'Message sent successfully',
			sessionId 
		});
	} catch (error) {
		console.error('Failed to send message to Claude session:', error);
		return json({ 
			error: 'Failed to send message',
			details: error instanceof Error ? error.message : 'Unknown error'
		}, { status: 500 });
	}
};