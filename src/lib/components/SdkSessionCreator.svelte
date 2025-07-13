<script lang="ts">
	interface Props {
		onSessionCreated?: (sessionId: string) => void;
		isOpen?: boolean;
		onClose?: () => void;
	}

	let { 
		onSessionCreated = $bindable<(sessionId: string) => void>(),
		isOpen = $bindable(false),
		onClose = $bindable<() => void>()
	}: Props = $props();

	let prompt = $state('');
	let sessionName = $state('');
	let workingDirectory = $state('');
	let maxTurns = $state(10);
	let isCreating = $state(false);
	let error = $state<string | null>(null);

	// Reset form when modal opens
	$effect(() => {
		if (isOpen) {
			prompt = '';
			sessionName = '';
			workingDirectory = '';
			maxTurns = 10;
			error = null;
		}
	});

	async function createSession() {
		if (!prompt.trim()) {
			error = 'Prompt is required';
			return;
		}

		isCreating = true;
		error = null;

		try {
			const response = await fetch('/api/sessions/sdk', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					prompt: prompt.trim(),
					name: sessionName.trim() || 'SDK Session',
					workingDirectory: workingDirectory.trim() || undefined,
					maxTurns
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Failed to create session');
			}

			const sessionData = await response.json();
			
			if (onSessionCreated) {
				onSessionCreated(sessionData.sessionId);
			}
			
			if (onClose) {
				onClose();
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			isCreating = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && onClose) {
			onClose();
		}
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			createSession();
		}
	}
</script>

{#if isOpen}
	<!-- Modal backdrop -->
	<div 
		class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
		onclick={(e) => e.target === e.currentTarget && onClose?.()}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- Modal content -->
		<div class="bg-base-100 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
			<!-- Header -->
			<div class="flex items-center justify-between p-4 sm:p-6 border-b border-base-300 flex-shrink-0">
				<h2 class="text-lg sm:text-xl font-bold">Create New SDK Session</h2>
				<button 
					class="btn btn-ghost btn-sm btn-circle" 
					onclick={onClose}
					aria-label="Close"
				>
					✕
				</button>
			</div>

			<!-- Form -->
			<div class="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
				{#if error}
					<div class="alert alert-error">
						<span>{error}</span>
					</div>
				{/if}

				<!-- Prompt (required) -->
				<div class="form-control">
					<label class="label" for="prompt">
						<span class="label-text font-medium">Prompt *</span>
					</label>
					<textarea 
						id="prompt"
						class="textarea textarea-bordered h-24 sm:h-32 resize-none"
						placeholder="Enter your prompt for Claude Code (e.g., 'Write a React component for a todo list')"
						bind:value={prompt}
						required
					></textarea>
					<label class="label">
						<span class="label-text-alt">This is what Claude will work on</span>
					</label>
				</div>

				<!-- Session name -->
				<div class="form-control">
					<label class="label" for="sessionName">
						<span class="label-text">Session Name</span>
					</label>
					<input 
						id="sessionName"
						type="text"
						class="input input-bordered"
						placeholder="e.g., Todo App Development"
						bind:value={sessionName}
					/>
				</div>

				<!-- Working directory -->
				<div class="form-control">
					<label class="label" for="workingDirectory">
						<span class="label-text">Working Directory</span>
					</label>
					<input 
						id="workingDirectory"
						type="text"
						class="input input-bordered"
						placeholder="Leave empty for default (current directory)"
						bind:value={workingDirectory}
					/>
					<label class="label">
						<span class="label-text-alt">Directory where Claude will work</span>
					</label>
				</div>

				<!-- Max turns -->
				<div class="form-control">
					<label class="label" for="maxTurns">
						<span class="label-text">Max Turns</span>
					</label>
					<input 
						id="maxTurns"
						type="number"
						class="input input-bordered"
						min="1"
						max="50"
						bind:value={maxTurns}
					/>
					<label class="label">
						<span class="label-text-alt">Maximum conversation turns (1-50)</span>
					</label>
				</div>

				<!-- Info box -->
				<div class="alert alert-info">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
					</svg>
					<div>
						<h3 class="font-bold">About SDK Sessions</h3>
						<div class="text-sm">
							SDK sessions use the Claude Code TypeScript SDK for multi-turn interactions. 
							Claude will have access to tools and can perform file operations, run commands, and more.
						</div>
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="flex-shrink-0 border-t border-base-300">
				<div class="flex justify-end gap-3 p-4 sm:p-6">
					<button 
						class="btn btn-ghost btn-sm sm:btn-md" 
						onclick={onClose}
						disabled={isCreating}
					>
						Cancel
					</button>
					<button 
						class="btn btn-primary btn-sm sm:btn-md"
						onclick={createSession}
						disabled={!prompt.trim() || isCreating}
					>
						{#if isCreating}
							<span class="loading loading-spinner loading-sm"></span>
							Creating...
						{:else}
							Create Session
						{/if}
					</button>
				</div>

				<!-- Keyboard shortcuts hint -->
				<div class="text-xs text-base-content/60 px-4 sm:px-6 pb-3 sm:pb-4 hidden sm:block">
					<kbd class="kbd kbd-xs">Ctrl/Cmd + Enter</kbd> to create, <kbd class="kbd kbd-xs">Esc</kbd> to close
				</div>
			</div>
		</div>
	</div>
{/if}