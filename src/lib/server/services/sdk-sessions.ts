import type { SDKMessage } from '@anthropic-ai/claude-code';

export interface ActiveSdkSession {
	abortController: AbortController;
	sessionId: string;
	createdAt: Date;
	workingDirectory: string;
	messages: SDKMessage[];
	isCompleted: boolean;
}

// Store active SDK sessions
export const activeSdkSessions = new Map<string, ActiveSdkSession>();