<script lang="ts">
	import Terminal from './Terminal.svelte';

	interface Props {
		sessionId: string;
		onCommand?: (command: string) => void;
		onResize?: (cols: number, rows: number) => void;
	}

	let { 
		sessionId,
		onCommand = $bindable<(command: string) => void>(),
		onResize = $bindable<(cols: number, rows: number) => void>()
	}: Props = $props();

	let terminalRef: Terminal;
	let inputBuffer = '';
	// Load scroll settings from localStorage
	let autoScroll = $state(true);
	let instantScroll = $state(
		typeof localStorage !== 'undefined' 
			? (localStorage.getItem('terminal-instant-scroll') !== 'false') // Default true unless explicitly false
			: true // Default to true for SSR
	);
	let scrollDisposable: any;
	let pendingScrollTimeout: ReturnType<typeof setTimeout> | null = null;

	// Special key mappings for Claude Code
	const specialKeys = {
		Enter: '\r',
		Escape: '\x1b',
		ArrowUp: '\x1b[A',
		ArrowDown: '\x1b[B',
		ArrowLeft: '\x1b[D',
		ArrowRight: '\x1b[C',
		Tab: '\t',
		Backspace: '\x7f'
	};

	function handleData(data: string) {
		// Send raw data to backend
		if (onCommand) {
			onCommand(data);
		}
	}

	function handleKey(key: string, ev: KeyboardEvent) {
		// Prevent default for special keys
		if (ev.key in specialKeys) {
			ev.preventDefault();
		}
	}

	// Public methods to control the terminal
	export function write(data: string) {
		writeWithAutoScroll(data);
	}

	export function writeln(data: string) {
		terminalRef?.writeln(data);
		if (autoScroll) {
			if (instantScroll) {
				terminalRef?.scrollToBottom();
			} else {
				if (pendingScrollTimeout) {
					clearTimeout(pendingScrollTimeout);
				}
				pendingScrollTimeout = setTimeout(() => {
					terminalRef?.scrollToBottom();
					pendingScrollTimeout = null;
				}, 16);
			}
		}
	}

	export function clear() {
		terminalRef?.clear();
	}

	export function focus() {
		terminalRef?.focus();
	}

	export function scrollToBottom() {
		terminalRef?.scrollToBottom();
	}

	// Save instant scroll setting to localStorage
	$effect(() => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('terminal-instant-scroll', String(instantScroll));
		}
	});

	// Setup scroll detection when terminal is ready
	$effect(() => {
		if (terminalRef && terminalRef.onScroll) {
			scrollDisposable = terminalRef.onScroll(() => {
				// Check if user manually scrolled away from bottom
				if (autoScroll && !terminalRef.isScrolledToBottom()) {
					autoScroll = false;
				}
				// Re-enable auto-scroll if user scrolled back to bottom
				else if (!autoScroll && terminalRef.isScrolledToBottom()) {
					autoScroll = true;
				}
			});
		}
		return () => {
			if (scrollDisposable) {
				scrollDisposable.dispose();
			}
			if (pendingScrollTimeout) {
				clearTimeout(pendingScrollTimeout);
			}
		};
	});

	// Auto-scroll on new output
	let lastWriteTime = $state(0);
	
	function writeWithAutoScroll(data: string) {
		terminalRef?.write(data);
		lastWriteTime = Date.now();
		if (autoScroll) {
			if (instantScroll) {
				// Instant scroll - no animation or delay
				terminalRef?.scrollToBottom();
			} else {
				// Batched scrolling - debounce rapid scroll requests
				if (pendingScrollTimeout) {
					clearTimeout(pendingScrollTimeout);
				}
				pendingScrollTimeout = setTimeout(() => {
					terminalRef?.scrollToBottom();
					pendingScrollTimeout = null;
				}, 16); // ~60fps for smooth scrolling
			}
		}
	}

	// Keyboard shortcut buttons
	function sendKey(keyName: keyof typeof specialKeys) {
		const sequence = specialKeys[keyName];
		if (onCommand) {
			onCommand(sequence);
		}
		terminalRef?.write(sequence);
	}
</script>

<div class="claude-terminal flex flex-col h-full">
	<!-- Terminal -->
	<div class="flex-1 min-h-0">
		<Terminal
			bind:this={terminalRef}
			onData={handleData}
			onKey={handleKey}
			onResize={onResize}
		/>
	</div>

	<!-- Control buttons - Mobile optimized -->
	<div class="terminal-controls flex flex-wrap gap-2 p-2 bg-base-200 border-t border-base-300">
		<!-- Primary actions - always visible -->
		<div class="flex gap-1 flex-shrink-0">
			<button 
				class="btn btn-sm sm:btn-md btn-primary"
				onclick={() => sendKey('Enter')}
				title="Send Enter (Accept)"
			>
				<span class="hidden sm:inline">Enter</span> ↵
			</button>
			<button 
				class="btn btn-sm sm:btn-md btn-secondary"
				onclick={() => sendKey('Escape')}
				title="Send Escape (Reject)"
			>
				Esc
			</button>
		</div>
		
		<!-- Arrow keys - responsive grid -->
		<div class="flex gap-1 flex-shrink-0">
			<div class="grid grid-cols-3 gap-1">
				<div></div>
				<button 
					class="btn btn-sm sm:btn-md btn-neutral"
					onclick={() => sendKey('ArrowUp')}
					title="Arrow Up"
				>
					↑
				</button>
				<div></div>
				<button 
					class="btn btn-sm sm:btn-md btn-neutral"
					onclick={() => sendKey('ArrowLeft')}
					title="Arrow Left"
				>
					←
				</button>
				<button 
					class="btn btn-sm sm:btn-md btn-neutral"
					onclick={() => sendKey('ArrowDown')}
					title="Arrow Down"
				>
					↓
				</button>
				<button 
					class="btn btn-sm sm:btn-md btn-neutral"
					onclick={() => sendKey('ArrowRight')}
					title="Arrow Right"
				>
					→
				</button>
			</div>
		</div>

		<!-- Tab key -->
		<div class="flex gap-1 flex-shrink-0">
			<button 
				class="btn btn-sm sm:btn-md btn-neutral"
				onclick={() => sendKey('Tab')}
				title="Send Tab"
			>
				Tab
			</button>
		</div>

		<!-- Scroll controls -->
		<div class="flex gap-1 flex-shrink-0 items-center">
			<button 
				class="btn btn-sm sm:btn-md btn-neutral"
				onclick={() => {
					scrollToBottom();
					autoScroll = true;
				}}
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
				<span class="hidden sm:inline">Auto</span>
			</label>
			<label class="label cursor-pointer flex gap-1 text-xs">
				<input 
					type="checkbox" 
					class="checkbox checkbox-xs" 
					bind:checked={instantScroll}
					title="Instant scroll (no animation) - better for fast output and mobile"
				/>
				<span class="hidden lg:inline">Instant</span>
				<span class="lg:hidden">⚡</span>
			</label>
		</div>

		<!-- Session info - hidden on very small screens -->
		<div class="hidden sm:flex ml-auto text-sm text-base-content/60 self-center">
			Session: {sessionId}
		</div>
	</div>
</div>

<style>
	.claude-terminal {
		background-color: #1e1e1e;
	}
</style>