<script lang="ts">
	import type { SDKMessage } from '@anthropic-ai/claude-code';
	
	interface Props {
		sessionId: string;
		onSessionComplete?: (sessionId: string) => void;
	}

	let { 
		sessionId,
		onSessionComplete = $bindable<(sessionId: string) => void>()
	}: Props = $props();

	let messages = $state<SDKMessage[]>([]);
	let isConnected = $state(false);
	let isCompleted = $state(false);
	let error = $state<string | null>(null);
	let eventSource: EventSource | null = null;
	let messagesContainer: HTMLElement | undefined;
	let autoScroll = $state(true);
	let isScrollingProgrammatically = false;
	
	// Group messages into conversation turns
	const conversationTurns = $derived(() => {
		const turns: Array<{
			id: string;
			messages: SDKMessage[];
			isExpanded: boolean;
			summary: string;
			type: 'system' | 'conversation' | 'result';
		}> = [];
		
		let currentTurn: SDKMessage[] = [];
		let turnId = 0;
		
		for (const message of messages) {
			// Start new turn on system messages or when switching from assistant to user
			const shouldStartNewTurn = 
				message.type === 'system' ||
				message.type === 'result' ||
				(currentTurn.length > 0 && 
				 currentTurn[currentTurn.length - 1].type === 'assistant' && 
				 message.type === 'user');
			
			if (shouldStartNewTurn && currentTurn.length > 0) {
				// Finish current turn
				const turnMessages = [...currentTurn];
				const summary = summarizeTurn(turnMessages);
				const type = turnMessages[0].type === 'system' ? 'system' : 'conversation';
				
				turns.push({
					id: `turn-${turnId++}`,
					messages: turnMessages,
					isExpanded: turns.length === 0 || turns.length >= Math.max(0, turns.length - 2), // Keep last 2 turns expanded
					summary,
					type
				});
				currentTurn = [];
			}
			
			currentTurn.push(message);
		}
		
		// Add final turn if any messages remain
		if (currentTurn.length > 0) {
			const summary = summarizeTurn(currentTurn);
			const type = currentTurn[0].type === 'result' ? 'result' : 
						currentTurn[0].type === 'system' ? 'system' : 'conversation';
			
			turns.push({
				id: `turn-${turnId++}`,
				messages: currentTurn,
				isExpanded: true, // Always expand the last turn
				summary,
				type
			});
		}
		
		return turns;
	});
	
	function summarizeTurn(messages: SDKMessage[]): string {
		if (messages.length === 0) return 'Empty turn';
		
		const firstMessage = messages[0];
		const lastMessage = messages[messages.length - 1];
		
		if (firstMessage.type === 'system') {
			return '🔧 System initialized';
		}
		
		if (firstMessage.type === 'result') {
			return '🏁 Session completed';
		}
		
		// Count message types in this turn
		const userMsgs = messages.filter(m => m.type === 'user').length;
		const assistantMsgs = messages.filter(m => m.type === 'assistant').length;
		const toolResults = messages.filter(m => 
			m.type === 'user' && (m as any).message?.content?.some((c: any) => c.type === 'tool_result')
		).length;
		
		if (toolResults > 0) {
			return `💬 Exchange with ${toolResults} tool${toolResults > 1 ? 's' : ''}`;
		}
		
		return `💬 Conversation (${assistantMsgs} response${assistantMsgs !== 1 ? 's' : ''})`;
	}
	
	let expandedTurns = $state<Set<string>>(new Set());
	let chatInput = $state('');
	let isSending = $state(false);
	let pendingToolApprovals = $state<Map<string, {
		toolUseId: string;
		toolName: string;
		input: any;
		message: any;
		approved: boolean;
	}>>(new Map());
	
	function toggleTurn(turnId: string) {
		if (expandedTurns.has(turnId)) {
			expandedTurns.delete(turnId);
		} else {
			expandedTurns.add(turnId);
		}
		expandedTurns = new Set(expandedTurns);
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
				let hasNewTools = false;
				for (const toolUse of toolUses) {
					if (!pendingToolApprovals.has(toolUse.id)) {
						pendingToolApprovals.set(toolUse.id, {
							toolUseId: toolUse.id,
							toolName: toolUse.name,
							input: toolUse.input,
							message: assistantMsg,
							approved: false
						});
						hasNewTools = true;
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
			approval.approved = true;
			
			// Send approval to backend
			await sendToolApprovals();
			
			// Remove from pending list after successful approval
			pendingToolApprovals.delete(toolUseId);
			pendingToolApprovals = new Map(pendingToolApprovals);
		}
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
						// Pure tool results - format as tool output
						return userMsg.message.content.map((c: any) => {
							if (c.type === 'tool_result') {
								const content = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
								const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
								return `🔧 Tool Output (${c.tool_use_id?.substring(0, 8) || 'unknown'}):\n${preview}`;
							}
							return '';
						}).filter(Boolean).join('\n\n');
					} else {
						// Mixed content or pure text
						return userMsg.message.content.map((c: any) => {
							if (c.type === 'text') {
								return c.text;
							} else if (c.type === 'tool_result') {
								const content = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
								const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
								return `🔧 Tool Output (${c.tool_use_id?.substring(0, 8) || 'unknown'}):\n${preview}`;
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
			case 'system': return 'text-blue-700 bg-blue-100 border-blue-200';
			case 'assistant': return 'text-green-700 bg-green-100 border-green-200';
			case 'user': return 'text-amber-700 bg-amber-100 border-amber-200';
			case 'tool_result': return 'text-orange-700 bg-orange-100 border-orange-200';
			case 'result': return 'text-purple-700 bg-purple-100 border-purple-200';
			default: return 'text-gray-700 bg-gray-100 border-gray-200';
		}
	}

	function getMessageBgColor(type: string): string {
		switch (type) {
			case 'system': return 'bg-blue-50 border-blue-200';
			case 'assistant': return 'bg-green-50 border-green-200';
			case 'user': return 'bg-amber-50 border-amber-200';
			case 'tool_result': return 'bg-orange-50 border-orange-200';
			case 'result': return 'bg-purple-50 border-purple-200';
			default: return 'bg-gray-50 border-gray-200';
		}
	}
</script>

{#if !sessionId}
	<div class="flex items-center justify-center h-full">
		<div class="text-center">
			<p class="text-red-500">Error: No session ID provided</p>
		</div>
	</div>
{:else}
	<div class="sdk-session flex flex-col h-full bg-base-100">
	<!-- Header -->
	<div class="flex items-center justify-between p-4 border-b border-base-300 bg-base-100">
		<div class="flex items-center gap-3">
			<h2 class="text-lg font-semibold">SDK Session</h2>
			<div class="badge badge-sm {isConnected ? 'badge-success' : isCompleted ? 'badge-neutral' : 'badge-error'}">
				{isConnected ? 'Connected' : isCompleted ? 'Completed' : 'Disconnected'}
			</div>
			<div class="text-sm text-base-content/60">
				{messages.length} messages
				{#if messages.length > 50}
					(showing last 50)
				{/if}
			</div>
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

	<!-- Error display -->
	{#if error}
		<div class="alert alert-error m-4">
			<span>{error}</span>
		</div>
	{/if}

	<!-- Conversation Turns -->
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

		{#each conversationTurns() as turn}
			{@const isExpanded = turn.isExpanded || expandedTurns.has(turn.id)}
			<div class="conversation-turn border rounded-lg shadow-sm bg-base-100">
				<!-- Turn Header (Collapsible) -->
				<button 
					class="w-full p-3 flex items-center justify-between hover:bg-base-200 transition-colors border-b border-base-300"
					onclick={() => toggleTurn(turn.id)}
				>
					<div class="flex items-center gap-3">
						<div class="collapse-icon transition-transform {isExpanded ? 'rotate-90' : ''}">
							▶
						</div>
						<span class="font-medium">{turn.summary}</span>
						<span class="badge badge-sm badge-outline">
							{turn.messages.length} message{turn.messages.length !== 1 ? 's' : ''}
						</span>
					</div>
					<div class="text-xs text-base-content/60">
						{new Date((turn.messages[0] as any).timestamp || Date.now()).toLocaleTimeString()}
					</div>
				</button>

				<!-- Turn Content (Collapsible) -->
				{#if isExpanded}
					<div class="turn-content">
						{#each turn.messages as message, index}
							{@const isToolResultOnly = message.type === 'user' && (message as any).message?.content?.every((c: any) => c.type === 'tool_result')}
							{@const displayType = isToolResultOnly ? 'tool_result' : message.type}
							<div class="message border-b border-base-200 last:border-b-0">
								<!-- Message header -->
								<div class="message-header px-3 py-2 bg-base-50 flex items-center justify-between">
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
								<div class="message-content p-3 bg-base-100">
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

	<!-- Tool Approval Interface (only show if session is not completed) -->
	{#if pendingToolApprovals.size > 0 && !isCompleted}
		<div class="border-t border-base-300 bg-warning/10 border-warning/20 max-h-80 flex flex-col">
			<div class="p-4 flex-shrink-0">
				<div class="alert alert-warning mb-4">
					<span class="font-semibold">⚠️ Tool Use Approval Required ({pendingToolApprovals.size} pending)</span>
				</div>
			</div>
			
			<div class="flex-1 overflow-y-auto px-4 pb-4">
				{#each Array.from(pendingToolApprovals.values()) as approval}
					{#if !approval.approved}
						<div class="card bg-base-100 shadow-sm border border-warning/30 mb-3">
							<div class="card-body p-3">
								<h4 class="card-title text-base flex items-center gap-2">
									<span class="badge badge-warning badge-sm">TOOL REQUEST</span>
									<code class="text-sm font-mono">{approval.toolName}</code>
								</h4>
								
								<div class="text-sm mb-3">
									<strong>Claude wants to use the "{approval.toolName}" tool with these parameters:</strong>
								</div>
								
								<div class="bg-base-200 rounded p-2 mb-3 overflow-x-auto max-h-32 overflow-y-auto">
									<pre class="text-xs">{JSON.stringify(approval.input, null, 2)}</pre>
								</div>
								
								<div class="card-actions justify-end gap-2">
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
										✅ Approve
									</button>
								</div>
								
								<div class="text-xs text-base-content/60 mt-1">
									Tool ID: <code>{approval.toolUseId.substring(0, 8)}...</code>
								</div>
							</div>
						</div>
					{/if}
				{/each}
				
				{#if Array.from(pendingToolApprovals.values()).every(a => a.approved)}
					<div class="alert alert-success">
						<span>✅ All tool requests have been approved. The session will continue automatically.</span>
					</div>
				{/if}
			</div>
		</div>
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
		background-color: #fafafa;
	}
	
	.message {
		transition: all 0.2s ease;
	}
	
	.message:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}
</style>