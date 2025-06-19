<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { db, type Session } from '$lib/db';
	import { sessionAPI } from '$lib/services/session-api';
	import ClaudeTerminal from './ClaudeTerminal.svelte';

	let sessions = $state<Session[]>([]);
	let activeSessionId = $state<string | null>(null);
	let isCreatingSession = $state(false);
	let newSessionName = $state('');
	let isMobileMenuOpen = $state(false);
	let activeTerminal: ClaudeTerminal | null = null;

	const activeSession = $derived(() => 
		sessions.find(s => s.sessionId === activeSessionId)
	);

	onMount(async () => {
		await loadSessions();
		// Connect to active session if one exists
		if (activeSessionId) {
			connectToSession(activeSessionId);
		}
	});

	onDestroy(() => {
		// Disconnect all sessions
		sessionAPI.disconnectAll();
	});

	async function loadSessions() {
		sessions = await db.getAllSessions();
		// Auto-select first active session
		const activeSessions = sessions.filter(s => s.status === 'active');
		if (activeSessions.length > 0 && !activeSessionId) {
			activeSessionId = activeSessions[0].sessionId;
		}
	}

	async function createSession() {
		if (!newSessionName.trim()) return;

		try {
			// Create session on backend
			const sessionInfo = await sessionAPI.createSession();
			
			// Store in local DB
			const session: Omit<Session, 'id'> = {
				sessionId: sessionInfo.sessionId,
				name: newSessionName.trim(),
				createdAt: new Date(sessionInfo.createdAt),
				lastActiveAt: new Date(),
				status: 'active',
				workingDirectory: sessionInfo.workingDirectory,
				history: []
			};

			await db.createSession(session);
			
			// Set active session before reloading to ensure it's selected
			activeSessionId = sessionInfo.sessionId;
			
			await loadSessions();
			newSessionName = '';
			isCreatingSession = false;
			isMobileMenuOpen = false;

			// Connect to session output
			connectToSession(sessionInfo.sessionId);
		} catch (error) {
			console.error('Failed to create session:', error);
			alert('Failed to create session. Please try again.');
		}
	}

	async function switchSession(sessionId: string) {
		// Disconnect from previous session
		if (activeSessionId) {
			sessionAPI.disconnectFromSession(activeSessionId);
		}

		activeSessionId = sessionId;
		await db.updateSession(sessionId, { lastActiveAt: new Date() });
		isMobileMenuOpen = false;

		// Connect to new session
		connectToSession(sessionId);
	}

	async function terminateSession(sessionId: string) {
		try {
			await sessionAPI.deleteSession(sessionId);
			await db.updateSession(sessionId, { status: 'terminated' });
			if (activeSessionId === sessionId) {
				activeSessionId = null;
			}
			await loadSessions();
		} catch (error) {
			console.error('Failed to terminate session:', error);
			alert('Failed to terminate session.');
		}
	}

	async function deleteSession(sessionId: string) {
		if (confirm('Delete this session? This cannot be undone.')) {
			try {
				await sessionAPI.deleteSession(sessionId);
				await db.deleteSession(sessionId);
				if (activeSessionId === sessionId) {
					activeSessionId = null;
				}
				await loadSessions();
			} catch (error) {
				console.error('Failed to delete session:', error);
				alert('Failed to delete session.');
			}
		}
	}

	function connectToSession(sessionId: string) {
		sessionAPI.connectToSession(sessionId, (data) => {
			// Write output to terminal if it's the active session
			if (activeTerminal && activeSessionId === sessionId) {
				activeTerminal.write(data);
			}

			// Log to database
			db.addOutput({
				sessionId,
				timestamp: new Date(),
				type: 'output',
				content: data
			});
		});
	}

	async function handleTerminalCommand(command: string) {
		if (!activeSessionId) return;
		
		try {
			// Send to backend
			await sessionAPI.sendInput(activeSessionId, command);
			
			// Log command to database
			await db.addOutput({
				sessionId: activeSessionId,
				timestamp: new Date(),
				type: 'input',
				content: command
			});
		} catch (error) {
			console.error('Failed to send command:', error);
		}
	}

	async function handleTerminalResize(cols: number, rows: number) {
		if (!activeSessionId) return;
		
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
						<input
							type="text"
							placeholder="Session name..."
							class="input input-bordered input-sm w-full"
							bind:value={newSessionName}
							onkeydown={(e) => e.key === 'Enter' && createSession()}
						/>
						<div class="flex gap-2 mt-2">
							<button 
								class="btn btn-primary btn-sm flex-1"
								onclick={createSession}
							>
								Create
							</button>
							<button 
								class="btn btn-ghost btn-sm flex-1"
								onclick={() => { isCreatingSession = false; newSessionName = ''; }}
							>
								Cancel
							</button>
						</div>
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
					<div class="text-center">
						<h2 class="text-2xl font-bold mb-4">Welcome to Claudeitorium</h2>
						<p class="text-base-content/60 mb-6">
							Select a session from the sidebar or create a new one to get started.
						</p>
						<button 
							class="btn btn-primary"
							onclick={() => { isCreatingSession = true; isMobileMenuOpen = true; }}
						>
							Create New Session
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>