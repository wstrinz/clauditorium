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
		return this.discoverAllSessions();
	}

	async discoverAllSessions(): Promise<ClaudeSession[]> {
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

		// Sort by lastActiveAt in descending order (most recent first)
		return sessions.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
	}

	async discoverLatestSessionPerProject(): Promise<ClaudeSession[]> {
		const allSessions = await this.discoverAllSessions();
		
		// Deduplicate by working directory - keep only the most recent session per project
		const deduplicatedSessions: ClaudeSession[] = [];
		const seenDirectories = new Set<string>();
		
		for (const session of allSessions) {
			if (!seenDirectories.has(session.workingDirectory)) {
				seenDirectories.add(session.workingDirectory);
				deduplicatedSessions.push(session);
			}
		}
		
		return deduplicatedSessions;
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

			// Find the first line with actual session data (skip summary lines)
			let sessionMetadata = null;
			let sessionId = null;
			let cwd = null;
			let createdAt = null;
			let version = null;

			for (const line of lines) {
				try {
					const parsedLine = JSON.parse(line);
					if (parsedLine.sessionId && parsedLine.cwd && parsedLine.timestamp) {
						sessionId = parsedLine.sessionId;
						cwd = parsedLine.cwd;
						createdAt = new Date(parsedLine.timestamp);
						version = parsedLine.version;
						sessionMetadata = parsedLine;
						break;
					}
				} catch (e) {
					// Skip malformed lines
					continue;
				}
			}

			if (!sessionId || !cwd || !createdAt) return null;

			// Find the most recent sessionId and timestamp (Claude sometimes changes session IDs mid-conversation)
			let mostRecentSessionId = sessionId;
			let lastActiveAt = createdAt;

			for (let i = lines.length - 1; i >= 0; i--) {
				try {
					const parsedLine = JSON.parse(lines[i]);
					if (parsedLine.sessionId && parsedLine.timestamp) {
						mostRecentSessionId = parsedLine.sessionId;
						lastActiveAt = new Date(parsedLine.timestamp);
						break;
					}
				} catch (e) {
					// Skip malformed lines
					continue;
				}
			}

			// Count actual message lines (not summary lines)
			const messageCount = lines.filter(line => {
				try {
					const parsed = JSON.parse(line);
					return parsed.sessionId && parsed.timestamp;
				} catch (e) {
					return false;
				}
			}).length;

			return {
				sessionId: mostRecentSessionId, // Use the most recent session ID
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