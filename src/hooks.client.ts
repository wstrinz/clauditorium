import type { HandleClientError } from '@sveltejs/kit';

// Log client-side errors to console and optionally send to server
export const handleError: HandleClientError = ({ error, event, status, message }) => {
	const errorObj = error instanceof Error ? error : new Error(String(error));
	
	console.error('Client-side error:', {
		error: errorObj,
		event,
		status,
		message,
		stack: errorObj.stack,
		url: event?.url?.href
	});
	
	// Note: Removed automatic server logging to prevent request loops
	
	return {
		message: 'Something went wrong',
		code: status?.toString() || 'UNKNOWN'
	};
};