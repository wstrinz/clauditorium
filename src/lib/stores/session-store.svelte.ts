import { sessionAPI, type SessionInfo } from '$lib/services/session-api';

// Shared session state using $state rune
export const sessionStore = $state({
	sessions: [] as SessionInfo[],
	activeSessionId: null as string | null,
	isLoading: false
});

// Computed values - export as function to avoid derived export error
export function getActiveSession() {
	return sessionStore.sessions.find(s => s.sessionId === sessionStore.activeSessionId);
}

// Actions
export async function loadSessions() {
	sessionStore.isLoading = true;
	try {
		sessionStore.sessions = await sessionAPI.getSessions();
		// Auto-select first active session if none selected
		const activeSessions = sessionStore.sessions.filter(s => s.status === 'active');
		if (activeSessions.length > 0 && !sessionStore.activeSessionId) {
			sessionStore.activeSessionId = activeSessions[0].sessionId;
		}
	} catch (error) {
		console.error('Failed to load sessions:', error);
		sessionStore.sessions = [];
	} finally {
		sessionStore.isLoading = false;
	}
}

export function setActiveSession(sessionId: string | null) {
	sessionStore.activeSessionId = sessionId;
}

export function refreshSessions() {
	console.log('Refreshing sessions...');
	return loadSessions();
}

// Helper to get current session count
export function getSessionCount() {
	return sessionStore.sessions.length;
}