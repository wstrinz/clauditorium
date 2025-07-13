import type { RequestHandler } from './$types';
import { activeSdkSessions } from '$lib/server/services/sdk-sessions';

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	
	// Create a readable stream for SSE
	const stream = new ReadableStream({
		start(controller) {
			let isControllerClosed = false;
			let lastMessageIndex = 0;
			
			// Send initial connection message
			try {
				controller.enqueue(`data: {"type":"connected","sessionId":"${sessionId}"}\n\n`);
			} catch (error) {
				console.warn('Failed to send initial SSE message:', error);
				isControllerClosed = true;
			}

			// Function to send new messages
			const sendNewMessages = () => {
				if (isControllerClosed) return;
				
				const session = activeSdkSessions.get(sessionId);
				if (!session) {
					try {
						controller.enqueue(`data: {"type":"error","message":"Session not found"}\n\n`);
						controller.close();
					} catch (error) {
						console.warn('Failed to send error message:', error);
					}
					isControllerClosed = true;
					return;
				}
				
				// Send any new messages
				const newMessages = session.messages.slice(lastMessageIndex);
				for (const message of newMessages) {
					if (isControllerClosed) break;
					
					try {
						const sseMessage = JSON.stringify({ 
							type: 'sdk_message', 
							data: message,
							timestamp: new Date().toISOString()
						});
						controller.enqueue(`data: ${sseMessage}\n\n`);
					} catch (error) {
						if (error instanceof TypeError && error.message.includes('Controller is already closed')) {
							console.log('SSE controller closed for session:', sessionId);
							isControllerClosed = true;
							break;
						} else {
							console.error('Failed to send SSE message:', error);
						}
					}
				}
				
				lastMessageIndex = session.messages.length;
				
				// Send completion message if session is done
				if (session.isCompleted && !isControllerClosed) {
					try {
						controller.enqueue(`data: {"type":"completed","sessionId":"${sessionId}"}\n\n`);
						controller.close();
						isControllerClosed = true;
					} catch (error) {
						console.warn('Failed to send completion message:', error);
					}
				}
			};

			// Poll for new messages every 100ms
			const pollInterval = setInterval(() => {
				if (isControllerClosed) {
					clearInterval(pollInterval);
					return;
				}
				sendNewMessages();
			}, 100);

			// Clean up on close
			return () => {
				isControllerClosed = true;
				clearInterval(pollInterval);
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