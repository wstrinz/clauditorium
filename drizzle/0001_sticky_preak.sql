ALTER TABLE `sessions` ADD `claude_session_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `claude_session_path` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `is_claude_session` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `sessions` ADD `discovered_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_claude_session_id_unique` ON `sessions` (`claude_session_id`);