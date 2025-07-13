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

	// Simple message formatting
	function formatMessage(message: SDKMessage): string {
		if (message.type === 'system') {
			return 'System initialized';
		} else if (message.type === 'assistant') {
			return 'Assistant message';
		} else if (message.type === 'user') {
			return 'User/Tool result';
		} else if (message.type === 'result') {
			return 'Session completed';
		}
		return 'Unknown message type';
	}
</script>

<div class="flex flex-col h-full bg-base-100">
	<!-- Simple header -->
	<div class="p-4 border-b border-base-300">
		<h2 class="text-lg font-semibold">SDK Session (Simple)</h2>
		<p class="text-sm text-base-content/60">Session: {sessionId}</p>
		<p class="text-sm">
			Status: {isConnected ? 'Connected' : isCompleted ? 'Completed' : 'Disconnected'}
			| Messages: {messages.length}
		</p>
	</div>

	<!-- Error display -->
	{#if error}
		<div class="p-4 bg-red-100 text-red-700">
			Error: {error}
		</div>
	{/if}

	<!-- Simple message list -->
	<div class="flex-1 overflow-y-auto p-4 space-y-2">
		{#if messages.length === 0}
			<p class="text-center text-base-content/60">No messages yet</p>
		{/if}
		
		{#each messages as message, i}
			<div class="p-2 border rounded bg-base-200">
				<div class="text-xs text-base-content/60">#{i + 1} - {message.type}</div>
				<div class="text-sm">{formatMessage(message)}</div>
			</div>
		{/each}
	</div>

	<!-- Simple footer -->
	<div class="p-2 border-t border-base-300 text-xs text-center">
		Simple SDK Session View
	</div>
</div>