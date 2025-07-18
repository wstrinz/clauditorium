<script lang="ts">
	import type { TodoItem } from '$lib/stores/session-todos';

	interface Props {
		todos: TodoItem[];
		sessionId: string;
		isCollapsed?: boolean;
	}

	let { todos, sessionId, isCollapsed = false }: Props = $props();

	// Group todos by status
	const todosByStatus = $derived(() => {
		const groups = {
			in_progress: todos.filter(t => t.status === 'in_progress'),
			pending: todos.filter(t => t.status === 'pending'),
			completed: todos.filter(t => t.status === 'completed')
		};
		return groups;
	});

	// Summary stats
	const todoStats = $derived(() => {
		const total = todos.length;
		const completed = todosByStatus().completed.length;
		const inProgress = todosByStatus().in_progress.length;
		const pending = todosByStatus().pending.length;
		
		const completionPercentage = total > 0 ? Math.round((completed / total) * 100) : 0;
		
		return {
			total,
			completed,
			inProgress,
			pending,
			completionPercentage
		};
	});

	function getPriorityColor(priority: string): string {
		switch (priority) {
			case 'high': return 'text-red-600 bg-red-500/20';
			case 'medium': return 'text-yellow-600 bg-yellow-500/20';
			case 'low': return 'text-green-600 bg-green-500/20';
			default: return 'text-gray-600 bg-gray-500/20';
		}
	}

	function getStatusIcon(status: string): string {
		switch (status) {
			case 'completed': return '✅';
			case 'in_progress': return '🔄';
			case 'pending': return '⏳';
			default: return '❓';
		}
	}

	function getStatusColor(status: string): string {
		switch (status) {
			case 'completed': return 'border-green-500 bg-green-500/10';
			case 'in_progress': return 'border-blue-500 bg-blue-500/10';
			case 'pending': return 'border-orange-500 bg-orange-500/10';
			default: return 'border-gray-500 bg-gray-500/10';
		}
	}
</script>

{#if todos.length > 0}
	<div class="todo-list border rounded-lg shadow-sm bg-base-100">
		<!-- Header -->
		<div class="p-3 border-b border-base-300 bg-base-200">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<span class="text-sm font-semibold">📋 Todo List</span>
					<span class="badge badge-xs badge-outline">
						{todoStats().completed}/{todoStats().total}
					</span>
				</div>
				
				<!-- Progress bar -->
				<div class="flex items-center gap-2">
					<div class="w-20 h-2 bg-base-300 rounded-full overflow-hidden">
						<div 
							class="h-full bg-green-500 transition-all duration-300"
							style="width: {todoStats().completionPercentage}%"
						></div>
					</div>
					<span class="text-xs text-base-content/60">
						{todoStats().completionPercentage}%
					</span>
				</div>
			</div>
			
			<!-- Summary stats -->
			<div class="flex gap-2 mt-2">
				{#if todoStats().inProgress > 0}
					<span class="badge badge-xs badge-info">
						🔄 {todoStats().inProgress} in progress
					</span>
				{/if}
				{#if todoStats().pending > 0}
					<span class="badge badge-xs badge-warning">
						⏳ {todoStats().pending} pending
					</span>
				{/if}
				{#if todoStats().completed > 0}
					<span class="badge badge-xs badge-success">
						✅ {todoStats().completed} completed
					</span>
				{/if}
			</div>
		</div>

		<!-- Todo items -->
		<div class="p-3 space-y-2 max-h-64 overflow-y-auto">
			<!-- In Progress items -->
			{#if todosByStatus().in_progress.length > 0}
				<div class="space-y-1">
					<div class="text-xs font-medium text-blue-600 mb-1">🔄 In Progress</div>
					{#each todosByStatus().in_progress as todo}
						<div class="todo-item border rounded p-2 {getStatusColor(todo.status)}">
							<div class="flex items-start justify-between">
								<div class="flex-1">
									<div class="flex items-center gap-2 mb-1">
										<span class="text-sm">{getStatusIcon(todo.status)}</span>
										<span class="text-sm font-medium">{todo.content}</span>
									</div>
									<div class="flex gap-1">
										<span class="badge badge-xs {getPriorityColor(todo.priority)}">
											{todo.priority}
										</span>
										<span class="badge badge-xs badge-outline">
											{todo.id.substring(0, 6)}
										</span>
									</div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Pending items -->
			{#if todosByStatus().pending.length > 0}
				<div class="space-y-1">
					<div class="text-xs font-medium text-orange-600 mb-1">⏳ Pending</div>
					{#each todosByStatus().pending as todo}
						<div class="todo-item border rounded p-2 {getStatusColor(todo.status)}">
							<div class="flex items-start justify-between">
								<div class="flex-1">
									<div class="flex items-center gap-2 mb-1">
										<span class="text-sm">{getStatusIcon(todo.status)}</span>
										<span class="text-sm">{todo.content}</span>
									</div>
									<div class="flex gap-1">
										<span class="badge badge-xs {getPriorityColor(todo.priority)}">
											{todo.priority}
										</span>
										<span class="badge badge-xs badge-outline">
											{todo.id.substring(0, 6)}
										</span>
									</div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Completed items (collapsed by default) -->
			{#if todosByStatus().completed.length > 0}
				<details class="space-y-1">
					<summary class="text-xs font-medium text-green-600 cursor-pointer">
						✅ Completed ({todosByStatus().completed.length})
					</summary>
					<div class="space-y-1 mt-1">
						{#each todosByStatus().completed as todo}
							<div class="todo-item border rounded p-2 {getStatusColor(todo.status)} opacity-75">
								<div class="flex items-start justify-between">
									<div class="flex-1">
										<div class="flex items-center gap-2 mb-1">
											<span class="text-sm">{getStatusIcon(todo.status)}</span>
											<span class="text-sm line-through text-base-content/60">{todo.content}</span>
										</div>
										<div class="flex gap-1">
											<span class="badge badge-xs {getPriorityColor(todo.priority)}">
												{todo.priority}
											</span>
											<span class="badge badge-xs badge-outline">
												{todo.id.substring(0, 6)}
											</span>
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</details>
			{/if}
		</div>
	</div>
{:else}
	<!-- Empty state -->
	<div class="todo-list border rounded-lg shadow-sm bg-base-100 opacity-50">
		<div class="p-3 text-center text-base-content/60">
			<div class="text-sm">📋 No todos yet</div>
			<div class="text-xs mt-1">Todo lists will appear here when Claude uses the TodoWrite tool</div>
		</div>
	</div>
{/if}

<style>
	.todo-item {
		transition: all 0.2s ease;
	}
	
	.todo-item:hover {
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}
</style>