<script lang="ts">
	import { onMount } from 'svelte';
	import { recentConfigsService } from '$lib/services/recent-configs';

	let { 
		selectedDirectory = $bindable(''),
		onSelect = $bindable<(path: string) => void>()
	}: {
		selectedDirectory: string;
		onSelect?: (path: string) => void;
	} = $props();

	let currentPath = $state('/home/wstrinz');
	let directories = $state<string[]>([]);
	let isLoading = $state(false);
	let showPicker = $state(false);

	// Get recent directories
	const recentDirs = $derived(() => {
		const recent = recentConfigsService.getMostUsedDirectories(5);
		return recent.map(d => d.path);
	});

	// Common development directories
	const quickPaths = [
		'/home/wstrinz',
		'/home/wstrinz/dev',
		'/home/wstrinz/Desktop',
		'/home/wstrinz/Documents',
		'/tmp'
	];

	onMount(() => {
		loadDirectories(currentPath);
	});

	async function loadDirectories(path: string) {
		isLoading = true;
		try {
			const response = await fetch('/api/directories', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path })
			});
			
			if (response.ok) {
				const data = await response.json();
				directories = data.directories || [];
				currentPath = path;
			}
		} catch (error) {
			console.error('Failed to load directories:', error);
		} finally {
			isLoading = false;
		}
	}

	function selectDirectory(path: string) {
		selectedDirectory = path;
		showPicker = false;
		if (onSelect) {
			onSelect(path);
		}
	}

	function navigateToParent() {
		const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
		loadDirectories(parentPath);
	}
</script>

<div class="directory-picker">
	<div class="flex gap-2">
		<input
			type="text"
			placeholder="Working directory (optional)"
			class="input input-bordered input-sm flex-1"
			bind:value={selectedDirectory}
			readonly
		/>
		<button 
			class="btn btn-outline btn-sm"
			onclick={() => { showPicker = !showPicker; if (showPicker) loadDirectories(currentPath); }}
		>
			📁
		</button>
	</div>

	{#if showPicker}
		<div class="directory-browser mt-2 p-3 border border-base-300 rounded-lg bg-base-100 max-h-60 overflow-y-auto">
			<!-- Recent directories -->
			{#if recentDirs().length > 0}
				<div class="mb-3">
					<h4 class="text-sm font-semibold mb-1">Recent Directories</h4>
					<div class="grid grid-cols-1 gap-1">
						{#each recentDirs() as path}
							<button 
								class="btn btn-ghost btn-xs justify-start text-left"
								onclick={() => selectDirectory(path)}
							>
								🕐 {path}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Quick paths -->
			<div class="mb-3">
				<h4 class="text-sm font-semibold mb-1">Quick Paths</h4>
				<div class="grid grid-cols-1 gap-1">
					{#each quickPaths as path}
						<button 
							class="btn btn-ghost btn-xs justify-start text-left"
							onclick={() => selectDirectory(path)}
						>
							📁 {path}
						</button>
					{/each}
				</div>
			</div>

			<!-- Current directory browser -->
			<div>
				<div class="flex items-center gap-2 mb-2">
					<h4 class="text-sm font-semibold">Browse: {currentPath}</h4>
					{#if currentPath !== '/'}
						<button 
							class="btn btn-ghost btn-xs"
							onclick={navigateToParent}
						>
							↑ Up
						</button>
					{/if}
				</div>

				{#if isLoading}
					<div class="flex items-center gap-2 text-sm text-base-content/60">
						<span class="loading loading-spinner loading-xs"></span>
						Loading...
					</div>
				{:else if directories.length === 0}
					<div class="text-sm text-base-content/60">No subdirectories found</div>
				{:else}
					<div class="grid grid-cols-1 gap-1">
						<!-- Current directory option -->
						<button 
							class="btn btn-ghost btn-xs justify-start text-left font-semibold"
							onclick={() => selectDirectory(currentPath)}
						>
							📂 Use current directory
						</button>
						
						<!-- Subdirectories -->
						{#each directories as dir}
							<button 
								class="btn btn-ghost btn-xs justify-start text-left"
								onclick={() => loadDirectories(dir)}
							>
								📁 {dir.split('/').pop()}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Manual input -->
			<div class="mt-3 pt-2 border-t border-base-300">
				<input
					type="text"
					placeholder="Or type custom path..."
					class="input input-bordered input-xs w-full"
					onkeydown={(e) => {
						if (e.key === 'Enter' && e.currentTarget.value.trim()) {
							selectDirectory(e.currentTarget.value.trim());
						}
					}}
				/>
			</div>
		</div>
	{/if}
</div>

<style>
	.directory-picker {
		position: relative;
	}
</style>