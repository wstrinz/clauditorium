export interface SessionInfo {
	sessionId: string;
	name: string;
	createdAt: Date;
	lastActiveAt: Date;
	workingDirectory: string;
	status: 'active' | 'inactive' | 'terminated' | 'crashed';
	hasBackendProcess: boolean;
	useContinueFlag: boolean;
	canReinitialize: boolean;
	metadata?: Record<string, any>;
	claudeSessionId?: string;
	claudeSessionPath?: string;
	isClaudeSession?: boolean;
	discoveredAt?: Date;
}

export class SessionAPI {
	private eventSources = new Map<string, EventSource>();

	async createSession(name: string, workingDirectory?: string, claudeSessionId?: string): Promise<SessionInfo> {
		const response = await fetch('/api/sessions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ 
				name, 
				workingDirectory, 
				claudeSessionId,
				isClaudeSession: !!claudeSessionId
			})
		});

		if (!response.ok) {
			throw new Error('Failed to create session');
		}

		return await response.json();
	}

	async getSessions(): Promise<SessionInfo[]> {
		const response = await fetch('/api/sessions');
		
		if (!response.ok) {
			throw new Error('Failed to get sessions');
		}

		const data = await response.json();
		return data.sessions;
	}

	async terminateSession(sessionId: string): Promise<void> {
		const response = await fetch(`/api/sessions/${sessionId}/terminate`, {
			method: 'POST'
		});

		if (!response.ok) {
			throw new Error('Failed to terminate session');
		}

		// Clean up event source if exists
		this.disconnectFromSession(sessionId);
	}

	async deleteSession(sessionId: string): Promise<void> {
		const response = await fetch(`/api/sessions/${sessionId}`, {
			method: 'DELETE'
		});

		if (!response.ok) {
			throw new Error('Failed to delete session');
		}

		// Clean up event source if exists
		this.disconnectFromSession(sessionId);
	}

	async sendInput(sessionId: string, input: string): Promise<void> {
		const response = await fetch(`/api/sessions/${sessionId}/terminal`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ input })
		});

		if (!response.ok) {
			throw new Error('Failed to send input');
		}
	}

	async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
		const response = await fetch(`/api/sessions/${sessionId}/resize`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ cols, rows })
		});

		if (!response.ok) {
			throw new Error('Failed to resize session');
		}
	}

	async restartSession(sessionId: string): Promise<SessionInfo> {
		const response = await fetch(`/api/sessions/${sessionId}/restart`, {
			method: 'POST'
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to restart session');
		}

		return await response.json();
	}

	connectToSession(sessionId: string, onOutput: (data: string) => void): Promise<void> {
		return new Promise((resolve, reject) => {
			// Close existing connection if any
			this.disconnectFromSession(sessionId);

			const eventSource = new EventSource(`/api/sessions/${sessionId}/terminal`);
			
			eventSource.onopen = () => {
				resolve();
			};

			eventSource.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data);
					if (message.type === 'output') {
						onOutput(message.data);
					}
				} catch (error) {
					console.error('Failed to parse message:', error);
				}
			};

			eventSource.onerror = (error) => {
				console.error('EventSource error:', error);
				this.disconnectFromSession(sessionId);
				reject(error);
			};

			this.eventSources.set(sessionId, eventSource);
		});
	}

	disconnectFromSession(sessionId: string): void {
		const eventSource = this.eventSources.get(sessionId);
		if (eventSource) {
			eventSource.close();
			this.eventSources.delete(sessionId);
		}
	}

	disconnectAll(): void {
		this.eventSources.forEach((eventSource) => {
			eventSource.close();
		});
		this.eventSources.clear();
	}
}

export const sessionAPI = new SessionAPI();