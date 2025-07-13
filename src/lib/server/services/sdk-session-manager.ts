import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import { activeSdkSessions, type ActiveSdkSession } from './sdk-sessions';
import * as sessionDb from './session-db';

export class SdkSessionManager {
	/**
	 * Start a new SDK session or continue an existing one
	 */
	static async startSession(options: {
		sessionId: string;
		prompt: string;
		workingDirectory: string;
		maxTurns?: number;
		name?: string;
		continueFrom?: string; // Session ID to continue from
	}): Promise<ActiveSdkSession> {
		const { sessionId, prompt, workingDirectory, maxTurns = 10, name = 'SDK Session', continueFrom } = options;
		
		// Create abort controller for this session
		const abortController = new AbortController();
		
		// Initialize session data
		const sessionData: ActiveSdkSession = {
			abortController,
			sessionId,
			createdAt: new Date(),
			workingDirectory,
			messages: [],
			isCompleted: false,
			isPaused: false,
			pendingToolApprovals: new Map()
		};
		
		// Store session
		activeSdkSessions.set(sessionId, sessionData);
		
		// Save to database
		try {
			await sessionDb.createSession({
				sessionId,
				name,
				status: 'active',
				workingDirectory,
				hasBackendProcess: true,
				useContinueFlag: false,
				canReinitialize: false,
				metadata: {
					source: 'sdk',
					prompt,
					maxTurns,
					continueFrom
				},
				sessionType: 'sdk',
				isClaudeSession: false
			});
		} catch (error) {
			console.error('Failed to save session to database:', error);
		}
		
		// Start the query in the background (don't await it)
		this.runQuery(sessionData, prompt, { maxTurns, resume: continueFrom }).catch(error => {
			console.error('Query failed for session', sessionId, ':', error);
		});
		
		return sessionData;
	}
	
	/**
	 * Continue a conversation in an existing session
	 */
	static async continueSession(sessionId: string, message: string): Promise<void> {
		const session = activeSdkSessions.get(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}
		
		if (!session.claudeSessionId) {
			throw new Error('No Claude session ID found - cannot continue conversation');
		}
		
		// Reset completion status since we're continuing
		session.isCompleted = false;
		
		// Update database status to active
		try {
			await sessionDb.updateSession(sessionId, {
				status: 'active' as const,
				hasBackendProcess: true,
				lastActiveAt: new Date()
			});
		} catch (error) {
			console.error('Failed to update session status for continuation:', error);
		}
		
		// Create a new query with the resume parameter to continue from where we left off
		this.runQuery(session, message, { 
			resume: session.claudeSessionId 
		}).catch(error => {
			console.error('Query failed for session', sessionId, ':', error);
		});
	}
	
	/**
	 * Approve or deny a tool use
	 */
	static approveToolUse(sessionId: string, toolUseId: string, approved: boolean): void {
		const session = activeSdkSessions.get(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}
		
		// Update approval status
		session.pendingToolApprovals?.set(toolUseId, approved);
		
		// Check if all pending tools are resolved
		const allResolved = Array.from(session.pendingToolApprovals?.values() || [])
			.every(status => status !== undefined);
		
		if (allResolved && session.isPaused) {
			// Resume the session
			session.isPaused = false;
			// In a real implementation, this would signal the paused generator to continue
			console.log('All tool uses resolved, session can continue');
		}
	}
	
	/**
	 * Run a query and stream messages
	 */
	private static async runQuery(
		session: ActiveSdkSession, 
		prompt: string, 
		options: { maxTurns?: number; continue?: boolean; resume?: string } = {}
	): Promise<void> {
		try {
			// When resuming, we clear existing messages to avoid duplication
			// The SDK will regenerate the full conversation context including previous messages
			const isResume = !!options.resume;
			if (isResume) {
				console.log('Resuming session - clearing previous messages to avoid duplication');
				session.messages = [];
			}
			
			// Create the query generator
			const generator = query({
				prompt,
				abortController: session.abortController,
				options: {
					maxTurns: options.maxTurns,
					...(options.continue ? { continue: true } : {}),
					...(options.resume ? { resume: options.resume } : {})
				}
			});
			
			session.currentQueryGenerator = generator;
			
			// Process messages
			for await (const message of generator) {
				// Store message
				session.messages.push(message);
				
				// Extract Claude session ID from system messages
				if (message.type === 'system') {
					const systemMsg = message as any;
					if (systemMsg.session_id) {
						session.claudeSessionId = systemMsg.session_id;
					}
				}
				
				// Check for tool use requests
				if (message.type === 'assistant') {
					const assistantMsg = message as any;
					const toolUses = assistantMsg.message?.content?.filter((c: any) => c.type === 'tool_use') || [];
					
					if (toolUses.length > 0) {
						// Mark tools as pending approval
						for (const toolUse of toolUses) {
							session.pendingToolApprovals?.set(toolUse.id, false);
						}
						
						// Pause the session to wait for approval
						session.isPaused = true;
						
						// In a real implementation, we would need to handle pausing the generator
						// For now, the SDK doesn't support pausing mid-stream, so tool approval
						// is more of a UI feature than actual control
					}
				}
				
				// Save message to database
				try {
					await sessionDb.addSessionHistory({
						sessionId: session.sessionId,
						timestamp: new Date(),
						type: 'output',
						content: JSON.stringify(message)
					});
				} catch (error) {
					console.error('Failed to save message to database:', error);
				}
			}
			
			// Mark session as completed
			session.isCompleted = true;
			
			// Update database
			try {
				await sessionDb.updateSession(session.sessionId, {
					status: 'completed' as const,
					hasBackendProcess: false,
					lastActiveAt: new Date()
				});
			} catch (error) {
				console.error('Failed to update session status:', error);
			}
			
		} catch (error) {
			console.error('SDK query failed:', error);
			session.isCompleted = true;
			
			// Mark session as crashed
			try {
				await sessionDb.updateSession(session.sessionId, {
					status: 'crashed' as const,
					hasBackendProcess: false,
					lastActiveAt: new Date()
				});
			} catch (error) {
				console.error('Failed to update session status:', error);
			}
			
			throw error;
		}
	}
	
	/**
	 * Terminate a session
	 */
	static terminateSession(sessionId: string): void {
		const session = activeSdkSessions.get(sessionId);
		if (session) {
			session.abortController.abort();
			session.isCompleted = true;
			activeSdkSessions.delete(sessionId);
		}
	}
}