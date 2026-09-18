ALTER TABLE `llm_usage` ADD `label` text;--> statement-breakpoint
ALTER TABLE `llm_usage` ADD `attempt` integer DEFAULT 1 NOT NULL;