import type { RequestHandler } from './$types';
import { getSession, addOutputHandler, removeOutputHandler } from '../../session-store';

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
			// Send initial connection message
			controller.enqueue(`data: {"type":"connected","sessionId":"${sessionId}"}\n\n`);

			// Handler for output data
			const outputHandler = (data: string) => {
				const message = JSON.stringify({ type: 'output', data });
				controller.enqueue(`data: ${message}\n\n`);
			};

			// Add handler
			addOutputHandler(sessionId, outputHandler);

			// Clean up on close
			return () => {
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