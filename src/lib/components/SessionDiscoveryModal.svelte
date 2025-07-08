<script lang="ts">
	import { onMount } from 'svelte';

	interface DiscoverableSession {
		claudeSessionId: string;
		workingDirectory: string;
		createdAt: string;
		lastActiveAt: string;
		messageCount: number;
		version?: string;
		projectName: string;
	}

	let isOpen = $state(false);
	let isLoading = $state(false);
	let isImporting = $state(false);
	let discoverableSessions = $state<DiscoverableSession[]>([]);
	let filteredSessions = $state<DiscoverableSession[]>([]);
	let selectedSessions = $state<Set<string>>(new Set());
	let totalFound = $state(0);
	let alreadyImported = $state(0);
	let error = $state<string | null>(null);
	let searchQuery = $state('');

	export function open() {
		isOpen = true;
		loadDiscoverableSessions();
	}

	export function close() {
		isOpen = false;
		selectedSessions.clear();
		error = null;
		searchQuery = '';
	}

	async function loadDiscoverableSessions() {
		isLoading = true;
		error = null;
		
		try {
			const response = await fetch('/api/sessions/discover/browse');
			const result = await response.json();
			
			if (result.success) {
				discoverableSessions = result.sessions;
				filteredSessions = result.sessions;
				totalFound = result.totalFound;
				alreadyImported = result.alreadyImported;
			} else {
				error = result.error || 'Failed to load discoverable sessions';
			}
		} catch (err) {
			error = 'Network error while loading sessions';
			console.error('Error loading discoverable sessions:', err);
		} finally {
			isLoading = false;
		}
	}

	function toggleSession(sessionId: string) {
		if (selectedSessions.has(sessionId)) {
			selectedSessions.delete(sessionId);
		} else {
			selectedSessions.add(sessionId);
		}
		// Trigger reactivity
		selectedSessions = new Set(selectedSessions);
	}

	function selectAll() {
		selectedSessions = new Set(filteredSessions.map(s => s.claudeSessionId));
	}

	function selectNone() {
		selectedSessions.clear();
		selectedSessions = new Set();
	}

	async function importSelected() {
		if (selectedSessions.size === 0) return;
		
		isImporting = true;
		error = null;
		
		try {
			const response = await fetch('/api/sessions/discover/import', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					claudeSessionIds: Array.from(selectedSessions)
				})
			});
			
			const result = await response.json();
			
			if (result.success) {
				// Dispatch event to parent to refresh sessions list
				const event = new CustomEvent('sessions-imported', {
					detail: { imported: result.imported, errors: result.errors }
				});
				dispatchEvent(event);
				
				// Refresh the discoverable sessions list
				await loadDiscoverableSessions();
				selectedSessions.clear();
				selectedSessions = new Set();
				
				// Close the modal after successful import
				close();
			} else {
				error = result.error || 'Failed to import sessions';
			}
		} catch (err) {
			error = 'Network error while importing sessions';
			console.error('Error importing sessions:', err);
		} finally {
			isImporting = false;
		}
	}

	function filterSessions(query: string) {
		if (!query.trim()) {
			filteredSessions = discoverableSessions;
			return;
		}
		
		const lowerQuery = query.toLowerCase();
		filteredSessions = discoverableSessions.filter(session => 
			session.projectName.toLowerCase().includes(lowerQuery) ||
			session.workingDirectory.toLowerCase().includes(lowerQuery) ||
			session.claudeSessionId.toLowerCase().includes(lowerQuery)
		);
	}

	// Update filtered sessions when search query changes
	$effect(() => {
		filterSessions(searchQuery);
	});
</script>

{#if isOpen}
	<div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
		<div class="bg-base-100 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col">
			<!-- Header -->
			<div class="p-6 border-b border-base-300">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-xl font-semibold">Discover Claude Sessions</h2>
						<p class="text-sm text-base-content/60 mt-1">
							Found {totalFound} total sessions • {alreadyImported} already imported • {filteredSessions.length} available to import
						</p>
					</div>
					<button class="btn btn-ghost btn-sm" onclick={close}>
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-hidden flex flex-col">
				{#if isLoading}
					<div class="flex-1 flex items-center justify-center">
						<div class="text-center">
							<span class="loading loading-spinner loading-lg"></span>
							<p class="mt-2">Scanning for Claude sessions...</p>
						</div>
					</div>
				{:else if error}
					<div class="flex-1 flex items-center justify-center">
						<div class="text-center">
							<div class="text-error mb-2">❌ Error</div>
							<p class="text-error">{error}</p>
							<button class="btn btn-outline btn-sm mt-4" onclick={loadDiscoverableSessions}>
								Try Again
							</button>
						</div>
					</div>
				{:else if discoverableSessions.length === 0}
					<div class="flex-1 flex items-center justify-center">
						<div class="text-center">
							<div class="text-2xl mb-2">🎉</div>
							<h3 class="text-lg font-semibold">All sessions imported!</h3>
							<p class="text-base-content/60">No new Claude sessions found to import.</p>
						</div>
					</div>
				{:else}
					<!-- Search and Controls -->
					<div class="p-4 border-b border-base-300">
						<!-- Search -->
						<div class="mb-3">
							<input
								type="text"
								placeholder="Search sessions by name, path, or ID..."
								class="input input-bordered input-sm w-full"
								bind:value={searchQuery}
							/>
						</div>
						
						<!-- Controls -->
						<div class="flex items-center justify-between">
							<div class="flex gap-2">
								<button class="btn btn-outline btn-xs" onclick={selectAll}>
									Select All
								</button>
								<button class="btn btn-outline btn-xs" onclick={selectNone}>
									Select None
								</button>
							</div>
							<div class="text-sm text-base-content/60">
								{selectedSessions.size} selected
							</div>
						</div>
					</div>

					<!-- Sessions List -->
					<div class="flex-1 overflow-y-auto">
						{#if filteredSessions.length === 0 && searchQuery.trim()}
							<div class="flex-1 flex items-center justify-center p-8">
								<div class="text-center">
									<div class="text-2xl mb-2">🔍</div>
									<h3 class="text-lg font-semibold">No sessions found</h3>
									<p class="text-base-content/60">Try adjusting your search query</p>
								</div>
							</div>
						{:else}
							{#each filteredSessions as session (session.claudeSessionId)}
								<div class="p-4 border-b border-base-300 hover:bg-base-50">
									<label class="flex items-center gap-3 cursor-pointer">
										<input 
											type="checkbox" 
											class="checkbox checkbox-sm"
											checked={selectedSessions.has(session.claudeSessionId)}
											onchange={() => toggleSession(session.claudeSessionId)}
										/>
										<div class="flex-1">
											<div class="flex items-center justify-between">
												<div>
													<h4 class="font-semibold">{session.projectName}</h4>
													<p class="text-sm text-base-content/60">{session.workingDirectory}</p>
												</div>
												<div class="text-right text-xs text-base-content/60">
													<div>
														{session.messageCount} messages
														{#if session.version}
															• v{session.version}
														{/if}
													</div>
													<div>Created: {new Date(session.createdAt).toLocaleString()}</div>
													<div>Last: {new Date(session.lastActiveAt).toLocaleString()}</div>
												</div>
											</div>
											<div class="text-xs text-base-content/40 mt-1 font-mono">
												ID: {session.claudeSessionId.substring(0, 8)}...
											</div>
										</div>
									</label>
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			{#if !isLoading && !error && discoverableSessions.length > 0}
				<div class="p-6 border-t border-base-300">
					<div class="flex items-center justify-between">
						<button class="btn btn-outline" onclick={close}>
							Cancel
						</button>
						<button 
							class="btn btn-primary"
							onclick={importSelected}
							disabled={selectedSessions.size === 0 || isImporting}
						>
							{#if isImporting}
								<span class="loading loading-spinner loading-sm"></span>
								Importing...
							{:else}
								Import {selectedSessions.size} Session{selectedSessions.size === 1 ? '' : 's'}
							{/if}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}