import Dexie, { type Table } from 'dexie';

export interface Session {
	id?: number;
	sessionId: string;
	name: string;
	createdAt: Date;
	lastActiveAt: Date;
	status: 'active' | 'inactive' | 'terminated' | 'crashed';
	workingDirectory: string;
	history: string[];
	hasBackendProcess?: boolean;
	useContinueFlag?: boolean;
	canReinitialize?: boolean;
	metadata?: Record<string, any>;
}

export interface SessionOutput {
	id?: number;
	sessionId: string;
	timestamp: Date;
	type: 'input' | 'output' | 'error';
	content: string;
}

export class ClauditoriumDB extends Dexie {
	sessions!: Table<Session>;
	sessionOutputs!: Table<SessionOutput>;

	constructor() {
		super('clauditorium');
		
		this.version(1).stores({
			sessions: '++id, sessionId, status, createdAt, lastActiveAt',
			sessionOutputs: '++id, sessionId, timestamp'
		});
	}

	async createSession(session: Omit<Session, 'id'>): Promise<Session> {
		const id = await this.sessions.add(session);
		const newSession = await this.sessions.get(id);
		if (!newSession) throw new Error('Failed to create session');
		return newSession;
	}

	async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
		await this.sessions.where('sessionId').equals(sessionId).modify(updates);
	}

	async getSession(sessionId: string): Promise<Session | undefined> {
		return await this.sessions.where('sessionId').equals(sessionId).first();
	}

	async getAllSessions(): Promise<Session[]> {
		return await this.sessions.toArray();
	}

	async getActiveSessions(): Promise<Session[]> {
		return await this.sessions.where('status').equals('active').toArray();
	}

	async addOutput(output: Omit<SessionOutput, 'id'>): Promise<void> {
		await this.sessionOutputs.add(output);
	}

	async getSessionOutputs(sessionId: string, limit?: number): Promise<SessionOutput[]> {
		let query = this.sessionOutputs.where('sessionId').equals(sessionId);
		if (limit) {
			return await query.reverse().limit(limit).toArray();
		}
		return await query.toArray();
	}

	async clearSessionOutputs(sessionId: string): Promise<void> {
		await this.sessionOutputs.where('sessionId').equals(sessionId).delete();
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.sessions.where('sessionId').equals(sessionId).delete();
		await this.clearSessionOutputs(sessionId);
	}
}

export const db = new ClauditoriumDB();