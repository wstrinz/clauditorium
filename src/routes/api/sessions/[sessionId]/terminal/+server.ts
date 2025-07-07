import type { RequestHandler } from './$types';
import { getSession, addOutputHandler, removeOutputHandler } from '../../session-store';
import * as sessionDb from '$lib/server/services/session-db';

export const POST: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	const session = getSession(sessionId);
	
	if (!session) {
		return new Response('Session not found', { status: 404 });
	}

	try {
		const { input } = await request.json();
		
		// Write input to the Claude process via PTY
		if (session.process && input) {
			session.process.write(input);
			
			// Save input to database
			await sessionDb.addSessionHistory({
				sessionId,
				timestamp: new Date(),
				type: 'input',
				content: input
			});
			
			// Update last active time
			await sessionDb.updateSession(sessionId, {
				lastActiveAt: new Date()
			});
		}
		
		return new Response('OK');
	} catch (error) {
		console.error('Failed to send input:', error);
		return new Response('Failed to send input', { status: 500 });
	}
};

// Server-sent events for output streaming
export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	const session = getSession(sessionId);
	
	if (!session) {
		return new Response('Session not found', { status: 404 });
	}

	// Create a readable stream for SSE
	const stream = new ReadableStream({
		start(controller) {
			let isControllerClosed = false;
			
			// Send initial connection message
			try {
				controller.enqueue(`data: {"type":"connected","sessionId":"${sessionId}"}\n\n`);
			} catch (error) {
				console.warn('Failed to send initial SSE message:', error);
				isControllerClosed = true;
			}

			// Handler for output data
			const outputHandler = (data: string) => {
				if (isControllerClosed) {
					// Remove handler if controller is closed
					removeOutputHandler(sessionId, outputHandler);
					return;
				}
				
				try {
					const message = JSON.stringify({ type: 'output', data });
					controller.enqueue(`data: ${message}\n\n`);
				} catch (error) {
					if (error instanceof TypeError && error.message.includes('Controller is already closed')) {
						console.log('SSE controller closed for session:', sessionId);
						isControllerClosed = true;
						removeOutputHandler(sessionId, outputHandler);
					} else {
						console.error('Failed to send SSE message:', error);
					}
				}
			};

			// Add handler
			addOutputHandler(sessionId, outputHandler);

			// Clean up on close
			return () => {
				isControllerClosed = true;
				removeOutputHandler(sessionId, outputHandler);
			};
		},
		cancel() {
			// Cleanup handled by start's return function
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive'
		}
	});
};