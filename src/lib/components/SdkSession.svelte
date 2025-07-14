<script lang="ts">
	import type { SDKMessage } from '@anthropic-ai/claude-code';
	import { toolApprovalStore } from '$lib/stores/tool-approvals';
	
	interface Props {
		sessionId: string;
		onSessionComplete?: (sessionId: string) => void;
	}

	let { 
		sessionId,
		onSessionComplete = $bindable<(sessionId: string) => void>()
	}: Props = $props();
	
	// Store session metadata including initial prompt
	let sessionMetadata = $state<{
		prompt?: string;
		name?: string;
		workingDirectory?: string;
		maxTurns?: number;
	}>({});

	let messages = $state<SDKMessage[]>([]);
	let isConnected = $state(false);
	let isCompleted = $state(false);
	let error = $state<string | null>(null);
	let eventSource: EventSource | null = null;
	let messagesContainer: HTMLElement | undefined;
	let autoScroll = $state(true);
	let isScrollingProgrammatically = false;
	
	// Group messages into conversation steps with enhanced hierarchy
	const conversationSteps = $derived(() => {
		const steps: Array<{
			id: string;
			messages: SDKMessage[];
			isExpanded: boolean;
			summary: string;
			type: 'system' | 'conversation' | 'tool_execution' | 'result' | 'user_message' | 'assistant_response';
			status: 'completed' | 'in_progress' | 'pending';
			startTime: Date | null;
			endTime: Date | null;
			duration: number | null;
			toolCount: number;
			hasError: boolean;
		}> = [];
		
		let currentStep: SDKMessage[] = [];
		let stepId = 0;
		
		// If we have an initial prompt and no messages yet, or if the first message isn't a user message with the prompt,
		// add the initial prompt as the first user message
		let messagesToProcess = [...messages];
		if (sessionMetadata.prompt && 
			(messages.length === 0 || 
			 messages[0].type !== 'user' || 
			 !(messages[0] as any).message?.content?.[0]?.text?.includes(sessionMetadata.prompt))) {
			
			const initialPromptMessage: SDKMessage = {
				type: 'user',
				message: {
					content: [{ type: 'text', text: sessionMetadata.prompt }]
				},
				parent_tool_use_id: null,
				session_id: 'initial-prompt'
			} as unknown as SDKMessage;
			messagesToProcess = [initialPromptMessage, ...messages];
		}
		
		for (const message of messagesToProcess) {
			// Improved turn detection for better conversation flow
			const shouldStartNewStep = 
				message.type === 'system' ||
				message.type === 'result' ||
				// Always start new step for user messages (except tool results)
				(message.type === 'user' && !isToolResultForPreviousRequest(message, currentStep)) ||
				// Start new step when switching from user to assistant (new Claude response)
				(currentStep.length > 0 && 
				 currentStep[currentStep.length - 1].type === 'user' && 
				 message.type === 'assistant' &&
				 // But not if the user message was just tool results
				 !isToolResultForPreviousRequest(currentStep[currentStep.length - 1], currentStep.slice(0, -1)));
			
			if (shouldStartNewStep && currentStep.length > 0) {
				// Finish current step
				const stepMessages = [...currentStep];
				const stepInfo = analyzeStep(stepMessages);
				
				steps.push({
					id: `step-${stepId++}`,
					messages: stepMessages,
					isExpanded: false, // Will be determined after all steps are processed
					...stepInfo
				});
				currentStep = [];
			}
			
			currentStep.push(message);
		}
		
		// Add final step if any messages remain
		if (currentStep.length > 0) {
			const stepInfo = analyzeStep(currentStep);
			
			steps.push({
				id: `step-${stepId++}`,
				messages: currentStep,
				isExpanded: false, // Will be determined after all steps are processed
				...stepInfo
			});
		}
		
		// Now determine expansion state for all steps
		const totalSteps = steps.length;
		for (let i = 0; i < steps.length; i++) {
			steps[i].isExpanded = determineInitialExpansion(i, steps[i].type, isConnected, totalSteps);
		}
		
		// Mark last step as in progress if session is connected and active
		console.log('🔍 Session state check:', {
			isConnected,
			isCompleted,
			stepsCount: steps.length,
			lastStepType: steps.length > 0 ? steps[steps.length - 1].type : 'none',
			lastStepStatus: steps.length > 0 ? steps[steps.length - 1].status : 'none'
		});
		
		if (isConnected && steps.length > 0 && !isCompleted) {
			const lastStep = steps[steps.length - 1];
			console.log('🔍 Checking last step for in_progress:', {
				stepType: lastStep.type,
				currentStatus: lastStep.status,
				shouldMarkInProgress: lastStep.type === 'conversation' || lastStep.type === 'assistant_response'
			});
			// Mark as in progress if it's a conversation or assistant response
			if (lastStep.type === 'conversation' || lastStep.type === 'assistant_response') {
				console.log('✅ Marking last step as in_progress');
				lastStep.status = 'in_progress';
			}
		}
		
		return steps;
	});

	function isToolResultForPreviousRequest(message: SDKMessage, currentStep: SDKMessage[]): boolean {
		if (message.type !== 'user') return false;
		
		const userMsg = message as any;
		const hasToolResults = userMsg.message?.content?.some((c: any) => c.type === 'tool_result');
		if (!hasToolResults) return false;
		
		// Check if any previous assistant message in current step has tool_use
		const lastAssistantMsg = currentStep.filter(m => m.type === 'assistant').pop() as any;
		if (!lastAssistantMsg?.message?.content) return false;
		
		return lastAssistantMsg.message.content.some((c: any) => c.type === 'tool_use');
	}

	function analyzeStep(messages: SDKMessage[]) {
		const firstMessage = messages[0];
		const lastMessage = messages[messages.length - 1];
		
		// Extract timestamps if available
		const startTime = (firstMessage as any).timestamp ? new Date((firstMessage as any).timestamp) : null;
		const endTime = (lastMessage as any).timestamp ? new Date((lastMessage as any).timestamp) : null;
		const duration = startTime && endTime ? endTime.getTime() - startTime.getTime() : null;
		
		// Analyze message types
		const userMsgs = messages.filter(m => m.type === 'user').length;
		const assistantMsgs = messages.filter(m => m.type === 'assistant').length;
		const toolRequests = messages.filter(m => 
			m.type === 'assistant' && (m as any).message?.content?.some((c: any) => c.type === 'tool_use')
		).length;
		const toolResults = messages.filter(m => 
			m.type === 'user' && (m as any).message?.content?.some((c: any) => c.type === 'tool_result')
		).length;
		
		// Determine step type
		let type: 'system' | 'conversation' | 'tool_execution' | 'result' | 'user_message' | 'assistant_response';
		let summary: string;
		let status: 'completed' | 'in_progress' | 'pending';
		
		// Debug logging for step analysis
		console.log('🔍 Analyzing step:', {
			firstMessageType: firstMessage.type,
			messageTypes: messages.map(m => m.type),
			userMsgs,
			assistantMsgs,
			toolRequests,
			toolResults,
			messageCount: messages.length
		});
		
		if (firstMessage.type === 'system') {
			type = 'system';
			summary = '🔧 System initialization';
			status = 'completed';
		} else if (firstMessage.type === 'result') {
			type = 'result';
			summary = '🏁 Session completed';
			status = 'completed';
		} else if (userMsgs > 0 && assistantMsgs === 0) {
			// Pure user message step
			type = 'user_message';
			const userMessage = messages.find(m => m.type === 'user');
			const messageText = (userMessage as any)?.message?.content?.[0]?.text || '';
			const preview = messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText;
			summary = `💬 ${preview}`;
			status = 'completed';
		} else if (assistantMsgs > 0) {
			// Assistant response (may include tools)
			type = 'assistant_response';
			if (toolRequests > 0) {
				summary = `🤖 Claude response with ${toolRequests} tool${toolRequests !== 1 ? 's' : ''}`;
				// More sophisticated status detection
				// Check if we have outstanding tool calls without results
				let hasOutstandingTools = false;
				const lastAssistantMsg = messages.filter(m => m.type === 'assistant').pop();
				if (lastAssistantMsg && (lastAssistantMsg as any).message?.content) {
					const lastToolUses = (lastAssistantMsg as any).message.content.filter((c: any) => c.type === 'tool_use');
					if (lastToolUses.length > 0) {
						// Check if we have tool results for these tool uses
						const toolUseIds = lastToolUses.map((t: any) => t.id);
						const subsequentMessages = messages.slice(messages.indexOf(lastAssistantMsg) + 1);
						const resultIds = subsequentMessages.flatMap(m => 
							(m as any).message?.content?.filter((c: any) => c.type === 'tool_result')?.map((c: any) => c.tool_use_id) || []
						);
						hasOutstandingTools = toolUseIds.some((id: string) => !resultIds.includes(id));
					}
				}
				status = hasOutstandingTools || pendingToolApprovals.size > 0 ? 'in_progress' : 'completed';
				// Debug logging for status detection
				if (toolRequests > 0) {
					console.log('🔍 Step status debug:', {
						hasOutstandingTools,
						pendingToolApprovals: pendingToolApprovals.size,
						toolRequests,
						toolResults,
						finalStatus: status,
						stepSummary: summary
					});
				}
			} else {
				summary = `🤖 Claude response`;
				status = 'completed';
			}
		} else {
			// Fallback for other types
			type = 'conversation';
			summary = `💬 Conversation (${messages.length} message${messages.length !== 1 ? 's' : ''})`;
			status = 'completed';
		}
		
		// Check for errors
		const hasError = messages.some(m => (m as any).error || (m as any).message?.error);
		
		return {
			summary,
			type,
			status,
			startTime,
			endTime,
			duration,
			toolCount: Math.max(toolRequests, toolResults),
			hasError
		};
	}

	function determineInitialExpansion(stepIndex: number, stepType: string, isConnected: boolean, totalSteps: number): boolean {
		// Always expand system initialization and results
		if (stepType === 'system' || stepType === 'result') return true;
		
		// Always expand user messages
		if (stepType === 'user_message') return true;
		
		// For assistant responses, show different amounts based on connection status
		if (stepType === 'assistant_response') {
			// For active sessions, only show current and previous step
			if (isConnected) {
				return stepIndex >= Math.max(0, totalSteps - 2);
			}
			// For completed sessions, show last 3 steps
			return stepIndex >= Math.max(0, totalSteps - 3);
		}
		
		// For other types, use the original logic
		if (isConnected) {
			return stepIndex >= Math.max(0, totalSteps - 2);
		}
		return stepIndex >= Math.max(0, totalSteps - 3);
	}

	// Session progress overview
	const sessionProgress = $derived(() => {
		const steps = conversationSteps();
		const completedSteps = steps.filter(s => s.status === 'completed').length;
		const inProgressSteps = steps.filter(s => s.status === 'in_progress').length;
		const totalDuration = steps.reduce((acc, s) => acc + (s.duration || 0), 0);
		
		// Calculate total token usage
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCacheTokens = 0;
		
		messages.forEach(message => {
			if (message.type === 'assistant' && (message as any).message?.usage) {
				const usage = (message as any).message.usage;
				totalInputTokens += usage.input_tokens || 0;
				totalOutputTokens += usage.output_tokens || 0;
				totalCacheTokens += usage.cache_creation_input_tokens || 0;
			}
		});
		
		return {
			steps,
			completedSteps,
			inProgressSteps,
			totalDuration,
			tokenUsage: {
				input: totalInputTokens,
				output: totalOutputTokens,
				cache: totalCacheTokens,
				total: totalInputTokens + totalOutputTokens
			}
		};
	});
	
	let expandedSteps = $state<Set<string>>(new Set());
	let chatInput = $state('');
	let isSending = $state(false);
	let pendingToolApprovals = $state<Map<string, {
		toolUseId: string;
		toolName: string;
		input: any;
		message: any;
		approved: boolean;
	}>>(new Map());
	
	// Tool approval patterns - remember approvals for similar tool calls
	let approvedToolPatterns = $state<Set<string>>(new Set());
	let expandedToolDetails = $state<Set<string>>(new Set());
	let showAllPendingTools = $state(false);
	
	// Subscribe to tool approval store to get reactive updates
	let toolApprovalSettings = $state($toolApprovalStore);
	
	$effect(() => {
		const unsubscribe = toolApprovalStore.subscribe(value => {
			console.log('🔄 Tool approval store updated:', {
				globalTools: Array.from(value.globallyApprovedTools),
				sessionTools: Array.from(value.sessionApprovedTools)
			});
			toolApprovalSettings = value;
		});
		
		return unsubscribe;
	});
	
	function toggleStep(stepId: string) {
		if (expandedSteps.has(stepId)) {
			expandedSteps.delete(stepId);
		} else {
			expandedSteps.add(stepId);
		}
		expandedSteps = new Set(expandedSteps);
	}
	
	// Initialize expanded steps based on initial state (only on first load)
	let hasInitializedExpansion = $state(false);
	$effect(() => {
		if (!hasInitializedExpansion) {
			const steps = conversationSteps();
			const initiallyExpanded = new Set<string>();
			for (const step of steps) {
				if (step.isExpanded) {
					initiallyExpanded.add(step.id);
				}
			}
			expandedSteps = initiallyExpanded;
			hasInitializedExpansion = true;
		}
	});

	function toggleToolDetails(toolUseId: string) {
		if (expandedToolDetails.has(toolUseId)) {
			expandedToolDetails.delete(toolUseId);
		} else {
			expandedToolDetails.add(toolUseId);
		}
		expandedToolDetails = new Set(expandedToolDetails);
	}

	// Generate a pattern string for a tool call to check for auto-approval
	function generateToolPattern(toolName: string, input: any): string {
		// Create a simplified pattern based on tool name and key parameters
		// This allows for fuzzy matching of similar tool calls
		const keyParams = Object.keys(input || {}).sort().slice(0, 3); // Use up to 3 key params
		return `${toolName}:${keyParams.join(',')}`;
	}

	// Check if a tool call matches an approved pattern
	function shouldAutoApprove(toolName: string, input: any): boolean {
		const pattern = generateToolPattern(toolName, input);
		
		console.log('🔍 Tool approval check:', {
			toolName,
			pattern,
			globalTools: Array.from(toolApprovalSettings.globallyApprovedTools),
			sessionTools: Array.from(toolApprovalSettings.sessionApprovedTools),
			globalPatterns: Array.from(toolApprovalSettings.globallyApprovedPatterns),
			sessionPatterns: Array.from(toolApprovalSettings.sessionApprovedPatterns)
		});
		
		// Check global tool approval first
		if (toolApprovalSettings.globallyApprovedTools.has(toolName)) {
			console.log('✅ Auto-approved via global tool:', toolName);
			return true;
		}
		
		// Check session tool approval
		if (toolApprovalSettings.sessionApprovedTools.has(toolName)) {
			console.log('✅ Auto-approved via session tool:', toolName);
			return true;
		}
		
		// Check pattern approvals
		if (toolApprovalSettings.globallyApprovedPatterns.has(pattern) || 
			toolApprovalSettings.sessionApprovedPatterns.has(pattern)) {
			console.log('✅ Auto-approved via pattern:', pattern);
			return true;
		}
		
		// Check local session patterns (legacy)
		if (approvedToolPatterns.has(pattern) || approvedToolPatterns.has(toolName)) {
			console.log('✅ Auto-approved via legacy pattern:', pattern, toolName);
			return true;
		}
		
		console.log('❌ Manual approval required for:', toolName);
		return false;
	}

	// Format tool input with proper handling of long strings and newlines
	function formatToolInput(input: any): string {
		if (!input || typeof input !== 'object') {
			return String(input || '');
		}

		const formatted = Object.entries(input).map(([key, value]) => {
			let valueStr = String(value);
			
			// Handle long strings by truncating and showing preview
			if (valueStr.length > 100) {
				valueStr = valueStr.substring(0, 100) + '... (truncated)';
			}
			
			// Replace literal \n with actual newlines for better display
			valueStr = valueStr.replace(/\\n/g, '\n');
			
			return `${key}: ${valueStr}`;
		}).join('\n');

		return formatted;
	}

	// Generate a summary of tool input for compact display
	function getToolInputSummary(input: any): string {
		if (!input || typeof input !== 'object') {
			const str = String(input || '');
			return str.length > 50 ? str.substring(0, 50) + '...' : str;
		}

		const keys = Object.keys(input);
		if (keys.length === 0) return 'No parameters';
		if (keys.length === 1) {
			const value = String(input[keys[0]]);
			return `${keys[0]}: ${value.length > 30 ? value.substring(0, 30) + '...' : value}`;
		}
		return `${keys.length} parameters: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
	}
	
	async function sendMessage() {
		if (!chatInput.trim() || isSending || !sessionId) return;
		
		const message = chatInput.trim();
		chatInput = '';
		isSending = true;
		
		try {
			// If session is completed, we need to reconnect to SSE first
			if (isCompleted && !eventSource) {
				connect();
			}
			
			const response = await fetch(`/api/sessions/sdk/${sessionId}/message`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ message })
			});
			
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
				throw new Error(`Failed to send message: ${response.statusText} - ${errorData.error || errorData.details || ''}`);
			}
			
			// Reset completion status since we're continuing
			isCompleted = false;
			
			// Message will be received via SSE stream
		} catch (err) {
			console.error('Failed to send message:', err);
			error = 'Failed to send message';
			chatInput = message; // Restore message on error
		} finally {
			isSending = false;
		}
	}
	
	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}
	
	// Detect tool use requests that need approval
	function extractToolUseRequests(message: SDKMessage) {
		if (message.type === 'assistant') {
			const assistantMsg = message as any;
			if (assistantMsg.message?.content) {
				const toolUses = assistantMsg.message.content.filter((c: any) => c.type === 'tool_use');
				console.log('📥 Extracted tool uses from message:', toolUses.map((t: any) => ({ name: t.name, id: t.id })));
				
				let hasNewTools = false;
				for (const toolUse of toolUses) {
					if (!pendingToolApprovals.has(toolUse.id)) {
						console.log('🔄 Processing new tool request:', toolUse.name, toolUse.id);
						
						// First, discover and auto-approve new tools
						const wasNewlyDiscovered = toolApprovalStore.discoverAndAutoApproveTool(toolUse.name);
						
						// Check if this tool should be auto-approved (re-check after discovery)
						const autoApprove = shouldAutoApprove(toolUse.name, toolUse.input);
						
						if (wasNewlyDiscovered && autoApprove) {
							console.log('🎉 Newly discovered tool is now auto-approved:', toolUse.name);
						}
						
						pendingToolApprovals.set(toolUse.id, {
							toolUseId: toolUse.id,
							toolName: toolUse.name,
							input: toolUse.input,
							message: assistantMsg,
							approved: autoApprove
						});
						hasNewTools = true;
						
						// If auto-approved, send approval immediately
						if (autoApprove) {
							console.log('⚡ Auto-approving tool immediately:', toolUse.name);
							// Use microtask to ensure the pending approval is set first
							Promise.resolve().then(() => {
								if (pendingToolApprovals.has(toolUse.id)) {
									approveToolUse(toolUse.id);
								} else {
									console.log('⚠️ Tool approval was already processed:', toolUse.name);
								}
							});
						} else {
							console.log('⏸️ Tool requires manual approval:', toolUse.name);
						}
					} else {
						console.log('🔄 Tool already in pending approvals:', toolUse.name);
					}
				}
				// Only update the map reference if we actually added something new
				if (hasNewTools) {
					pendingToolApprovals = new Map(pendingToolApprovals);
				}
			}
		}
	}
	
	async function approveToolUse(toolUseId: string) {
		const approval = pendingToolApprovals.get(toolUseId);
		if (approval) {
			console.log('🚀 Approving tool use:', toolUseId, approval.toolName);
			approval.approved = true;
			
			// Send approval to backend
			await sendToolApprovals();
			
			// Remove from pending list after successful approval
			pendingToolApprovals.delete(toolUseId);
			pendingToolApprovals = new Map(pendingToolApprovals);
			console.log('✅ Tool approval completed for:', approval.toolName);
		} else {
			console.log('❌ No approval found for tool use:', toolUseId);
		}
	}

	async function approveToolPattern(toolUseId: string, patternType: 'tool' | 'pattern') {
		const approval = pendingToolApprovals.get(toolUseId);
		if (approval) {
			// Add pattern to approved list (use global store)
			if (patternType === 'tool') {
				toolApprovalStore.addSessionTool(approval.toolName);
			} else {
				const pattern = generateToolPattern(approval.toolName, approval.input);
				toolApprovalStore.addSessionPattern(pattern);
			}
			
			// Approve this specific tool use
			await approveToolUse(toolUseId);
			
			// Auto-approve any other pending tools that match this pattern
			for (const [otherToolId, otherApproval] of pendingToolApprovals) {
				if (!otherApproval.approved && shouldAutoApprove(otherApproval.toolName, otherApproval.input)) {
					setTimeout(() => approveToolUse(otherToolId), 50);
				}
			}
		}
	}

	function clearToolPatterns() {
		approvedToolPatterns.clear();
		approvedToolPatterns = new Set(approvedToolPatterns);
		toolApprovalStore.clearSessionApprovals();
	}
	
	async function denyToolUse(toolUseId: string) {
		const approval = pendingToolApprovals.get(toolUseId);
		if (approval) {
			approval.approved = false;
			
			// Send denial to backend
			await sendToolApprovals();
			
			// Remove from pending list after denial
			pendingToolApprovals.delete(toolUseId);
			pendingToolApprovals = new Map(pendingToolApprovals);
		}
	}
	
	async function sendToolApprovals() {
		if (!sessionId) return;
		
		const approvals: Record<string, boolean> = {};
		for (const [toolUseId, approval] of pendingToolApprovals) {
			approvals[toolUseId] = approval.approved;
		}
		
		try {
			const response = await fetch(`/api/sessions/sdk/${sessionId}/message`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ toolApprovals: approvals })
			});
			
			if (!response.ok) {
				throw new Error(`Failed to send tool approvals: ${response.statusText}`);
			}
			
			console.log('Tool approvals sent successfully');
		} catch (err) {
			console.error('Failed to send tool approvals:', err);
			error = 'Failed to send tool approvals';
		}
	}
	
	// Track processed messages to avoid processing the same message multiple times
	let processedMessageCount = $state(0);
	
	// Check for tool use requests when new messages arrive
	$effect(() => {
		// Only process new messages that haven't been processed yet
		for (let i = processedMessageCount; i < messages.length; i++) {
			extractToolUseRequests(messages[i]);
		}
		processedMessageCount = messages.length;
		
		// Clear pending approvals when session completes
		if (isCompleted && pendingToolApprovals.size > 0) {
			pendingToolApprovals.clear();
		}
	});

	// Fetch session metadata including initial prompt
	async function fetchSessionMetadata() {
		if (!sessionId) return;
		
		try {
			const response = await fetch(`/api/sessions/sdk?sessionId=${sessionId}`);
			if (response.ok) {
				const data = await response.json();
				sessionMetadata = {
					prompt: data.prompt,
					name: data.name,
					workingDirectory: data.workingDirectory,
					maxTurns: data.maxTurns
				};
			}
		} catch (err) {
			console.error('Failed to fetch session metadata:', err);
		}
	}

	// Connect to SSE stream
	function connect() {
		try {
			if (!sessionId) {
				console.error('No sessionId provided');
				error = 'No session ID';
				return;
			}

			// Close existing connection if any
			if (eventSource) {
				eventSource.close();
				eventSource = null;
			}

			const url = `/api/sessions/sdk/${sessionId}/stream`;
			console.log('Connecting to SDK session:', url);
			eventSource = new EventSource(url);
			
			eventSource.onopen = () => {
				console.log('SSE connection opened');
				isConnected = true;
				error = null;
			};

			eventSource.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					
					switch (data.type) {
						case 'connected':
							console.log('Connected to SDK session:', data.sessionId);
							break;
						case 'sdk_message':
							messages = [...messages, data.data];
							break;
						case 'completed':
							isCompleted = true;
							isConnected = false;
							error = null; // Clear any previous errors
							if (eventSource) {
								eventSource.close();
								eventSource = null;
							}
							if (onSessionComplete) {
								onSessionComplete(sessionId);
							}
							break;
						case 'error':
							error = data.message;
							isConnected = false;
							break;
					}
				} catch (err) {
					console.error('Failed to parse SSE message:', err, event.data);
				}
			};

			eventSource.onerror = (err) => {
				console.error('SSE error:', err);
				isConnected = false;
				
				// Only show error if session is not completed
				if (!isCompleted) {
					error = 'Connection lost';
				}
			};
		} catch (err) {
			console.error('Failed to connect:', err);
			error = 'Failed to connect';
		}
	}

	// Auto-connect on mount with proper cleanup
	$effect(() => {
		// Fetch session metadata when sessionId changes
		if (sessionId) {
			fetchSessionMetadata();
		}
		
		// Connect if we have a session and no existing connection
		// For completed sessions, we'll connect when user sends a message
		if (sessionId && !eventSource && !isCompleted) {
			connect();
		}
		
		return () => {
			if (eventSource) {
				eventSource.close();
				eventSource = null;
			}
		};
	});

	function reconnect() {
		if (!isCompleted) {
			connect();
		}
	}

	async function terminateSession() {
		try {
			await fetch(`/api/sessions/sdk?sessionId=${sessionId}`, {
				method: 'DELETE'
			});
			isCompleted = true;
			isConnected = false;
		} catch (err) {
			console.error('Failed to terminate session:', err);
		}
	}

	function scrollToBottom() {
		if (messagesContainer) {
			isScrollingProgrammatically = true;
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
			// Reset flag after scroll completes
			setTimeout(() => {
				isScrollingProgrammatically = false;
			}, 50);
		}
	}

	function handleScroll() {
		if (!messagesContainer || isScrollingProgrammatically) return;
		
		const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
		const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5; // 5px tolerance
		
		// Auto-enable scrolling if user scrolls to bottom
		if (isAtBottom && !autoScroll) {
			autoScroll = true;
		}
		// Disable auto-scroll if user scrolls up
		else if (!isAtBottom && autoScroll) {
			autoScroll = false;
		}
	}

	// Auto-scroll to bottom when new messages arrive
	let previousMessageCount = $state(0);
	$effect(() => {
		const currentCount = messages.length;
		if (messagesContainer && currentCount > previousMessageCount && autoScroll) {
			setTimeout(() => scrollToBottom(), 10);
		}
		previousMessageCount = currentCount;
	});

	// Create a map of tool use ID to tool request details
	const toolRequestMap = $derived(() => {
		const map = new Map();
		messages.forEach(message => {
			if (message.type === 'assistant') {
				const assistantMsg = message as any;
				if (assistantMsg.message?.content) {
					assistantMsg.message.content.forEach((c: any) => {
						if (c.type === 'tool_use') {
							map.set(c.id, {
								name: c.name,
								input: c.input,
								message: assistantMsg
							});
						}
					});
				}
			}
		});
		return map;
	});

	function formatMessageContent(message: SDKMessage): string {
		switch (message.type) {
			case 'system':
				const systemMsg = message as any;
				return `🔧 System initialized\n• Session: ${systemMsg.session_id}\n• Model: ${systemMsg.model}\n• Tools: ${systemMsg.tools?.length || 0} available\n• Working directory: ${systemMsg.cwd}`;
				
			case 'assistant':
				const assistantMsg = message as any;
				if (assistantMsg.message?.content) {
					return assistantMsg.message.content.map((c: any) => {
						if (c.type === 'text') {
							return c.text;
						} else if (c.type === 'tool_use') {
							const input = c.input ? Object.entries(c.input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') : '';
							const approval = pendingToolApprovals.get(c.id);
							const status = approval?.approved ? '✅ APPROVED' : '⏳ PENDING APPROVAL';
							return `🔧 Tool request: ${c.name} (${status})\n${input ? `• Input: ${input}` : '• No input parameters'}`;
						}
						return '[Content]';
					}).join('\n\n');
				}
				return '💭 Assistant thinking...';
				
			case 'user':
				const userMsg = message as any;
				if (userMsg.message?.content) {
					const hasToolResults = userMsg.message.content.some((c: any) => c.type === 'tool_result');
					const hasUserText = userMsg.message.content.some((c: any) => c.type === 'text');
					
					if (hasToolResults && !hasUserText) {
						// Pure tool results - format with original tool request
						return userMsg.message.content.map((c: any) => {
							if (c.type === 'tool_result') {
								const toolRequest = toolRequestMap().get(c.tool_use_id);
								const content = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
								const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
								
								let output = '';
								if (toolRequest) {
									const input = toolRequest.input ? Object.entries(toolRequest.input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') : '';
									output += `🔧 Tool Request: ${toolRequest.name}\n${input ? `• Input: ${input}` : '• No input parameters'}\n\n`;
								}
								output += `📤 Tool Result (${c.tool_use_id?.substring(0, 8) || 'unknown'}):\n${preview}`;
								return output;
							}
							return '';
						}).filter(Boolean).join('\n\n');
					} else {
						// Mixed content or pure text
						return userMsg.message.content.map((c: any) => {
							if (c.type === 'text') {
								return c.text;
							} else if (c.type === 'tool_result') {
								const toolRequest = toolRequestMap().get(c.tool_use_id);
								const content = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
								const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
								
								let output = '';
								if (toolRequest) {
									const input = toolRequest.input ? Object.entries(toolRequest.input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ') : '';
									output += `🔧 Tool Request: ${toolRequest.name}\n${input ? `• Input: ${input}` : '• No input parameters'}\n\n`;
								}
								output += `📤 Tool Result (${c.tool_use_id?.substring(0, 8) || 'unknown'}):\n${preview}`;
								return output;
							}
							return '[Content]';
						}).join('\n\n');
					}
				}
				return '🔄 Processing...';
				
			case 'result':
				const resultMessage = message as any;
				const resultText = resultMessage.result || 'Session completed';
				const duration = resultMessage.duration_ms ? `${(resultMessage.duration_ms / 1000).toFixed(1)}s` : 'unknown';
				const cost = resultMessage.total_cost_usd?.toFixed(4) || '0.0000';
				return `🏁 Session completed in ${duration}\n💰 Cost: $${cost}\n📝 Result: ${resultText}`;
				
			default:
				return JSON.stringify(message, null, 2);
		}
	}

	function getMessageTypeColor(type: string): string {
		switch (type) {
			case 'system': return 'text-blue-600 bg-blue-500/20 border-blue-500/30';
			case 'assistant': return 'text-green-600 bg-green-500/20 border-green-500/30';
			case 'user': return 'text-amber-600 bg-amber-500/20 border-amber-500/30';
			case 'tool_result': return 'text-orange-600 bg-orange-500/20 border-orange-500/30';
			case 'result': return 'text-purple-600 bg-purple-500/20 border-purple-500/30';
			default: return 'text-gray-600 bg-gray-500/20 border-gray-500/30';
		}
	}

	function getMessageBgColor(type: string): string {
		switch (type) {
			case 'system': return 'bg-blue-500/10 border-blue-500/30';
			case 'assistant': return 'bg-green-500/10 border-green-500/30';
			case 'user': return 'bg-amber-500/10 border-amber-500/30';
			case 'tool_result': return 'bg-orange-500/10 border-orange-500/30';
			case 'result': return 'bg-purple-500/10 border-purple-500/30';
			default: return 'bg-gray-500/10 border-gray-500/30';
		}
	}

	// For active assistant response blocks, show only the latest assistant message and latest tool call
	function getMessagesToShow(step: any, isExpanded: boolean): SDKMessage[] {
		// Always show all messages if expanded
		if (isExpanded) {
			return step.messages;
		}
		
		// For active assistant response blocks that are collapsed, show condensed view
		if (step.type === 'assistant_response' && step.status === 'in_progress') {
			const messages = step.messages;
			
			// Get the most recent assistant message (text response)
			const assistantMessages = messages.filter((m: SDKMessage) => 
				m.type === 'assistant' && (m as any).message?.content?.some((c: any) => c.type === 'text')
			);
			const latestAssistant = assistantMessages[assistantMessages.length - 1];
			
			// Get the most recent tool call
			const toolCallMessages = messages.filter((m: SDKMessage) => 
				m.type === 'assistant' && (m as any).message?.content?.some((c: any) => c.type === 'tool_use')
			);
			const latestToolCall = toolCallMessages[toolCallMessages.length - 1];
			
			// Collect messages to show, avoiding duplicates
			const toShow: SDKMessage[] = [];
			if (latestAssistant) toShow.push(latestAssistant);
			if (latestToolCall && latestToolCall !== latestAssistant) toShow.push(latestToolCall);
			
			// If we have no specific messages, show the last message
			return toShow.length > 0 ? toShow : [messages[messages.length - 1]];
		}
		
		// For other collapsed types, show all messages (they should be simple)
		return step.messages;
	}
</script>

{#if !sessionId}
	<div class="flex items-center justify-center h-full">
		<div class="text-center">
			<p class="text-red-500">Error: No session ID provided</p>
		</div>
	</div>
{:else}
	<div class="sdk-session flex flex-col h-full bg-base-200">
	<!-- Header -->
	<div class="p-4 border-b border-base-300 bg-base-200">
		<div class="flex items-center justify-between mb-3">
			<div class="flex items-center gap-3">
				<h2 class="text-lg font-semibold">SDK Session</h2>
				<div class="badge badge-sm {isConnected ? 'badge-success' : isCompleted ? 'badge-neutral' : 'badge-error'}">
					{isConnected ? 'Connected' : isCompleted ? 'Completed' : 'Disconnected'}
				</div>
				{#if sessionMetadata.name}
					<span class="text-sm text-base-content/60">• {sessionMetadata.name}</span>
				{/if}
			</div>
			
			<div class="flex items-center gap-2">
				<button 
					class="btn btn-xs btn-ghost"
					onclick={scrollToBottom}
					title="Scroll to bottom"
				>
					↓
				</button>
				<label class="label cursor-pointer flex gap-1 text-xs">
					<input 
						type="checkbox" 
						class="checkbox checkbox-xs" 
						bind:checked={autoScroll}
						title="Auto-scroll to bottom"
					/>
					<span>Auto</span>
				</label>
				{#if !isConnected && !isCompleted}
					<button class="btn btn-sm btn-primary" onclick={reconnect}>
						Reconnect
					</button>
				{/if}
				{#if isConnected}
					<button class="btn btn-sm btn-error" onclick={terminateSession}>
						Terminate
					</button>
				{/if}
			</div>
		</div>
		
			
			<!-- Session Progress Overview -->
			<div class="flex gap-2 text-sm">
				<div class="flex items-center gap-1">
					<span class="text-base-content/60">Steps:</span>
					<span class="font-mono">{sessionProgress().completedSteps}/{sessionProgress().steps.length}</span>
					{#if sessionProgress().inProgressSteps > 0}
						<span class="loading loading-spinner loading-xs text-blue-500"></span>
					{/if}
				</div>
				
				{#if sessionProgress().totalDuration > 0}
					<div class="flex items-center gap-1">
						<span class="text-base-content/60">Duration:</span>
						<span class="font-mono">{(sessionProgress().totalDuration / 1000).toFixed(1)}s</span>
					</div>
				{/if}
				
				{#if sessionProgress().tokenUsage.total > 0}
					<div class="flex items-center gap-1">
						<span class="text-base-content/60">Tokens:</span>
						<span class="font-mono">{sessionProgress().tokenUsage.total.toLocaleString()}</span>
						<span class="text-xs text-base-content/40">
							({sessionProgress().tokenUsage.input.toLocaleString()} in, {sessionProgress().tokenUsage.output.toLocaleString()} out{sessionProgress().tokenUsage.cache > 0 ? `, ${sessionProgress().tokenUsage.cache.toLocaleString()} cached` : ''})
						</span>
					</div>
				{/if}
				
				<div class="text-base-content/60">
					{messages.length} messages
					{#if messages.length > 50}
						(showing last 50)
					{/if}
				</div>
			</div>
	</div>

	<!-- Error display -->
	{#if error}
		<div class="alert alert-error m-4">
			<span>{error}</span>
		</div>
	{/if}

	<!-- Conversation Steps -->
	<div 
		bind:this={messagesContainer}
		class="flex-1 p-4 overflow-y-auto space-y-4"
		onscroll={handleScroll}
	>
		{#if messages.length === 0}
			<div class="text-center text-base-content/60 py-8">
				{isConnected ? 'Waiting for messages...' : 'No messages yet'}
			</div>
		{/if}

		{#each conversationSteps() as step}
			{@const isExpanded = expandedSteps.has(step.id)}
			{@const statusColor = step.status === 'in_progress' ? 'border-blue-500 bg-blue-500/10' : 
							   step.status === 'pending' ? 'border-orange-500 bg-orange-500/10' :
							   step.hasError ? 'border-red-500 bg-red-500/10' : 'border-green-500 bg-green-500/10'}
			<div class="conversation-step border rounded-lg shadow-sm {statusColor}">
				<!-- Step Header (Collapsible) -->
				<button 
					class="w-full p-3 flex items-center justify-between hover:bg-base-300/50 transition-colors border-b border-base-300"
					onclick={() => toggleStep(step.id)}
				>
					<div class="flex items-center gap-3">
						<div class="collapse-icon transition-transform {isExpanded ? 'rotate-90' : ''}">
							▶
						</div>
						
						<!-- Status indicator -->
						<div class="flex items-center gap-2">
							{#if step.status === 'in_progress'}
								<span class="loading loading-spinner loading-sm text-blue-500"></span>
							{:else if step.status === 'pending'}
								<span class="text-orange-500">⏳</span>
							{:else if step.hasError}
								<span class="text-red-500">❌</span>
							{:else}
								<span class="text-green-500">✅</span>
							{/if}
							
							<span class="font-medium">{step.summary}</span>
						</div>
						
						<!-- Step metadata badges -->
						<div class="flex gap-1">
							<span class="badge badge-xs badge-outline">
								{step.messages.length} msg{step.messages.length !== 1 ? 's' : ''}
							</span>
							{#if step.toolCount > 0}
								<span class="badge badge-xs badge-outline">
									🛠️ {step.toolCount}
								</span>
							{/if}
							{#if step.duration}
								<span class="badge badge-xs badge-outline">
									⏱️ {(step.duration / 1000).toFixed(1)}s
								</span>
							{/if}
						</div>
					</div>
					
					<!-- Timestamp -->
					<div class="text-xs text-base-content/60">
						{#if step.startTime}
							{step.startTime.toLocaleTimeString()}
						{:else}
							{new Date((step.messages[0] as any).timestamp || Date.now()).toLocaleTimeString()}
						{/if}
					</div>
				</button>

				<!-- Step Content (Collapsible) -->
				{#if isExpanded || (step.type === 'assistant_response' && step.status === 'in_progress')}
					<div class="step-content">
						{#each getMessagesToShow(step, isExpanded) as message, index}
							{@const isToolResultOnly = message.type === 'user' && (message as any).message?.content?.every((c: any) => c.type === 'tool_result')}
							{@const displayType = isToolResultOnly ? 'tool_result' : message.type}
							<div class="message border-b border-base-200 last:border-b-0">
								<!-- Message header -->
								<div class="message-header px-3 py-2 bg-base-300/50 flex items-center justify-between">
									<div class="flex items-center gap-2">
										<span class="badge text-xs font-mono {getMessageTypeColor(displayType)}">
											{isToolResultOnly ? 'tool_result' : message.type}
											{#if (message as any).subtype}
												:{(message as any).subtype}
											{/if}
										</span>
										{#if (message as any).session_id}
											<span class="text-xs text-base-content/60 font-mono hidden sm:inline">
												{(message as any).session_id.substring(0, 8)}...
											</span>
										{/if}
									</div>
									<span class="text-xs text-base-content/60">#{index + 1}</span>
								</div>
								
								<!-- Message content -->
								<div class="message-content p-3 bg-base-200">
									<pre class="text-sm whitespace-pre-wrap text-base-content leading-relaxed">{formatMessageContent(message)}</pre>
									
									{#if message.type === 'assistant' && (message as any).message?.usage}
										{@const usage = (message as any).message.usage}
										<div class="mt-3 pt-2 border-t border-base-300 text-xs text-base-content/60 flex flex-wrap gap-2">
											<span class="badge badge-xs badge-outline">
												📥 {usage.input_tokens} in
											</span>
											<span class="badge badge-xs badge-outline">
												📤 {usage.output_tokens} out
											</span>
											{#if usage.cache_creation_input_tokens}
												<span class="badge badge-xs badge-outline">
													💾 {usage.cache_creation_input_tokens} cached
												</span>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Tool Approval Interface (only show if session is not completed and has unapproved tools) -->
	{#if !isCompleted}
		{@const pendingApprovals = Array.from(pendingToolApprovals.values()).filter(a => !a.approved)}
		{#if pendingApprovals.length > 0}
			{@const mostRecentApproval = pendingApprovals[pendingApprovals.length - 1]}
			{@const approvalsToShow = showAllPendingTools ? pendingApprovals : (mostRecentApproval ? [mostRecentApproval] : [])}
		<div class="border-t border-base-300 bg-warning/10 border-warning/20 max-h-96 flex flex-col">
			<div class="p-4 flex-shrink-0">
				<div class="flex items-center justify-between mb-4">
					<div class="alert alert-warning flex-1">
						<span class="font-semibold">⚠️ Tool Use Approval Required ({pendingApprovals.length} pending)</span>
					</div>
					<div class="flex items-center gap-2">
						{#if pendingApprovals.length > 1}
							<button 
								class="btn btn-sm btn-ghost"
								onclick={() => showAllPendingTools = !showAllPendingTools}
								title="{showAllPendingTools ? 'Show only current' : 'Show all pending'}"
							>
								{showAllPendingTools ? '👁️ Show Current' : '👁️ Show All'} ({pendingApprovals.length})
							</button>
						{/if}
						{#if approvedToolPatterns.size > 0}
							<button 
								class="btn btn-sm btn-outline"
								onclick={clearToolPatterns}
								title="Clear all approved patterns"
							>
								Clear Patterns ({approvedToolPatterns.size})
							</button>
						{/if}
					</div>
				</div>
			</div>
			
			<div class="flex-1 overflow-y-auto px-4 pb-4">
				{#each approvalsToShow as approval}
						{@const isExpanded = expandedToolDetails.has(approval.toolUseId)}
						<div class="card bg-base-100 shadow-sm border border-warning/30 mb-3">
							<div class="card-body p-3">
								<div class="flex items-start justify-between mb-3">
									<div class="flex-1">
										<h4 class="card-title text-base flex items-center gap-2 mb-2">
											<span class="badge badge-warning badge-sm">TOOL REQUEST</span>
											<code class="text-sm font-mono">{approval.toolName}</code>
										</h4>
										
										<div class="text-sm text-base-content/70 mb-2">
											{getToolInputSummary(approval.input)}
										</div>
									</div>
									
									<button 
										class="btn btn-xs btn-ghost"
										onclick={() => toggleToolDetails(approval.toolUseId)}
									>
										{isExpanded ? '🔼' : '🔽'} Details
									</button>
								</div>
								
								{#if isExpanded}
									<div class="bg-base-300 rounded p-3 mb-3 max-h-48 overflow-y-auto">
										<div class="text-xs text-base-content/60 mb-2">Full Parameters:</div>
										<pre class="text-xs whitespace-pre-wrap break-words">{formatToolInput(approval.input)}</pre>
									</div>
								{/if}
								
								<div class="flex flex-wrap gap-2 justify-between items-center">
									<div class="flex gap-2">
										<button 
											class="btn btn-outline btn-sm"
											onclick={() => denyToolUse(approval.toolUseId)}
										>
											❌ Deny
										</button>
										<button 
											class="btn btn-success btn-sm"
											onclick={() => approveToolUse(approval.toolUseId)}
										>
											✅ Approve Once
										</button>
									</div>
									
									<div class="flex gap-1">
										<button 
											class="btn btn-info btn-sm"
											onclick={() => approveToolPattern(approval.toolUseId, 'pattern')}
											title="Approve this tool with similar parameters for this session"
										>
											🔁 Pattern
										</button>
										<button 
											class="btn btn-primary btn-sm"
											onclick={() => approveToolPattern(approval.toolUseId, 'tool')}
											title="Always approve this tool for this session"
										>
											🔧 Always
										</button>
									</div>
								</div>
								
								<div class="text-xs text-base-content/60 mt-2 flex justify-between">
									<span>Tool ID: <code>{approval.toolUseId.substring(0, 8)}...</code></span>
									{#if shouldAutoApprove(approval.toolName, approval.input)}
										<span class="badge badge-info badge-xs">Auto-approved pattern</span>
									{/if}
								</div>
							</div>
						</div>
				{/each}
				
				{#if Array.from(pendingToolApprovals.values()).every(a => a.approved)}
					<div class="alert alert-success">
						<span>✅ All tool requests have been approved. The session will continue automatically.</span>
					</div>
				{/if}
				
				{#if approvedToolPatterns.size > 0}
					<div class="mt-4 p-3 bg-info/10 rounded border border-info/20">
						<div class="text-sm font-medium mb-2">📋 Approved Patterns for this session:</div>
						<div class="flex flex-wrap gap-1">
							{#each Array.from(approvedToolPatterns) as pattern}
								<span class="badge badge-info badge-sm">{pattern}</span>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
		{/if}
	{/if}

	<!-- Chat Interface (show for all sessions to allow continuation) -->
	{#if sessionId}
		<div class="border-t border-base-300 bg-base-200">
			<div class="p-4">
				<div class="flex gap-2">
					<textarea
						bind:value={chatInput}
						onkeydown={handleKeyDown}
						placeholder={isCompleted ? "Continue the conversation... (Resume from where we left off)" : "Continue the conversation... (Enter to send, Shift+Enter for new line)"}
						class="textarea textarea-bordered flex-1 min-h-[60px] max-h-[200px] resize-none"
						disabled={isSending}
						rows="2"
					></textarea>
					<button 
						class="btn btn-primary self-end"
						onclick={sendMessage}
						disabled={!chatInput.trim() || isSending}
					>
						{#if isSending}
							<span class="loading loading-spinner loading-sm"></span>
							Sending...
						{:else if isCompleted}
							Resume
						{:else}
							Send
						{/if}
					</button>
				</div>
				
				{#if !isConnected && !isCompleted}
					<div class="text-sm text-warning mt-2 flex items-center gap-2">
						<span class="loading loading-spinner loading-sm"></span>
						Connecting to session...
					</div>
				{:else if isCompleted}
					<div class="text-sm text-info mt-2">
						💡 This session has completed. Type a message to resume the conversation with Claude.
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Session info footer -->
	<div class="px-4 py-2 bg-base-200 border-t border-base-300 text-xs text-base-content/60 flex justify-between items-center">
		<div class="flex gap-4">
			<span>Session: {sessionId?.substring(0, 8) || 'Unknown'}...</span>
			<span>Messages: {messages.length}</span>
			{#if isCompleted}
				<span class="text-success">✅ Completed</span>
			{:else if isConnected}
				<span class="text-info">🔄 Active</span>
			{:else}
				<span class="text-warning">⚠️ Disconnected</span>
			{/if}
		</div>
		{#if !autoScroll}
			<span class="text-warning">📍 Scroll locked</span>
		{/if}
	</div>
</div>
{/if}

<style>
	.sdk-session {
		/* Use DaisyUI theme colors instead of hardcoded light background */
	}
	
	.message {
		transition: all 0.2s ease;
	}
	
	.message:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}
</style>