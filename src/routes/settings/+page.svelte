<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';

	let isResetting = $state(false);
	let resetConfirmation = $state('');
	let showResetDialog = $state(false);
	
	// Theme settings
	let currentTheme = $state('dark');
	let availableThemes = [
		{ value: 'light', label: 'Light Mode', icon: '☀️' },
		{ value: 'dark', label: 'Dark Mode', icon: '🌙' },
		{ value: 'system', label: 'System Default', icon: '🖥️' }
	];

	onMount(() => {
		if (browser) {
			// Load current theme from localStorage or default to dark
			const savedTheme = localStorage.getItem('theme') || 'dark';
			currentTheme = savedTheme;
			applyTheme(savedTheme);
		}
	});

	function applyTheme(theme: string) {
		if (!browser) return;
		
		const html = document.documentElement;
		
		if (theme === 'system') {
			// Remove explicit theme, let CSS media query handle it
			html.removeAttribute('data-theme');
			localStorage.setItem('theme', 'system');
		} else {
			html.setAttribute('data-theme', theme);
			localStorage.setItem('theme', theme);
		}
	}

	function handleThemeChange(theme: string) {
		currentTheme = theme;
		applyTheme(theme);
	}

	async function resetDatabase() {
		if (resetConfirmation !== 'RESET') {
			return;
		}

		isResetting = true;
		try {
			const response = await fetch('/api/settings/reset-database', {
				method: 'POST'
			});

			const result = await response.json();
			
			if (result.success) {
				alert('Database reset successfully! Redirecting to home...');
				showResetDialog = false;
				resetConfirmation = '';
				goto('/');
			} else {
				alert(`Failed to reset database: ${result.error}`);
			}
		} catch (error) {
			console.error('Error resetting database:', error);
			alert('Network error while resetting database');
		} finally {
			isResetting = false;
		}
	}

	function openResetDialog() {
		showResetDialog = true;
		resetConfirmation = '';
	}

	function closeResetDialog() {
		showResetDialog = false;
		resetConfirmation = '';
	}
</script>

<svelte:head>
	<title>Settings - Clauditorium</title>
</svelte:head>

<div class="min-h-screen bg-base-100">
	<!-- Header -->
	<div class="navbar bg-base-200 shadow-lg">
		<div class="navbar-start">
			<a href="/" class="btn btn-ghost">
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
				</svg>
				Back
			</a>
		</div>
		<div class="navbar-center">
			<h1 class="text-xl font-bold">Settings</h1>
		</div>
		<div class="navbar-end">
			<!-- Empty for symmetry -->
		</div>
	</div>

	<!-- Settings Content -->
	<div class="container mx-auto max-w-4xl p-6">
		<!-- Appearance Section -->
		<div class="card bg-base-200 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title text-2xl mb-4">
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v12a4 4 0 004 4h4a2 2 0 002-2V5z"></path>
					</svg>
					Appearance
				</h2>
				
				<div class="form-control w-full max-w-xs">
					<label class="label">
						<span class="label-text font-semibold">Theme</span>
					</label>
					<div class="grid grid-cols-1 gap-2">
						{#each availableThemes as theme}
							<label class="label cursor-pointer justify-start gap-3 p-3 rounded-lg border border-base-300 hover:bg-base-300 {currentTheme === theme.value ? 'bg-primary text-primary-content border-primary' : ''}">
								<input 
									type="radio" 
									class="radio radio-sm" 
									value={theme.value}
									checked={currentTheme === theme.value}
									onchange={() => handleThemeChange(theme.value)}
								/>
								<span class="text-xl">{theme.icon}</span>
								<span class="label-text font-medium">{theme.label}</span>
							</label>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- Data Management Section -->
		<div class="card bg-base-200 shadow-xl mb-6">
			<div class="card-body">
				<h2 class="card-title text-2xl mb-4">
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"></path>
					</svg>
					Data Management
				</h2>
				
				<div class="space-y-4">
					<div class="alert alert-warning">
						<svg class="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
						</svg>
						<div>
							<h3 class="font-bold">Danger Zone</h3>
							<div class="text-xs">These actions cannot be undone!</div>
						</div>
					</div>

					<div class="border border-error rounded-lg p-4">
						<h3 class="font-semibold text-lg mb-2">Reset Database</h3>
						<p class="text-sm text-base-content/70 mb-4">
							This will permanently delete all sessions, history, and configuration data. 
							Your Claude CLI sessions in ~/.claude will not be affected.
						</p>
						<button 
							class="btn btn-error"
							onclick={openResetDialog}
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
							</svg>
							Reset Database
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- About Section -->
		<div class="card bg-base-200 shadow-xl">
			<div class="card-body">
				<h2 class="card-title text-2xl mb-4">
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
					</svg>
					About
				</h2>
				<div class="space-y-2 text-sm">
					<p><strong>Clauditorium</strong> - Claude CLI Session Manager</p>
					<p>A comprehensive interface for managing Claude CLI sessions with discovery, resumption, and enhanced terminal functionality.</p>
					<div class="divider"></div>
					<p class="text-xs text-base-content/60">
						Built with SvelteKit, TypeScript, and Tailwind CSS
					</p>
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Reset Confirmation Modal -->
{#if showResetDialog}
	<div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
		<div class="bg-base-100 rounded-lg shadow-xl max-w-md w-full">
			<div class="p-6">
				<h3 class="text-lg font-semibold text-error mb-4">⚠️ Confirm Database Reset</h3>
				<p class="text-sm text-base-content/80 mb-4">
					This action will permanently delete:
				</p>
				<ul class="text-sm text-base-content/80 mb-4 list-disc list-inside space-y-1">
					<li>All session records and history</li>
					<li>Recent configurations and directories</li>
					<li>Application settings and preferences</li>
				</ul>
				<p class="text-sm text-base-content/80 mb-4">
					<strong>Note:</strong> Your actual Claude CLI sessions in ~/.claude will remain untouched.
				</p>
				
				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text font-semibold">Type "RESET" to confirm:</span>
					</label>
					<input 
						type="text" 
						class="input input-bordered"
						bind:value={resetConfirmation}
						placeholder="RESET"
					/>
				</div>

				<div class="flex gap-2 justify-end">
					<button class="btn btn-outline" onclick={closeResetDialog}>
						Cancel
					</button>
					<button 
						class="btn btn-error"
						onclick={resetDatabase}
						disabled={resetConfirmation !== 'RESET' || isResetting}
					>
						{#if isResetting}
							<span class="loading loading-spinner loading-sm"></span>
							Resetting...
						{:else}
							Reset Database
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}