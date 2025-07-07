import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { readdir, stat, readFile } from 'fs/promises';
import { db } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';

interface ClaudeSessionMetadata {
	sessionId: string;
	cwd: string;
	timestamp: string;
	version?: string;
	lastMessageTime?: string;
	messageCount?: number;
}

interface ClaudeSession {
	sessionId: string;
	filePath: string;
	workingDirectory: string;
	createdAt: Date;
	lastActiveAt: Date;
	messageCount: number;
	version?: string;
}

export class ClaudeSessionDiscovery {
	private claudeDir: string;
	private projectsDir: string;

	constructor() {
		this.claudeDir = path.join(os.homedir(), '.claude');
		this.projectsDir = path.join(this.claudeDir, 'projects');
	}

	async discoverSessions(): Promise<ClaudeSession[]> {
		try {
			await stat(this.projectsDir);
		} catch (error) {
			console.warn('Claude projects directory not found:', this.projectsDir);
			return [];
		}

		const sessions: ClaudeSession[] = [];
		const projectDirs = await readdir(this.projectsDir, { withFileTypes: true });

		for (const dir of projectDirs) {
			if (dir.isDirectory()) {
				const projectPath = path.join(this.projectsDir, dir.name);
				const projectSessions = await this.discoverSessionsInProject(projectPath);
				sessions.push(...projectSessions);
			}
		}

		return sessions;
	}

	private async discoverSessionsInProject(projectPath: string): Promise<ClaudeSession[]> {
		const sessions: ClaudeSession[] = [];
		
		try {
			const files = await readdir(projectPath);
			const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

			for (const file of jsonlFiles) {
				const filePath = path.join(projectPath, file);
				const session = await this.parseSessionFile(filePath);
				if (session) {
					sessions.push(session);
				}
			}
		} catch (error) {
			console.warn('Error reading project directory:', projectPath, error);
		}

		return sessions;
	}

	private async parseSessionFile(filePath: string): Promise<ClaudeSession | null> {
		try {
			const content = await readFile(filePath, 'utf-8');
			const lines = content.trim().split('\n').filter(line => line.trim());
			
			if (lines.length === 0) return null;

			// Parse first line to get session metadata
			const firstLine = JSON.parse(lines[0]);
			const sessionId = firstLine.sessionId;
			const cwd = firstLine.cwd;
			const createdAt = new Date(firstLine.timestamp);
			
			if (!sessionId || !cwd) return null;

			// Parse last line to get last activity
			const lastLine = lines.length > 1 ? JSON.parse(lines[lines.length - 1]) : firstLine;
			const lastActiveAt = new Date(lastLine.timestamp);

			// Count messages
			const messageCount = lines.length;

			// Extract version if available
			const version = firstLine.version;

			return {
				sessionId,
				filePath,
				workingDirectory: cwd,
				createdAt,
				lastActiveAt,
				messageCount,
				version
			};
		} catch (error) {
			console.warn('Error parsing session file:', filePath, error);
			return null;
		}
	}

	async syncDiscoveredSessions(): Promise<{ discovered: number; updated: number }> {
		const claudeSessions = await this.discoverSessions();
		let discovered = 0;
		let updated = 0;

		for (const claudeSession of claudeSessions) {
			try {
				// Check if session already exists
				const existingSession = await db.query.sessions.findFirst({
					where: eq(sessions.claudeSessionId, claudeSession.sessionId)
				});

				if (existingSession) {
					// Update existing session
					await db.update(sessions)
						.set({
							lastActiveAt: claudeSession.lastActiveAt,
							claudeSessionPath: claudeSession.filePath,
							discoveredAt: new Date(),
							metadata: {
								...existingSession.metadata,
								messageCount: claudeSession.messageCount,
								version: claudeSession.version
							}
						})
						.where(eq(sessions.claudeSessionId, claudeSession.sessionId));
					updated++;
				} else {
					// Create new session record
					const sessionName = this.generateSessionName(claudeSession);
					await db.insert(sessions).values({
						sessionId: `claude-${claudeSession.sessionId}`,
						name: sessionName,
						createdAt: claudeSession.createdAt,
						lastActiveAt: claudeSession.lastActiveAt,
						status: 'inactive',
						workingDirectory: claudeSession.workingDirectory,
						hasBackendProcess: false,
						useContinueFlag: false,
						canReinitialize: true,
						claudeSessionId: claudeSession.sessionId,
						claudeSessionPath: claudeSession.filePath,
						isClaudeSession: true,
						discoveredAt: new Date(),
						metadata: {
							messageCount: claudeSession.messageCount,
							version: claudeSession.version,
							source: 'claude-cli'
						}
					});
					discovered++;
				}
			} catch (error) {
				console.error('Error syncing session:', claudeSession.sessionId, error);
			}
		}

		return { discovered, updated };
	}

	private generateSessionName(claudeSession: ClaudeSession): string {
		const dirName = path.basename(claudeSession.workingDirectory);
		const date = claudeSession.createdAt.toLocaleDateString();
		const time = claudeSession.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		return `${dirName} - ${date} ${time}`;
	}

	async getSessionHistory(claudeSessionId: string): Promise<any[]> {
		const sessionRecord = await db.query.sessions.findFirst({
			where: eq(sessions.claudeSessionId, claudeSessionId)
		});

		if (!sessionRecord?.claudeSessionPath) {
			throw new Error('Session file not found');
		}

		try {
			const content = await readFile(sessionRecord.claudeSessionPath, 'utf-8');
			const lines = content.trim().split('\n').filter(line => line.trim());
			return lines.map(line => JSON.parse(line));
		} catch (error) {
			console.error('Error reading session history:', error);
			return [];
		}
	}

	async isSessionActive(claudeSessionId: string): Promise<boolean> {
		// Check if there's an active Claude process for this session
		// This is a simplified check - in practice, you might want to check process lists
		const sessionRecord = await db.query.sessions.findFirst({
			where: eq(sessions.claudeSessionId, claudeSessionId)
		});

		return sessionRecord?.hasBackendProcess ?? false;
	}
}

export const claudeSessionDiscovery = new ClaudeSessionDiscovery();