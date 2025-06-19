export interface RecentConfig {
	name: string;
	workingDirectory: string;
	useContinueFlag: boolean;
	lastUsed: Date;
	useCount: number;
}

export interface RecentDirectory {
	path: string;
	lastUsed: Date;
	useCount: number;
}

const RECENT_CONFIGS_KEY = 'clauditorium_recent_configs';
const RECENT_DIRS_KEY = 'clauditorium_recent_dirs';
const MAX_RECENT_ITEMS = 10;

export class RecentConfigsService {
	getRecentConfigs(): RecentConfig[] {
		try {
			const stored = localStorage.getItem(RECENT_CONFIGS_KEY);
			if (!stored) return [];
			
			const configs = JSON.parse(stored) as RecentConfig[];
			// Convert date strings back to Date objects
			return configs.map(c => ({
				...c,
				lastUsed: new Date(c.lastUsed)
			}));
		} catch (error) {
			console.error('Failed to load recent configs:', error);
			return [];
		}
	}

	addRecentConfig(config: Omit<RecentConfig, 'lastUsed' | 'useCount'>): void {
		try {
			const configs = this.getRecentConfigs();
			
			// Check if this config already exists
			const existingIndex = configs.findIndex(c => 
				c.name === config.name && 
				c.workingDirectory === config.workingDirectory &&
				c.useContinueFlag === config.useContinueFlag
			);
			
			if (existingIndex >= 0) {
				// Update existing config
				configs[existingIndex].lastUsed = new Date();
				configs[existingIndex].useCount += 1;
				
				// Move to front
				const [existing] = configs.splice(existingIndex, 1);
				configs.unshift(existing);
			} else {
				// Add new config
				configs.unshift({
					...config,
					lastUsed: new Date(),
					useCount: 1
				});
			}
			
			// Keep only the most recent configs
			const trimmed = configs.slice(0, MAX_RECENT_ITEMS);
			
			localStorage.setItem(RECENT_CONFIGS_KEY, JSON.stringify(trimmed));
		} catch (error) {
			console.error('Failed to save recent config:', error);
		}
	}

	getRecentDirectories(): RecentDirectory[] {
		try {
			const stored = localStorage.getItem(RECENT_DIRS_KEY);
			if (!stored) return [];
			
			const dirs = JSON.parse(stored) as RecentDirectory[];
			// Convert date strings back to Date objects
			return dirs.map(d => ({
				...d,
				lastUsed: new Date(d.lastUsed)
			}));
		} catch (error) {
			console.error('Failed to load recent directories:', error);
			return [];
		}
	}

	addRecentDirectory(path: string): void {
		try {
			const dirs = this.getRecentDirectories();
			
			// Check if this directory already exists
			const existingIndex = dirs.findIndex(d => d.path === path);
			
			if (existingIndex >= 0) {
				// Update existing directory
				dirs[existingIndex].lastUsed = new Date();
				dirs[existingIndex].useCount += 1;
				
				// Move to front
				const [existing] = dirs.splice(existingIndex, 1);
				dirs.unshift(existing);
			} else {
				// Add new directory
				dirs.unshift({
					path,
					lastUsed: new Date(),
					useCount: 1
				});
			}
			
			// Keep only the most recent directories
			const trimmed = dirs.slice(0, MAX_RECENT_ITEMS);
			
			localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(trimmed));
		} catch (error) {
			console.error('Failed to save recent directory:', error);
		}
	}

	getMostUsedConfigs(limit: number = 3): RecentConfig[] {
		const configs = this.getRecentConfigs();
		// Sort by use count descending, then by last used
		return configs
			.sort((a, b) => {
				if (b.useCount !== a.useCount) {
					return b.useCount - a.useCount;
				}
				return b.lastUsed.getTime() - a.lastUsed.getTime();
			})
			.slice(0, limit);
	}

	getMostUsedDirectories(limit: number = 5): RecentDirectory[] {
		const dirs = this.getRecentDirectories();
		// Sort by use count descending, then by last used
		return dirs
			.sort((a, b) => {
				if (b.useCount !== a.useCount) {
					return b.useCount - a.useCount;
				}
				return b.lastUsed.getTime() - a.lastUsed.getTime();
			})
			.slice(0, limit);
	}
}

export const recentConfigsService = new RecentConfigsService();