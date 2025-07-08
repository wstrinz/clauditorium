import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { sessions, sessionHistory } from '$lib/server/db/schema.js';

export const POST: RequestHandler = async () => {
	try {
		// Delete all session history first (due to foreign key constraints)
		await db.delete(sessionHistory);
		// Delete all sessions
		await db.delete(sessions);
		
		return json({
			success: true,
			message: 'Database reset successfully'
		});
	} catch (error) {
		console.error('Error resetting database:', error);
		return json(
			{
				success: false,
				error: 'Failed to reset database',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};