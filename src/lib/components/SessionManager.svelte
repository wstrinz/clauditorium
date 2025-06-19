<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { sessionAPI, type SessionInfo } from '$lib/services/session-api';
	import { recentConfigsService, type RecentConfig } from '$lib/services/recent-configs';
	import ClaudeTerminal from './ClaudeTerminal.svelte';
	import DirectoryPicker from './DirectoryPicker.svelte';

	let sessions = $state<SessionInfo[]>([]);
	let activeSessionId = $state<string | null>(null);
	let isCreatingSession = $state(false);
	let newSessionName = $state('');
	let newSessionDirectory = $state('');
	let useContinueFlag = $state(false);
	let isMobileMenuOpen = $state(false);
	let activeTerminal: ClaudeTerminal | null = null;
	let recentConfigs = $state<RecentConfig[]>([]);
	let showRecentConfigs = $state(false);

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
		useContinueFlag = config.useContinueFlag;
		showRecentConfigs = false;
	}

	async function createSessionFromRecent(config: RecentConfig) {
		newSessionName = config.name;
		newSessionDirectory = config.workingDirectory;
		useContinueFlag = config.useContinueFlag;
		await createSession();
	}

	async function createSession() {
		if (!newSessionName.trim()) return;

		try {
			// Create session on backend
			const sessionInfo = await sessionAPI.createSession(
				newSessionName.trim(),
				newSessionDirectory || undefined, 
				useContinueFlag
			);
			
			// Save to recent configs
			recentConfigsService.addRecentConfig({
				name: sessionInfo.name,
				workingDirectory: sessionInfo.workingDirectory,
				useContinueFlag: sessionInfo.useContinueFlag
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
			useContinueFlag = false;
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
			// Terminating is same as deleting since we're using server storage
			await sessionAPI.deleteSession(sessionId);
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

			// Create new session on backend with same directory and continue flag
			const sessionInfo = await sessionAPI.createSession(
				session.name,
				session.workingDirectory, 
				session.useContinueFlag || false
			);

			await loadSessions();
			
			// Switch to the new session
			activeSessionId = sessionInfo.sessionId;
			connectToSession(sessionInfo.sessionId);
		} catch (error) {
			console.error('Failed to reinitialize session:', error);
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
			<h1 class="text-xl font-bold hidden lg:block">Claudeitorium</h1>
		</div>
		
		<div class="navbar-center lg:hidden">
			<h1 class="text-xl font-bold">Claudeitorium</h1>
		</div>

		<div class="navbar-end">
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
							<DirectoryPicker 
								bind:selectedDirectory={newSessionDirectory}
							/>
						{/if}
						
						{#if !showRecentConfigs}
							<div class="form-control mt-2">
								<label class="label cursor-pointer justify-start gap-2">
									<input 
										type="checkbox" 
										class="checkbox checkbox-sm" 
										bind:checked={useContinueFlag}
									/>
									<span class="label-text text-sm">Use --continue (resume previous session)</span>
								</label>
							</div>
							<div class="flex gap-2 mt-2">
								<button 
									class="btn btn-primary btn-sm flex-1"
									onclick={createSession}
								>
									Create
								</button>
								<button 
									class="btn btn-ghost btn-sm flex-1"
									onclick={() => { isCreatingSession = false; newSessionName = ''; newSessionDirectory = ''; useContinueFlag = false; showRecentConfigs = false; }}
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
									<h3 class="font-semibold">{session.name}</h3>
									<p class="text-sm text-base-content/60">
										{session.status} • {new Date(session.lastActiveAt).toLocaleString()}
									</p>
								</div>
								<div class="dropdown dropdown-end">
									<button 
										class="btn btn-ghost btn-xs"
										onclick={(e) => e.stopPropagation()}
									>
										⋮
									</button>
									<ul class="dropdown-content z-10 menu p-2 shadow bg-base-100 rounded-box w-52">
										{#if session.status === 'active'}
											<li><button onclick={() => terminateSession(session.sessionId)}>Terminate</button></li>
										{/if}
										{#if session.status === 'crashed' || (session.status === 'terminated' && session.canReinitialize)}
											<li><button onclick={() => reinitializeSession(session.sessionId)}>Reinitialize</button></li>
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
						<h2 class="text-2xl font-bold mb-4">Welcome to Claudeitorium</h2>
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
													{#if config.useContinueFlag}
														• --continue
													{/if}
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
</div>