import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

let client: Database.Database;
try {
	client = new Database(env.DATABASE_URL);
} catch (error) {
	console.error('Failed to initialize database:', error);
	// Try to use a memory database as fallback
	client = new Database(':memory:');
	console.warn('Using in-memory database as fallback');
}

export const db = drizzle(client, { schema });
