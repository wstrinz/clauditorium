import { writable } from 'svelte/store';

export interface TodoItem {
	id: string;
	content: string;
	status: 'pending' | 'in_progress' | 'completed';
	priority: 'high' | 'medium' | 'low';
}

export interface SessionTodos {
	[sessionId: string]: TodoItem[];
}

// Store to track todos per session
export const sessionTodosStore = writable<SessionTodos>({});

// Extract todos from TodoWrite tool calls
export function extractTodosFromToolCall(toolName: string, input: any): TodoItem[] | null {
	if (toolName === 'TodoWrite' && input?.todos && Array.isArray(input.todos)) {
		return input.todos.map((todo: any) => ({
			id: todo.id || crypto.randomUUID(),
			content: todo.content || '',
			status: todo.status || 'pending',
			priority: todo.priority || 'medium'
		}));
	}
	return null;
}

// Extract todos from TodoRead tool results
export function extractTodosFromToolResult(toolUseId: string, content: any): TodoItem[] | null {
	// Check if this is a TodoRead result by checking the tool use ID context
	if (typeof content === 'string') {
		try {
			const parsed = JSON.parse(content);
			if (Array.isArray(parsed) && parsed.every(item => 
				typeof item === 'object' && 
				item.id && 
				item.content && 
				item.status && 
				item.priority
			)) {
				return parsed.map((todo: any) => ({
					id: todo.id,
					content: todo.content,
					status: todo.status,
					priority: todo.priority
				}));
			}
		} catch (e) {
			// Not JSON or not a todo list
		}
	}
	return null;
}

// Update todos for a session
export function updateSessionTodos(sessionId: string, todos: TodoItem[]) {
	sessionTodosStore.update(sessions => ({
		...sessions,
		[sessionId]: todos
	}));
}

// Get todos for a session
export function getSessionTodos(sessionId: string): TodoItem[] {
	let todos: TodoItem[] = [];
	sessionTodosStore.subscribe(sessions => {
		todos = sessions[sessionId] || [];
	})();
	return todos;
}

// Clear todos for a session
export function clearSessionTodos(sessionId: string) {
	sessionTodosStore.update(sessions => {
		const updated = { ...sessions };
		delete updated[sessionId];
		return updated;
	});
}