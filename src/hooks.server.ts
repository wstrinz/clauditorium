import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const start = Date.now();
	
	try {
		const response = await resolve(event);
		
		const duration = Date.now() - start;
		// Only log errors and slow requests to reduce noise
		if (response.status >= 400 || duration > 1000) {
			console.log(`${event.request.method} ${event.url.pathname} - ${response.status} (${duration}ms)`);
		}
		
		return response;
	} catch (error) {
		const duration = Date.now() - start;
		console.error(`${event.request.method} ${event.url.pathname} - ERROR (${duration}ms)`, error);
		throw error;
	}
};