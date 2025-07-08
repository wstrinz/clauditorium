<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { sessionAPI, type SessionInfo } from '$lib/services/session-api';
	import { recentConfigsService, type RecentConfig } from '$lib/services/recent-configs';
	import ClaudeTerminal from './ClaudeTerminal.svelte';
	import DirectoryPickerNew from './DirectoryPickerNew.svelte';
	import SessionDiscoveryModal from './SessionDiscoveryModal.svelte';

	let sessions = $state<SessionInfo[]>([]);
	let activeSessionId = $state<string | null>(null);
	let isCreatingSession = $state(false);
	let newSessionName = $state('');
	let newSessionDirectory = $state('');
	let isMobileMenuOpen = $state(false);
	let activeTerminal: ClaudeTerminal | null = null;
	let recentConfigs = $state<RecentConfig[]>([]);
	let showRecentConfigs = $state(false);
	let discoveryModal: SessionDiscoveryModal;
	let renamingSessionId = $state<string | null>(null);
	let newSessionNameForRename = $state('');

	const activeSession = $derived(() => 
		sessions.find(s => s.sessionId === activeSessionId)
	);

	onMount(async () => {
		await loadSessions();
		loadRecentConfigs();
		
		// Connect to active session if one exists and has backend process
		if (activeSessionId) {
			const session = sessions.find(s => s.sessionId === activeSessionId);
			if (session?.hasBackendProcess) {
				connectToSession(activeSessionId);
			}
		}
	});

	onDestroy(() => {
		// Disconnect all sessions
		sessionAPI.disconnectAll();
	});

	async function loadSessions() {
		try {
			sessions = await sessionAPI.getSessions();
			// Auto-select first active session
			const activeSessions = sessions.filter(s => s.status === 'active');
			if (activeSessions.length > 0 && !activeSessionId) {
				activeSessionId = activeSessions[0].sessionId;
			}
		} catch (error) {
			console.error('Failed to load sessions:', error);
			sessions = [];
		}
	}

	function loadRecentConfigs() {
		recentConfigs = recentConfigsService.getMostUsedConfigs(5);
	}

	function useRecentConfig(config: RecentConfig) {
		newSessionName = config.name;
		newSessionDirectory = config.workingDirectory;
		showRecentConfigs = false;
	}

	async function createSessionFromRecent(config: RecentConfig) {
		newSessionName = config.name;
		newSessionDirectory = config.workingDirectory;
		await createSession();
	}

	async function createSession() {
		if (!newSessionName.trim()) return;

		try {
			// Create session on backend
			const sessionInfo = await sessionAPI.createSession(
				newSessionName.trim(),
				newSessionDirectory || undefined
			);
			
			// Save to recent configs
			recentConfigsService.addRecentConfig({
				name: sessionInfo.name,
				workingDirectory: sessionInfo.workingDirectory,
				useContinueFlag: false // No longer used
			});
			
			// Save working directory
			if (sessionInfo.workingDirectory) {
				recentConfigsService.addRecentDirectory(sessionInfo.workingDirectory);
			}
			
			// Set active session before reloading to ensure it's selected
			activeSessionId = sessionInfo.sessionId;
			
			await loadSessions();
			loadRecentConfigs();
			
			newSessionName = '';
			newSessionDirectory = '';
			isCreatingSession = false;
			isMobileMenuOpen = false;

			// Connect to session output
			connectToSession(sessionInfo.sessionId);
		} catch (error) {
			console.error('Failed to create session:', error);
			// Show error in UI instead of alert
			newSessionName = 'Error: Failed to create session';
		}
	}

	async function switchSession(sessionId: string) {
		// Disconnect from previous session
		if (activeSessionId) {
			sessionAPI.disconnectFromSession(activeSessionId);
		}

		activeSessionId = sessionId;
		isMobileMenuOpen = false;

		// Connect to new session (only if it has a backend process)
		const session = sessions.find(s => s.sessionId === sessionId);
		if (session?.hasBackendProcess) {
			connectToSession(sessionId);
		}
	}

	async function terminateSession(sessionId: string) {
		try {
			// Terminate the session (stop process but keep in database)
			await sessionAPI.terminateSession(sessionId);
			if (activeSessionId === sessionId) {
				activeSessionId = null;
			}
			await loadSessions();
		} catch (error) {
			console.error('Failed to terminate session:', error);
		}
	}

	async function deleteSession(sessionId: string) {
		if (confirm('Delete this session? This cannot be undone.')) {
			try {
				await sessionAPI.deleteSession(sessionId);
				if (activeSessionId === sessionId) {
					activeSessionId = null;
				}
				await loadSessions();
			} catch (error) {
				console.error('Failed to delete session:', error);
			}
		}
	}

	async function reinitializeSession(sessionId: string) {
		try {
			const session = sessions.find(s => s.sessionId === sessionId);
			if (!session) return;

			// Create new session on backend with same directory
			const sessionInfo = await sessionAPI.createSession(
				session.name,
				session.workingDirectory
			);

			await loadSessions();
			
			// Switch to the new session
			activeSessionId = sessionInfo.sessionId;
			connectToSession(sessionInfo.sessionId);
		} catch (error) {
			console.error('Failed to reinitialize session:', error);
		}
	}

	async function restartSession(sessionId: string) {
		try {
			// Restart the existing session
			await sessionAPI.restartSession(sessionId);
			
			// Reload sessions to get updated status
			await loadSessions();
			
			// Reconnect to the restarted session
			connectToSession(sessionId);
			
			// Clear terminal and show appropriate restart message
			if (activeTerminal && activeSessionId === sessionId) {
				activeTerminal.clear();
				const session = sessions.find(s => s.sessionId === sessionId);
				if (session?.claudeSessionId) {
					activeTerminal.writeln(`🔄 Session resumed (--resume ${session.claudeSessionId.substring(0, 8)}...)`);
				} else {
					activeTerminal.writeln('🔄 Session restarted with --continue flag');
				}
			}
		} catch (error) {
			console.error('Failed to restart session:', error);
			// Show error in terminal if active
			if (activeTerminal && activeSessionId === sessionId) {
				activeTerminal.writeln(`❌ Failed to restart session: ${error}`);
			}
		}
	}

	function connectToSession(sessionId: string) {
		sessionAPI.connectToSession(sessionId, (data) => {
			// Write output to terminal if it's the active session
			if (activeTerminal && activeSessionId === sessionId) {
				activeTerminal.write(data);
			}
		}).catch(error => {
			console.error('Failed to connect to session:', error);
		});
	}

	async function handleTerminalCommand(command: string) {
		if (!activeSessionId) return;
		
		const session = sessions.find(s => s.sessionId === activeSessionId);
		if (!session?.hasBackendProcess) return;
		
		try {
			// Send to backend
			await sessionAPI.sendInput(activeSessionId, command);
		} catch (error) {
			console.error('Failed to send command:', error);
		}
	}

	async function handleTerminalResize(cols: number, rows: number) {
		if (!activeSessionId) return;
		
		const session = sessions.find(s => s.sessionId === activeSessionId);
		if (!session?.hasBackendProcess) return;
		
		try {
			await sessionAPI.resizeSession(activeSessionId, cols, rows);
		} catch (error) {
			console.error('Failed to resize session:', error);
		}
	}

	function openDiscovery() {
		discoveryModal.open();
	}

	async function handleSessionsImported(event: CustomEvent) {
		const { imported, errors } = event.detail;
		console.log(`Imported ${imported} sessions`, errors.length > 0 ? 'with errors:' : '', errors);
		await loadSessions(); // Refresh the sessions list
	}

	async function resumeClaudeSession(session: SessionInfo) {
		if (!session.claudeSessionId) return;
		
		try {
			// Create a new session that resumes the Claude session
			const sessionInfo = await sessionAPI.createSession(
				session.name,
				session.workingDirectory,
				session.claudeSessionId
			);
			
			// Set active session
			activeSessionId = sessionInfo.sessionId;
			
			await loadSessions();
			
			// Connect to session output
			connectToSession(sessionInfo.sessionId);
			
			isMobileMenuOpen = false;
		} catch (error) {
			console.error('Failed to resume Claude session:', error);
		}
	}

	function startRenaming(sessionId: string) {
		const session = sessions.find(s => s.sessionId === sessionId);
		if (session) {
			renamingSessionId = sessionId;
			newSessionNameForRename = session.name;
		}
	}

	async function saveRename() {
		if (!renamingSessionId || !newSessionNameForRename.trim()) return;
		
		try {
			await sessionAPI.renameSession(renamingSessionId, newSessionNameForRename.trim());
			await loadSessions();
			renamingSessionId = null;
			newSessionNameForRename = '';
		} catch (error) {
			console.error('Failed to rename session:', error);
		}
	}

	function cancelRename() {
		renamingSessionId = null;
		newSessionNameForRename = '';
	}
</script>

<div class="h-screen flex flex-col bg-base-100">
	<!-- Header - Mobile optimized -->
	<div class="navbar bg-base-200 shadow-lg">
		<div class="navbar-start">
			<button 
				class="btn btn-ghost lg:hidden"
				onclick={() => isMobileMenuOpen = !isMobileMenuOpen}
			>
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
				</svg>
			</button>
			<h1 class="text-xl font-bold hidden lg:block">Clauditorium</h1>
		</div>
		
		<div class="navbar-center lg:hidden">
			<h1 class="text-xl font-bold">Clauditorium</h1>
		</div>

		<div class="navbar-end">
			<a 
				href="/settings"
				class="btn btn-ghost btn-sm mr-2"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
				</svg>
				<span class="hidden sm:inline">Settings</span>
			</a>
			<button 
				class="btn btn-ghost btn-sm mr-2"
				onclick={openDiscovery}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
				</svg>
				<span class="hidden sm:inline">Discover</span>
			</button>
			<button 
				class="btn btn-primary btn-sm"
				onclick={() => { isCreatingSession = true; isMobileMenuOpen = true; }}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
				</svg>
				<span class="hidden sm:inline">New Session</span>
			</button>
		</div>
	</div>

	<div class="flex-1 flex overflow-hidden">
		<!-- Sidebar - Mobile drawer -->
		<div class={`
			fixed inset-y-0 left-0 z-50 w-80 bg-base-200 transform transition-transform lg:relative lg:translate-x-0 lg:z-0
			${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
		`}>
			<div class="h-full flex flex-col">
				<!-- Session list header -->
				<div class="p-4 border-b border-base-300 lg:hidden">
					<button 
						class="btn btn-ghost btn-sm float-right"
						onclick={() => isMobileMenuOpen = false}
					>
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
					<h2 class="text-lg font-semibold">Sessions</h2>
				</div>

				<!-- New session form -->
				{#if isCreatingSession}
					<div class="p-4 border-b border-base-300">
						{#if recentConfigs.length > 0 && !showRecentConfigs}
							<button
								class="btn btn-ghost btn-xs w-full mb-2 justify-start"
								onclick={() => showRecentConfigs = !showRecentConfigs}
							>
								🕐 Use recent configuration
							</button>
						{/if}
						
						{#if showRecentConfigs}
							<div class="mb-3">
								<h4 class="text-sm font-semibold mb-2">Recent Configurations</h4>
								<div class="grid gap-1">
									{#each recentConfigs.slice(0, 3) as config}
										<button 
											class="btn btn-ghost btn-xs justify-start text-left"
											onclick={() => useRecentConfig(config)}
										>
											<div class="flex-1">
												<div class="font-medium">{config.name}</div>
												<div class="text-xs opacity-60">
													{config.workingDirectory.split('/').slice(-2).join('/')}
												</div>
											</div>
										</button>
									{/each}
								</div>
								<button
									class="btn btn-ghost btn-xs w-full mt-2"
									onclick={() => showRecentConfigs = false}
								>
									Cancel
								</button>
							</div>
						{:else}
							<input
								type="text"
								placeholder="Session name..."
								class="input input-bordered input-sm w-full mb-2"
								bind:value={newSessionName}
								onkeydown={(e) => e.key === 'Enter' && createSession()}
							/>
							<DirectoryPickerNew 
								bind:selectedDirectory={newSessionDirectory}
								placeholder="Select working directory (optional)"
							/>
						{/if}
						
						{#if !showRecentConfigs}
							<div class="flex gap-2 mt-2">
								<button 
									class="btn btn-primary btn-sm flex-1"
									onclick={createSession}
								>
									Create
								</button>
								<button 
									class="btn btn-ghost btn-sm flex-1"
									onclick={() => { isCreatingSession = false; newSessionName = ''; newSessionDirectory = ''; showRecentConfigs = false; }}
								>
									Cancel
								</button>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Sessions list -->
				<div class="flex-1 overflow-y-auto">
					{#each sessions as session (session.sessionId)}
						<div
							class={`
								p-4 border-b border-base-300 cursor-pointer hover:bg-base-300
								${session.sessionId === activeSessionId ? 'bg-base-300' : ''}
							`}
							onclick={() => switchSession(session.sessionId)}
						>
							<div class="flex items-center justify-between">
								<div class="flex-1">
									{#if renamingSessionId === session.sessionId}
										<div class="flex items-center gap-2 mb-2" onclick={(e) => e.stopPropagation()}>
											<input
												type="text"
												class="input input-sm input-bordered flex-1"
												bind:value={newSessionNameForRename}
												onkeydown={(e) => {
													if (e.key === 'Enter') saveRename();
													if (e.key === 'Escape') cancelRename();
												}}
												autofocus
											/>
											<button 
												class="btn btn-ghost btn-xs"
												onclick={saveRename}
											>
												✓
											</button>
											<button 
												class="btn btn-ghost btn-xs"
												onclick={cancelRename}
											>
												✕
											</button>
										</div>
									{:else}
										<div class="flex items-center gap-2">
											<h3 class="font-semibold">{session.name}</h3>
											{#if session.isClaudeSession}
												<span class="badge badge-secondary badge-xs">Claude</span>
											{/if}
										</div>
									{/if}
									<p class="text-sm text-base-content/60">
										{session.status} • {new Date(session.lastActiveAt).toLocaleString()}
									</p>
									{#if session.isClaudeSession && session.claudeSessionId}
										<p class="text-xs text-base-content/40 mt-1">
											Session ID: {session.claudeSessionId.substring(0, 8)}...
										</p>
									{/if}
								</div>
								<div class="dropdown dropdown-end">
									<button 
										class="btn btn-ghost btn-xs"
										onclick={(e) => e.stopPropagation()}
									>
										⋮
									</button>
									<ul class="dropdown-content z-10 menu p-2 shadow bg-base-100 rounded-box w-52">
										<li><button onclick={() => startRenaming(session.sessionId)}>
											<span class="flex items-center gap-2">
												✏️ Rename
											</span>
										</button></li>
										{#if session.isClaudeSession && session.claudeSessionId && session.status === 'inactive'}
											<li><button onclick={() => resumeClaudeSession(session)}>
												<span class="flex items-center gap-2">
													▶️ Resume Claude Session
												</span>
											</button></li>
										{/if}
										{#if session.status === 'active'}
											<li><button onclick={() => terminateSession(session.sessionId)}>Terminate</button></li>
										{/if}
										{#if session.status === 'crashed' || session.status === 'terminated'}
											<li><button onclick={() => restartSession(session.sessionId)}>
												<span class="flex items-center gap-2">
													🔄 Resume Session
												</span>
											</button></li>
										{/if}
										{#if session.status === 'crashed' || (session.status === 'terminated' && session.canReinitialize)}
											<li><button onclick={() => reinitializeSession(session.sessionId)}>New Session (same dir)</button></li>
										{/if}
										<li><button onclick={() => deleteSession(session.sessionId)}>Delete</button></li>
									</ul>
								</div>
							</div>
						</div>
					{/each}
					
					{#if sessions.length === 0}
						<div class="p-4 text-center text-base-content/60">
							No sessions yet. Create one to get started!
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Backdrop for mobile -->
		{#if isMobileMenuOpen}
			<button 
				class="fixed inset-0 bg-black/50 z-40 lg:hidden"
				onclick={() => isMobileMenuOpen = false}
			></button>
		{/if}

		<!-- Main content -->
		<div class="flex-1 flex flex-col">
			{#if activeSession()}
				{#key activeSession()!.sessionId}
					<ClaudeTerminal 
						bind:this={activeTerminal}
						sessionId={activeSession()!.sessionId}
						onCommand={handleTerminalCommand}
						onResize={handleTerminalResize}
					/>
				{/key}
			{:else}
				<div class="flex-1 flex items-center justify-center p-4">
					<div class="text-center max-w-2xl">
						<h2 class="text-2xl font-bold mb-4">Welcome to Clauditorium</h2>
						<p class="text-base-content/60 mb-6">
							Select a session from the sidebar or create a new one to get started.
						</p>
						<button 
							class="btn btn-primary mb-8"
							onclick={() => { isCreatingSession = true; isMobileMenuOpen = true; }}
						>
							Create New Session
						</button>
						
						{#if recentConfigs.length > 0}
							<div class="divider">OR</div>
							
							<div class="text-left">
								<h3 class="text-lg font-semibold mb-3">Quick Start - Recent Sessions</h3>
								<div class="grid gap-2">
									{#each recentConfigs as config}
										<button 
											class="btn btn-outline btn-sm justify-start text-left"
											onclick={() => createSessionFromRecent(config)}
										>
											<div class="flex-1">
												<div class="font-medium">{config.name}</div>
												<div class="text-xs text-base-content/60">
													{config.workingDirectory}
												</div>
											</div>
											<span class="text-xs text-base-content/60">
												Used {config.useCount}x
											</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Discovery Modal -->
	<SessionDiscoveryModal 
		bind:this={discoveryModal}
		on:sessions-imported={handleSessionsImported}
	/>
</div>