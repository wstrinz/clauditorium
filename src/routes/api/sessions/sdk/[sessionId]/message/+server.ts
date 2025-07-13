import type { RequestHandler } from './$types';
import { activeSdkSessions } from '$lib/server/services/sdk-sessions';
import { SdkSessionManager } from '$lib/server/services/sdk-session-manager';
import { json } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	const { message, toolApprovals } = await request.json();
	
	// Note: Tool approvals are now handled via bypassPermissions mode in the SDK
	// This endpoint still accepts tool approval requests for backwards compatibility
	// but they're no longer needed since permissions are bypassed
	if (toolApprovals) {
		return json({ success: true, message: 'Tool approvals no longer needed (permissions bypassed)' });
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