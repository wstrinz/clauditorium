import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// Common tools that users might want to pre-approve
export const COMMON_TOOLS = [
	'Read',
	'Write', 
	'Edit',
	'MultiEdit',
	'Bash',
	'Glob',
	'Grep',
	'LS',
	'Task',
	'WebFetch',
	'WebSearch',
	'TodoRead',
	'TodoWrite',
	'NotebookRead',
	'NotebookEdit'
] as const;

export type ToolName = typeof COMMON_TOOLS[number] | string;

export interface ToolApprovalSettings {
	// Tools that are globally approved (always auto-approve)
	globallyApprovedTools: Set<ToolName>;
	// Tools that are approved for the current session only
	sessionApprovedTools: Set<ToolName>;
	// Tool patterns that are approved (toolName:param1,param2,param3)
	globallyApprovedPatterns: Set<string>;
	sessionApprovedPatterns: Set<string>;
	// Whether to remember approvals globally by default
	rememberApprovalsGlobally: boolean;
}

const DEFAULT_SETTINGS: ToolApprovalSettings = {
	globallyApprovedTools: new Set(COMMON_TOOLS), // Auto-approve all common tools by default
	sessionApprovedTools: new Set(),
	globallyApprovedPatterns: new Set(),
	sessionApprovedPatterns: new Set(),
	rememberApprovalsGlobally: true // Enable global approval by default for better UX
};

// Load settings from localStorage
function loadSettings(): ToolApprovalSettings {
	if (!browser) return DEFAULT_SETTINGS;
	
	try {
		const stored = localStorage.getItem('claudeitorium_tool_approvals');
		if (stored) {
			const parsed = JSON.parse(stored);
			const settings: ToolApprovalSettings = {
				globallyApprovedTools: new Set<ToolName>(parsed.globallyApprovedTools || []),
				sessionApprovedTools: new Set<ToolName>(parsed.sessionApprovedTools || []),
				globallyApprovedPatterns: new Set<string>(parsed.globallyApprovedPatterns || []),
				sessionApprovedPatterns: new Set<string>(parsed.sessionApprovedPatterns || []),
				rememberApprovalsGlobally: parsed.rememberApprovalsGlobally ?? false
			};
			console.log('📱 Loaded tool approval settings:', {
				globalTools: Array.from(settings.globallyApprovedTools),
				sessionTools: Array.from(settings.sessionApprovedTools),
				rememberGlobally: settings.rememberApprovalsGlobally
			});
			return settings;
		}
	} catch (error) {
		console.error('Failed to load tool approval settings:', error);
	}
	
	console.log('📱 Using default tool approval settings');
	return DEFAULT_SETTINGS;
}

// Save settings to localStorage
function saveSettings(settings: ToolApprovalSettings) {
	if (!browser) return;
	
	try {
		const toSave = {
			globallyApprovedTools: Array.from(settings.globallyApprovedTools),
			sessionApprovedTools: Array.from(settings.sessionApprovedTools),
			globallyApprovedPatterns: Array.from(settings.globallyApprovedPatterns),
			sessionApprovedPatterns: Array.from(settings.sessionApprovedPatterns),
			rememberApprovalsGlobally: settings.rememberApprovalsGlobally
		};
		localStorage.setItem('claudeitorium_tool_approvals', JSON.stringify(toSave));
	} catch (error) {
		console.error('Failed to save tool approval settings:', error);
	}
}

// Create the store
function createToolApprovalStore() {
	const { subscribe, set, update } = writable<ToolApprovalSettings>(loadSettings());

	return {
		subscribe,
		
		// Add a tool to global approvals
		addGlobalTool: (toolName: ToolName) => {
			update(settings => {
				settings.globallyApprovedTools.add(toolName);
				saveSettings(settings);
				return settings;
			});
		},
		
		// Remove a tool from global approvals
		removeGlobalTool: (toolName: ToolName) => {
			update(settings => {
				settings.globallyApprovedTools.delete(toolName);
				saveSettings(settings);
				return settings;
			});
		},
		
		// Add a tool to session approvals
		addSessionTool: (toolName: ToolName) => {
			update(settings => {
				settings.sessionApprovedTools.add(toolName);
				return settings;
			});
		},
		
		// Add a pattern to global approvals
		addGlobalPattern: (pattern: string) => {
			update(settings => {
				settings.globallyApprovedPatterns.add(pattern);
				saveSettings(settings);
				return settings;
			});
		},
		
		// Add a pattern to session approvals
		addSessionPattern: (pattern: string) => {
			update(settings => {
				settings.sessionApprovedPatterns.add(pattern);
				return settings;
			});
		},
		
		// Clear session approvals (called when session ends)
		clearSessionApprovals: () => {
			update(settings => {
				settings.sessionApprovedTools.clear();
				settings.sessionApprovedPatterns.clear();
				return settings;
			});
		},
		
		// Clear all approvals
		clearAllApprovals: () => {
			update(settings => {
				settings.globallyApprovedTools.clear();
				settings.sessionApprovedTools.clear();
				settings.globallyApprovedPatterns.clear();
				settings.sessionApprovedPatterns.clear();
				saveSettings(settings);
				return settings;
			});
		},
		
		// Toggle remember globally setting
		toggleRememberGlobally: () => {
			update(settings => {
				settings.rememberApprovalsGlobally = !settings.rememberApprovalsGlobally;
				saveSettings(settings);
				return settings;
			});
		},
		
		// Check if a tool should be auto-approved
		shouldAutoApprove: (toolName: ToolName, pattern?: string): boolean => {
			const settings = loadSettings();
			
			// Check global tool approval
			if (settings.globallyApprovedTools.has(toolName)) {
				return true;
			}
			
			// Check session tool approval
			if (settings.sessionApprovedTools.has(toolName)) {
				return true;
			}
			
			// Check pattern approvals if pattern provided
			if (pattern) {
				if (settings.globallyApprovedPatterns.has(pattern) || 
					settings.sessionApprovedPatterns.has(pattern)) {
					return true;
				}
			}
			
			return false;
		},
		
		// Set pre-approved tools for a new session
		setSessionApprovals: (tools: ToolName[], patterns: string[] = []) => {
			update(settings => {
				settings.sessionApprovedTools = new Set(tools);
				settings.sessionApprovedPatterns = new Set(patterns);
				return settings;
			});
		},
		
		// Discover and auto-approve new tools that aren't in our known list
		discoverAndAutoApproveTool: (toolName: ToolName) => {
			let wasDiscovered = false;
			update(settings => {
				// Auto-approve any tool that isn't already approved
				if (!settings.globallyApprovedTools.has(toolName)) {
					if (COMMON_TOOLS.includes(toolName as any)) {
						console.log('📋 Auto-approving common tool:', toolName);
					} else {
						console.log('🔍 Discovered new tool, auto-approving globally:', toolName);
						wasDiscovered = true;
					}
					settings.globallyApprovedTools.add(toolName);
					saveSettings(settings);
				}
				return settings;
			});
			return wasDiscovered;
		},
		
		// Get all known tools (common + discovered)
		getAllKnownTools: (): ToolName[] => {
			const settings = loadSettings();
			const allTools = new Set([...COMMON_TOOLS, ...settings.globallyApprovedTools, ...settings.sessionApprovedTools]);
			return Array.from(allTools);
		}
	};
}

export const toolApprovalStore = createToolApprovalStore();