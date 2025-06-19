export interface SessionInfo {
	sessionId: string;
	createdAt: Date;
	workingDirectory: string;
	status: string;
}

export class SessionAPI {
	private eventSources = new Map<string, EventSource>();

	async createSession(workingDirectory?: string): Promise<SessionInfo> {
		const response = await fetch('/api/sessions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ workingDirectory })
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

	connectToSession(sessionId: string, onOutput: (data: string) => void): void {
		// Close existing connection if any
		this.disconnectFromSession(sessionId);

		const eventSource = new EventSource(`/api/sessions/${sessionId}/terminal`);
		
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
		};

		this.eventSources.set(sessionId, eventSource);
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