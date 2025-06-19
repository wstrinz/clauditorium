import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { path } = await request.json();
		
		if (!path || typeof path !== 'string') {
			return json({ error: 'Invalid path' }, { status: 400 });
		}

		// Security check: only allow paths within user's home directory or common safe paths
		const safePaths = ['/home/wstrinz', '/tmp', '/var/tmp'];
		const isPathSafe = safePaths.some(safePath => 
			path === safePath || path.startsWith(safePath + '/')
		);

		if (!isPathSafe) {
			return json({ error: 'Access denied' }, { status: 403 });
		}

		try {
			const entries = await readdir(path);
			const directories: string[] = [];

			// Check each entry to see if it's a directory
			for (const entry of entries) {
				try {
					const fullPath = join(path, entry);
					const stats = await stat(fullPath);
					
					// Only include directories, skip hidden directories (starting with .)
					if (stats.isDirectory() && !entry.startsWith('.')) {
						directories.push(fullPath);
					}
				} catch (error) {
					// Skip entries we can't access
					continue;
				}
			}

			// Sort directories alphabetically
			directories.sort();

			return json({ 
				directories,
				currentPath: path 
			});

		} catch (error) {
			return json({ 
				error: 'Unable to read directory',
				directories: [],
				currentPath: path 
			}, { status: 400 });
		}

	} catch (error) {
		console.error('Directory listing error:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};