<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	let Terminal: any;
	import type { ITerminalOptions } from '@xterm/xterm';
	import '@xterm/xterm/css/xterm.css';

	let { 
		onData = $bindable<(data: string) => void>(),
		onKey = $bindable<(key: string, ev: KeyboardEvent) => void>(),
		onResize = $bindable<(cols: number, rows: number) => void>(),
		options = {} as ITerminalOptions
	} = $props();

	let container: HTMLDivElement;
	let terminal: any = null;

	const defaultOptions: ITerminalOptions = {
		cursorBlink: true,
		fontSize: 14,
		fontFamily: 'Menlo, Monaco, "Courier New", monospace',
		theme: {
			background: '#1e1e1e',
			foreground: '#d4d4d4',
			cursor: '#aeafad',
			selectionBackground: '#3e4451',
			black: '#1e1e1e',
			red: '#f44747',
			green: '#608b4e',
			yellow: '#dcdcaa',
			blue: '#569cd6',
			magenta: '#c678dd',
			cyan: '#56b6c2',
			white: '#d4d4d4',
			brightBlack: '#545454',
			brightRed: '#f44747',
			brightGreen: '#608b4e',
			brightYellow: '#dcdcaa',
			brightBlue: '#569cd6',
			brightMagenta: '#c678dd',
			brightCyan: '#56b6c2',
			brightWhite: '#d4d4d4'
		}
	};

	let resizeObserver: ResizeObserver;

	onMount(async () => {
		// Dynamically import xterm
		const xtermModule = await import('@xterm/xterm');
		Terminal = xtermModule.Terminal;

		terminal = new Terminal({
			...defaultOptions,
			...options
		});

		terminal.open(container);

		// Handle data input
		if (onData) {
			terminal.onData(onData);
		}

		// Handle key events
		if (onKey) {
			terminal.onKey(({ key, domEvent }: any) => {
				onKey(key, domEvent);
			});
		}

		// Fit terminal to container
		resizeObserver = new ResizeObserver(() => {
			if (terminal && container) {
				const cols = Math.floor(container.clientWidth / 9);
				const rows = Math.floor(container.clientHeight / 17);
				terminal.resize(cols, rows);
				
				// Notify parent component of resize
				if (onResize) {
					onResize(cols, rows);
				}
			}
		});

		if (container) {
			resizeObserver.observe(container);
		}
	});

	onDestroy(() => {
		if (terminal) {
			terminal.dispose();
		}
		if (resizeObserver) {
			resizeObserver.disconnect();
		}
	});

	export function write(data: string) {
		if (terminal) {
			terminal.write(data);
		}
	}

	export function writeln(data: string) {
		if (terminal) {
			terminal.writeln(data);
		}
	}

	export function clear() {
		if (terminal) {
			terminal.clear();
		}
	}

	export function focus() {
		if (terminal) {
			terminal.focus();
		}
	}

	export function scrollToBottom() {
		if (terminal) {
			terminal.scrollToBottom();
		}
	}

	export function isScrolledToBottom(): boolean {
		if (!terminal) return true;
		return terminal.buffer.active.viewportY === terminal.buffer.active.length - terminal.rows;
	}

	export function onScroll(callback: () => void) {
		if (terminal) {
			return terminal.onScroll(callback);
		}
	}
</script>

<div bind:this={container} class="terminal-container w-full h-full"></div>

<style>
	.terminal-container {
		background-color: #1e1e1e;
	}
</style>