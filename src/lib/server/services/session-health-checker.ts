import * as sessionDb from './session-db.js';
import { getAllSessions as getMemorySessions } from '../../../routes/api/sessions/session-store.js';

export class SessionHealthChecker {
	private checkInterval: NodeJS.Timeout | null = null;

	start() {
		// Check every 30 seconds
		this.checkInterval = setInterval(() => {
			this.checkSessionHealth();
		}, 30000);
		
		// Also check immediately on startup
		setTimeout(() => this.checkSessionHealth(), 1000);
	}

	stop() {
		if (this.checkInterval) {
			clearInterval(this.checkInterval);
			this.checkInterval = null;
		}
	}

	private async checkSessionHealth() {
		try {
			// Get all sessions marked as active in database
			const dbSessions = await sessionDb.getAllSessions();
			const activeSessions = dbSessions.filter(s => s.status === 'active' && s.hasBackendProcess);
			
			// Get actually running sessions from memory
			const memorySessions = getMemorySessions();
			
			// Find sessions that are marked active but not actually running
			const staleSessions = activeSessions.filter(dbSession => 
				!memorySessions.has(dbSession.sessionId)
			);

			// Mark stale sessions as crashed
			for (const staleSession of staleSessions) {
				console.log(`Detected stale session: ${staleSession.sessionId} (${staleSession.name})`);
				await sessionDb.updateSession(staleSession.sessionId, {
					status: 'crashed',
					hasBackendProcess: false,
					canReinitialize: true,
					lastActiveAt: new Date()
				});
			}

			if (staleSessions.length > 0) {
				console.log(`Marked ${staleSessions.length} stale sessions as crashed`);
			}
		} catch (error) {
			console.error('Error checking session health:', error);
		}
	}

	async markAllSessionsAsCrashed() {
		try {
			// On server startup, mark all active sessions as crashed
			// since they won't survive server restarts
			const dbSessions = await sessionDb.getAllSessions();
			const activeSessions = dbSessions.filter(s => s.status === 'active' && s.hasBackendProcess);
			
			for (const session of activeSessions) {
				await sessionDb.updateSession(session.sessionId, {
					status: 'crashed',
					hasBackendProcess: false,
					canReinitialize: true
				});
			}

			if (activeSessions.length > 0) {
				console.log(`Marked ${activeSessions.length} sessions as crashed on server startup`);
			}
		} catch (error) {
			console.error('Error marking sessions as crashed on startup:', error);
		}
	}
}

export const sessionHealthChecker = new SessionHealthChecker();