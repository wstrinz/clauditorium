import type { SDKMessage } from '@anthropic-ai/claude-code';

export interface ActiveSdkSession {
	abortController: AbortController;
	sessionId: string;
	createdAt: Date;
	workingDirectory: string;
	messages: SDKMessage[];
	isCompleted: boolean;
	claudeSessionId?: string; // The Claude session ID for resuming
	currentQueryGenerator?: AsyncGenerator<SDKMessage>; // Current query generator
	isPaused?: boolean; // Whether the session is paused waiting for tool approval
	pendingToolApprovals?: Map<string, boolean>; // Tool use IDs pending approval
}

// Store active SDK sessions
export const activeSdkSessions = new Map<string, ActiveSdkSession>();