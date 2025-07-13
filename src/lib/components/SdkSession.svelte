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
	
	// Compute visible messages without $derived to avoid potential issues
	function getVisibleMessages(): SDKMessage[] {
		return messages.slice(-50);
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
							// Auto-scroll to bottom when new messages arrive
							if (autoScroll && messagesContainer) {
								setTimeout(() => scrollToBottom(), 10);
							}
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
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}
	}

	function handleScroll() {
		if (!messagesContainer) return;
		
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

	// Auto-scroll to bottom on mount and when messages change
	$effect(() => {
		if (messagesContainer && messages.length > 0) {
			setTimeout(() => scrollToBottom(), 10);
		}
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
							return `🔧 Using tool: ${c.name}\n${input ? `• Input: ${input}` : '• No input parameters'}`;
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

	<!-- Messages -->
	<div 
		bind:this={messagesContainer}
		class="flex-1 p-4 overflow-y-auto space-y-3"
		onscroll={handleScroll}
	>
		{#if messages.length === 0}
			<div class="text-center text-base-content/60 py-8">
				{isConnected ? 'Waiting for messages...' : 'No messages yet'}
			</div>
		{/if}

		{#each getVisibleMessages() as message, index}
			{@const globalIndex = messages.length - Math.min(messages.length, 50) + index + 1}
			{@const isToolResultOnly = message.type === 'user' && (message as any).message?.content?.every((c: any) => c.type === 'tool_result')}
			{@const displayType = isToolResultOnly ? 'tool_result' : message.type}
			<div class="message border rounded-lg overflow-hidden shadow-sm {getMessageBgColor(displayType)}">
				<!-- Message header -->
				<div class="message-header px-3 py-2 border-b flex items-center justify-between {getMessageBgColor(displayType)}">
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
					<span class="text-xs text-base-content/60">#{globalIndex}</span>
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