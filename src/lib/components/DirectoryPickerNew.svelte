<script lang="ts">
	import { onMount } from 'svelte';
	import { recentConfigsService } from '$lib/services/recent-configs';

	let { 
		selectedDirectory = $bindable(''),
		placeholder = 'Select working directory'
	}: {
		selectedDirectory: string;
		placeholder?: string;
	} = $props();

	let inputValue = $state(selectedDirectory);
	let showSuggestions = $state(false);
	let isLoading = $state(false);
	let currentPath = $state('');
	let suggestions = $state<Array<{path: string, type: 'recent' | 'quick' | 'browse', name: string}>>([]);
	let inputElement: HTMLInputElement;
	let selectedIndex = $state(-1);

	// Watch for external changes to selectedDirectory
	$effect(() => {
		if (selectedDirectory !== inputValue) {
			inputValue = selectedDirectory;
		}
	});

	// Common paths that are likely to be useful
	const homeDir = '/home/wstrinz'; // This will be determined server-side
	const quickPaths = [
		{ path: homeDir, name: '🏠 Home' },
		{ path: `${homeDir}/dev`, name: '💻 Development' },
		{ path: `${homeDir}/Desktop`, name: '🖥️ Desktop' },
		{ path: `${homeDir}/Documents`, name: '📄 Documents' },
		{ path: `${homeDir}/Downloads`, name: '📥 Downloads' },
		{ path: `${homeDir}/Projects`, name: '🛠️ Projects' },
		{ path: '/tmp', name: '📁 Temporary' },
		{ path: '/opt', name: '⚙️ Optional Software' },
		{ path: '/usr/local', name: '🔧 Local Programs' }
	];

	async function loadSuggestions(query: string = '') {
		isLoading = true;
		const newSuggestions: typeof suggestions = [];

		try {
			// If no query or very short query, show recent and quick paths
			if (!query || query.length < 2) {
				// Add recent directories
				const recent = recentConfigsService.getMostUsedDirectories(5);
				recent.forEach(dir => {
					newSuggestions.push({
						path: dir.path,
						type: 'recent',
						name: `🕐 ${dir.path.split('/').pop() || dir.path} (${dir.useCount}x)`
					});
				});

				// Add quick paths
				quickPaths.forEach(quick => {
					newSuggestions.push({
						path: quick.path,
						type: 'quick',
						name: quick.name
					});
				});
			}

			// If query looks like a path, browse the current directory for completions
			if (query && (query.startsWith('/') || query.startsWith('.'))) {
				let pathToBrowse = query;
				let searchPrefix = '';

				// If path doesn't end with /, it might be a partial directory name
				if (!query.endsWith('/')) {
					const parts = query.split('/');
					searchPrefix = parts.pop()?.toLowerCase() || '';
					pathToBrowse = parts.join('/') || '/';
				}

				// If pathToBrowse is empty or just '/', browse root
				if (!pathToBrowse || pathToBrowse === '') {
					pathToBrowse = '/';
				}

				try {
					const response = await fetch('/api/directories', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ path: pathToBrowse })
					});
					
					if (response.ok) {
						const data = await response.json();
						const directories = data.directories || [];
						
						// Filter directories based on search prefix and add them
						directories
							.filter((dir: string) => {
								const dirName = dir.split('/').pop()?.toLowerCase() || '';
								return !searchPrefix || dirName.startsWith(searchPrefix);
							})
							.slice(0, 10) // Limit to 10 results
							.forEach((dir: string) => {
								const dirName = dir.split('/').pop() || dir;
								newSuggestions.push({
									path: dir,
									type: 'browse',
									name: `📁 ${dirName}`
								});
							});
					}
				} catch (error) {
					console.error('Error browsing directory:', error);
				}
			}

			suggestions = newSuggestions;
			selectedIndex = -1; // Reset selection when suggestions change
		} finally {
			isLoading = false;
		}
	}

	function handleInput(event: Event) {
		const target = event.target as HTMLInputElement;
		inputValue = target.value;
		selectedDirectory = inputValue;
		
		if (inputValue.length > 0) {
			showSuggestions = true;
			loadSuggestions(inputValue);
		} else {
			showSuggestions = true;
			loadSuggestions();
		}
	}

	function handleFocus() {
		showSuggestions = true;
		loadSuggestions(inputValue);
	}

	function handleBlur() {
		// Delay hiding to allow clicking on suggestions
		setTimeout(() => {
			showSuggestions = false;
		}, 150);
	}

	function selectSuggestion(suggestion: typeof suggestions[0]) {
		if (suggestion.type === 'browse') {
			// For directories, add trailing slash and continue building
			inputValue = suggestion.path + '/';
			selectedDirectory = inputValue;
			loadSuggestions(inputValue);
			selectedIndex = -1;
			// Keep suggestions open for continued navigation
		} else {
			// For complete paths, select and close
			inputValue = suggestion.path;
			selectedDirectory = suggestion.path;
			showSuggestions = false;
			inputElement.blur();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!showSuggestions && !['Tab', 'Enter'].includes(event.key)) return;

		if (event.key === 'Escape') {
			showSuggestions = false;
			selectedIndex = -1;
			inputElement.blur();
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!showSuggestions) {
				showSuggestions = true;
				loadSuggestions(inputValue);
			}
			selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, -1);
			return;
		}

		if (event.key === 'Tab') {
			event.preventDefault();
			if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
				// Tab completes the selected suggestion
				const suggestion = suggestions[selectedIndex];
				if (suggestion.type === 'browse') {
					// For directories, add trailing slash and continue building path
					inputValue = suggestion.path + '/';
					selectedDirectory = inputValue;
					showSuggestions = true;
					loadSuggestions(inputValue);
					selectedIndex = -1;
				} else {
					// For complete paths, select and close
					selectSuggestion(suggestion);
				}
			} else if (suggestions.length > 0) {
				// Tab with no selection - complete the first match
				const firstBrowse = suggestions.find(s => s.type === 'browse');
				if (firstBrowse) {
					inputValue = firstBrowse.path + '/';
					selectedDirectory = inputValue;
					loadSuggestions(inputValue);
					selectedIndex = -1;
				}
			}
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
				const suggestion = suggestions[selectedIndex];
				if (suggestion.type === 'browse') {
					// Enter on directory - navigate into it
					inputValue = suggestion.path + '/';
					selectedDirectory = inputValue;
					showSuggestions = true;
					loadSuggestions(inputValue);
					selectedIndex = -1;
				} else {
					// Enter on complete path - select it
					selectSuggestion(suggestion);
				}
			} else if (inputValue.trim()) {
				// Enter with no selection - accept current value
				selectedDirectory = inputValue.trim();
				showSuggestions = false;
				inputElement.blur();
			}
			return;
		}
	}

	onMount(() => {
		loadSuggestions();
	});
</script>

<div class="directory-picker-new relative">
	<input
		bind:this={inputElement}
		type="text"
		{placeholder}
		class="input input-bordered input-sm w-full"
		value={inputValue}
		oninput={handleInput}
		onfocus={handleFocus}
		onblur={handleBlur}
		onkeydown={handleKeydown}
		autocomplete="off"
	/>

	{#if showSuggestions}
		<div class="absolute top-full left-0 right-0 z-10 mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
			{#if isLoading}
				<div class="p-3 flex items-center gap-2 text-sm text-base-content/60">
					<span class="loading loading-spinner loading-xs"></span>
					Loading...
				</div>
			{:else if suggestions.length === 0}
				<div class="p-3 text-sm text-base-content/60">
					No suggestions found. Type a path like /home/user/project
				</div>
			{:else}
				<!-- Group suggestions by type -->
				{#if suggestions.some(s => s.type === 'recent')}
					<div class="p-2 border-b border-base-200">
						<div class="text-xs font-semibold text-base-content/60 mb-1">Recent</div>
						{#each suggestions.filter(s => s.type === 'recent') as suggestion, index}
							{@const globalIndex = suggestions.indexOf(suggestion)}
							<button
								class="w-full text-left px-2 py-1 text-sm rounded flex items-center gap-2 {globalIndex === selectedIndex ? 'bg-primary text-primary-content' : 'hover:bg-base-200'}"
								onclick={() => selectSuggestion(suggestion)}
							>
								<span class="truncate">{suggestion.name}</span>
								<span class="text-xs ml-auto font-mono {globalIndex === selectedIndex ? 'text-primary-content/70' : 'text-base-content/40'}">{suggestion.path}</span>
							</button>
						{/each}
					</div>
				{/if}

				{#if suggestions.some(s => s.type === 'quick')}
					<div class="p-2 border-b border-base-200">
						<div class="text-xs font-semibold text-base-content/60 mb-1">Quick Paths</div>
						{#each suggestions.filter(s => s.type === 'quick') as suggestion}
							{@const globalIndex = suggestions.indexOf(suggestion)}
							<button
								class="w-full text-left px-2 py-1 text-sm rounded flex items-center gap-2 {globalIndex === selectedIndex ? 'bg-primary text-primary-content' : 'hover:bg-base-200'}"
								onclick={() => selectSuggestion(suggestion)}
							>
								<span>{suggestion.name}</span>
								<span class="text-xs ml-auto font-mono {globalIndex === selectedIndex ? 'text-primary-content/70' : 'text-base-content/40'}">{suggestion.path}</span>
							</button>
						{/each}
					</div>
				{/if}

				{#if suggestions.some(s => s.type === 'browse')}
					<div class="p-2">
						<div class="text-xs font-semibold text-base-content/60 mb-1">Directories</div>
						{#each suggestions.filter(s => s.type === 'browse') as suggestion}
							{@const globalIndex = suggestions.indexOf(suggestion)}
							<button
								class="w-full text-left px-2 py-1 text-sm rounded flex items-center gap-2 {globalIndex === selectedIndex ? 'bg-primary text-primary-content' : 'hover:bg-base-200'}"
								onclick={() => selectSuggestion(suggestion)}
							>
								<span>{suggestion.name}</span>
								<span class="text-xs ml-auto opacity-60">→</span>
								<span class="text-xs font-mono {globalIndex === selectedIndex ? 'text-primary-content/70' : 'text-base-content/40'}">{suggestion.path}</span>
							</button>
						{/each}
					</div>
				{/if}
			{/if}

			<!-- Help text -->
			<div class="p-2 border-t border-base-200 text-xs text-base-content/40">
				💡 ↑/↓ to navigate • Tab to complete • Enter to navigate into folder • Click to build path
			</div>
		</div>
	{/if}
</div>

<style>
	.directory-picker-new {
		position: relative;
	}
</style>