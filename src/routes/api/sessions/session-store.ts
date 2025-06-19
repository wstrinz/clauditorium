import type { IPty } from '@lydell/node-pty';

interface SessionData {
	process: IPty;
	sessionId: string;
	createdAt: Date;
	workingDirectory: string;
	inputStream?: IPty;
	outputHandlers: Set<(data: string) => void>;
}

// In-memory session storage
const sessions = new Map<string, SessionData>();

export function addSession(sessionId: string, data: Omit<SessionData, 'outputHandlers'>) {
	sessions.set(sessionId, {
		...data,
		outputHandlers: new Set()
	});
}

export function getSession(sessionId: string): SessionData | undefined {
	return sessions.get(sessionId);
}

export function deleteSession(sessionId: string) {
	const session = sessions.get(sessionId);
	if (session) {
		session.outputHandlers.clear();
		sessions.delete(sessionId);
	}
}

export function getAllSessions() {
	return sessions;
}

export function addOutputHandler(sessionId: string, handler: (data: string) => void) {
	const session = sessions.get(sessionId);
	if (session) {
		session.outputHandlers.add(handler);
	}
}

export function removeOutputHandler(sessionId: string, handler: (data: string) => void) {
	const session = sessions.get(sessionId);
	if (session) {
		session.outputHandlers.delete(handler);
	}
}

export function broadcastOutput(sessionId: string, data: string) {
	const session = sessions.get(sessionId);
	if (session) {
		session.outputHandlers.forEach(handler => handler(data));
	}
}