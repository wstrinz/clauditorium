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
		terminalRef?.write(data);
	}

	export function writeln(data: string) {
		terminalRef?.writeln(data);
	}

	export function clear() {
		terminalRef?.clear();
	}

	export function focus() {
		terminalRef?.focus();
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