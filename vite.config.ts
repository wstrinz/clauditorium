import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		allowedHosts: ['localhost', '127.0.0.1', '0.0.0.0', 'clauditorium.local'],
		watch: {
			ignored: ['**/server.log', '**/logs/**']
		}
	}
});
