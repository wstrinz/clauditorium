import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const errorData = await request.json();
		
		console.error('CLIENT ERROR:', {
			error: errorData.error,
			url: errorData.url,
			userAgent: errorData.userAgent,
			stack: errorData.stack || 'No stack trace'
		});
		
		return json({ success: true });
	} catch (error) {
		console.error('Failed to log client error:', error);
		return json({ success: false }, { status: 500 });
	}
};